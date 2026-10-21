import * as path from 'node:path';
import * as vscode from 'vscode';
import { forEachLimited } from '../core/concurrency';
import type { DriftItem } from '../core/types';
import { GitError } from '../git/exec';
import { headSha, isShallow } from '../git/repo';
import { analyzeDocument, resolveFile } from './analyzer';
import { getConfig } from './config';
import type { Dismissals } from './dismissals';
import { watchHead } from './gitExtension';
import { log } from './log';

const CONCURRENCY = 4;

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
  private readonly shallowChecked = new Set<string>();
  /** Set when git isn't installed; analysis stays off for the session. */
  gitMissing = false;
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

  /** Documents with at least one drifted comment, dismissed ones included. */
  driftedDocuments(): vscode.Uri[] {
    return [...this.entries]
      .filter(([, entry]) => entry.items.length > 0)
      .map(([key]) => vscode.Uri.parse(key));
  }

  /** Refreshes documents by URI, four at a time. Never throws. */
  async refreshMany(
    uris: readonly vscode.Uri[],
    token?: vscode.CancellationToken,
    onDone?: () => void,
  ): Promise<void> {
    // HEAD is per repo, and each git process costs ~60 ms on Windows, so the batch
    // looks it up once per repo. A HEAD change mid-batch triggers another batch.
    const heads = new Map<string, Promise<string | undefined>>();
    await forEachLimited(
      uris,
      CONCURRENCY,
      async (uri) => {
        try {
          await this.refresh(await vscode.workspace.openTextDocument(uri), heads);
        } catch (error) {
          // Typically deleted (e.g. by a checkout); drop stale results.
          log.debug(`Can't open ${uri.fsPath}: ${String(error)}`);
          if (this.entries.delete(uri.toString())) this.changed.fire();
        }
        onDone?.();
      },
      () => token?.isCancellationRequested ?? false,
    );
  }

  /**
   * Re-analyzes a document unless its repo, HEAD, and mtime are unchanged. Never throws.
   * `heads` shares HEAD lookups across a batch; without it HEAD is read fresh.
   */
  async refresh(
    doc: vscode.TextDocument,
    heads?: Map<string, Promise<string | undefined>>,
  ): Promise<void> {
    if (this.gitMissing) return;
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
      let headLookup = heads?.get(file.root);
      if (!headLookup) {
        headLookup = headSha(file.root);
        heads?.set(file.root, headLookup);
      }
      const [head, stat] = await Promise.all([
        headLookup,
        vscode.workspace.fs.stat(doc.uri),
        this.noticeShallow(file.root),
      ]);
      const key = [file.root, file.file, head, stat.mtime].join('|');
      if (this.entries.get(uri)?.key === key) return;

      const start = Date.now();
      const tooLarge = stat.size > getConfig(doc.uri).maxFileSizeKB * 1024;
      const items = tooLarge ? [] : await analyzeDocument(doc, file);
      if (!isLatest()) return; // a newer refresh superseded this one
      log.debug(
        tooLarge
          ? `Skipped ${file.file}: larger than maxFileSizeKB`
          : `Analyzed ${file.file}: ${items.length} drifted in ${Date.now() - start} ms`,
      );
      this.entries.set(uri, { key, items });
      this.changed.fire();
    } catch (error) {
      this.reportError(error, doc.uri.fsPath);
    }
  }

  /** Logs a failure. A missing git binary is reported once and disables analysis. */
  reportError(error: unknown, context: string): void {
    if (error instanceof GitError && error.kind === 'not-installed') {
      if (this.gitMissing) return;
      this.gitMissing = true;
      log.error(`git was not found on PATH; analysis is disabled for this session.`);
      void vscode.window.showWarningMessage(
        'Project Drift needs git, which was not found on your PATH. Install git, then reload the window.',
      );
      return;
    }
    log.warn(`${context}: ${error instanceof Error ? error.message : String(error)}`);
  }

  /** Shallow clones lack history, so drift is undercounted. Says so once per repo. */
  private async noticeShallow(root: string): Promise<void> {
    if (this.shallowChecked.has(root)) return;
    this.shallowChecked.add(root);
    if (!(await isShallow(root).catch(() => false))) return;
    log.info(`${root} is a shallow clone; results may be incomplete.`);
    void vscode.window.showInformationMessage(
      `Project Drift: ${path.basename(root)} is a shallow clone, so some drift may be missed. Run "git fetch --unshallow" for complete results.`,
    );
  }

  /** Forces the next refresh of every document to re-analyze; results stay visible meanwhile. */
  invalidate(): void {
    for (const entry of this.entries.values()) entry.key = '';
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

/** Keeps results current: visible editors, saves, reloads, settings, and HEAD changes. */
export function registerTriggers(context: vscode.ExtensionContext, cache: DriftCache): void {
  const refreshVisible = () => {
    const docs = new Set(vscode.window.visibleTextEditors.map((e) => e.document));
    docs.forEach((doc) => void cache.refresh(doc));
  };
  // ponytail: only files that already have drift are re-checked, so a checkout that
  // introduces drift elsewhere shows up on open or on the next scan. Re-blaming every
  // scanned file on each commit would cost seconds of git work in a large repo.
  const onHeadChange = () => {
    refreshVisible();
    void cache.refreshMany(cache.driftedDocuments());
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
      const affectsResults = ['threshold', 'maxScopeLines', 'maxFileSizeKB'].some((key) =>
        e.affectsConfiguration(`projectDrift.${key}`),
      );
      if (!affectsResults) return;
      cache.invalidate();
      void cache.refreshMany(cache.documents());
    }),
    { dispose: () => timers.forEach(clearTimeout) },
  );

  void watchHead(context, onHeadChange).then((watching) => {
    if (watching) return;
    // Without the Git extension, re-check on focus; the cache key includes HEAD.
    log.info('Git extension unavailable; checking for HEAD changes on window focus.');
    context.subscriptions.push(
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) onHeadChange();
      }),
    );
  });

  refreshVisible();
}
