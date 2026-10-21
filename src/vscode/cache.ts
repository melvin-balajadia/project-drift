import * as vscode from 'vscode';
import type { DriftItem } from '../core/types';
import { headSha } from '../git/repo';
import { analyzeDocument, resolveFile } from './analyzer';
import type { Dismissals } from './dismissals';
import { watchHead } from './gitExtension';
import { log } from './log';

interface Entry {
  key: string; // repoRoot | path | HEAD | mtime
  items: DriftItem[]; // including dismissed items
}

/**
 * Drift results per document. Everything that shows drift reads from here and
 * re-renders on onDidChange. Results are hidden while a document is dirty,
 * because blame describes the file on disk.
 */
export class DriftCache implements vscode.Disposable {
  private readonly entries = new Map<string, Entry>();
  private readonly generations = new Map<string, number>();
  private readonly dirty = new Set<string>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly dismissals: Dismissals) {
    this.subscriptions = [
      this.changed,
      dismissals.onDidChange(() => this.changed.fire()),
      vscode.workspace.onDidChangeTextDocument(({ document }) => this.trackDirty(document)),
    ];
  }

  /** Non-dismissed items for a document; empty while it has unsaved changes. */
  items(uri: vscode.Uri): DriftItem[] {
    const key = uri.toString();
    if (this.dirty.has(key)) return [];
    return this.entries.get(key)?.items.filter((i) => !this.dismissals.has(i.id)) ?? [];
  }

  itemAt(uri: vscode.Uri, line: number): DriftItem | undefined {
    return this.items(uri).find((i) => line >= i.comment.startLine && line <= i.comment.endLine);
  }

  /** Documents that have results. */
  documents(): vscode.Uri[] {
    return [...this.entries.keys()].map((key) => vscode.Uri.parse(key));
  }

  /** Re-analyzes a document unless its repo, HEAD, and mtime are unchanged. Never throws. */
  async refresh(doc: vscode.TextDocument): Promise<void> {
    const uri = doc.uri.toString();
    this.trackDirty(doc);
    if (doc.isDirty) return; // analyzed on save
    const generation = (this.generations.get(uri) ?? 0) + 1;
    this.generations.set(uri, generation);
    const isLatest = () => this.generations.get(uri) === generation;

    try {
      const file = await resolveFile(doc);
      if (!file) {
        if (isLatest() && this.entries.delete(uri)) this.changed.fire();
        return;
      }
      const [head, stat] = await Promise.all([
        headSha(file.root),
        vscode.workspace.fs.stat(doc.uri),
      ]);
      const key = [file.root, file.file, head, stat.mtime].join('|');
      if (this.entries.get(uri)?.key === key) return;

      const items = await analyzeDocument(doc, file);
      if (!isLatest()) return; // a newer refresh superseded this one
      this.entries.set(uri, { key, items });
      this.changed.fire();
    } catch (error) {
      log.warn(`Analysis failed for ${doc.uri.fsPath}: ${String(error)}`);
    }
  }

  /** Drops all results, e.g. after a settings change. */
  clear(): void {
    this.entries.clear();
    this.changed.fire();
  }

  private trackDirty(doc: vscode.TextDocument): void {
    const uri = doc.uri.toString();
    if (doc.isDirty === this.dirty.has(uri)) return;
    if (doc.isDirty) this.dirty.add(uri);
    else this.dirty.delete(uri);
    if (this.entries.has(uri)) this.changed.fire();
  }

  dispose(): void {
    this.subscriptions.forEach((s) => s.dispose());
  }
}

const DEBOUNCE_MS = 500;

/** Analyzes visible editors on open, save, settings changes, and HEAD changes. */
export function registerTriggers(context: vscode.ExtensionContext, cache: DriftCache): void {
  const refreshVisible = () => {
    const docs = new Set(vscode.window.visibleTextEditors.map((e) => e.document));
    docs.forEach((doc) => void cache.refresh(doc));
  };

  const timers = new Map<string, NodeJS.Timeout>();
  const refreshSoon = (doc: vscode.TextDocument) => {
    const uri = doc.uri.toString();
    clearTimeout(timers.get(uri));
    timers.set(
      uri,
      setTimeout(() => {
        timers.delete(uri);
        void cache.refresh(doc);
      }, DEBOUNCE_MS),
    );
  };

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(refreshVisible),
    vscode.workspace.onDidSaveTextDocument(refreshSoon),
    // A change that leaves the document clean means it was reloaded from disk (checkout,
    // pull, external edit) or reverted. A HEAD change can arrive before the reload, so
    // re-check here too; the cache key makes this cheap when nothing changed.
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (document.uri.scheme === 'file' && !document.isDirty) refreshSoon(document);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('projectDrift')) return;
      cache.clear();
      refreshVisible();
    }),
    { dispose: () => timers.forEach(clearTimeout) },
  );

  void watchHead(context, refreshVisible).then((watching) => {
    if (watching) return;
    // Without the Git extension, re-check on focus; the cache key includes HEAD.
    log.info('Git extension unavailable; checking for HEAD changes on window focus.');
    context.subscriptions.push(
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) refreshVisible();
      }),
    );
  });

  refreshVisible();
}
