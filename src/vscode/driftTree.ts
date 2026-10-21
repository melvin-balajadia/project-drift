import * as path from 'node:path';
import * as vscode from 'vscode';
import type { DriftItem, Severity } from '../core/types';
import { repoRoot } from '../git/repo';
import type { DriftCache } from './cache';
import { driftMarkdown } from './hover';

const VIEW = 'projectDrift.driftList';
export const FOCUS_VIEW = `${VIEW}.focus`;

export interface FileNode {
  uri: vscode.Uri;
  items: DriftItem[];
}
// Item nodes are DriftItems themselves, so tree menu commands receive the item directly.
export type DriftNode = FileNode | DriftItem;

const RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };
const ICON: Record<Severity, vscode.ThemeIcon> = {
  high: new vscode.ThemeIcon('error', new vscode.ThemeColor('problemsErrorIcon.foreground')),
  medium: new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground')),
  low: new vscode.ThemeIcon('info', new vscode.ThemeColor('problemsInfoIcon.foreground')),
};

const worst = (items: DriftItem[]) => Math.max(...items.map((i) => RANK[i.severity]));
const topScore = (items: DriftItem[]) => Math.max(...items.map((i) => i.score));

export class DriftTree implements vscode.TreeDataProvider<DriftNode> {
  readonly onDidChangeTreeData: vscode.Event<void>;

  constructor(private readonly cache: DriftCache) {
    this.onDidChangeTreeData = cache.onDidChange;
  }

  getChildren(node?: DriftNode): DriftNode[] {
    if (!node) {
      return this.cache
        .documents()
        .map((uri) => ({ uri, items: this.cache.items(uri) }))
        .filter((f) => f.items.length > 0)
        .sort(
          (a, b) =>
            worst(b.items) - worst(a.items) ||
            topScore(b.items) - topScore(a.items) ||
            a.uri.fsPath.localeCompare(b.uri.fsPath),
        );
    }
    if ('uri' in node) {
      return [...node.items].sort((a, b) => a.comment.startLine - b.comment.startLine);
    }
    return [];
  }

  getTreeItem(node: DriftNode): vscode.TreeItem {
    if ('uri' in node) {
      const item = new vscode.TreeItem(node.uri, vscode.TreeItemCollapsibleState.Expanded);
      item.label = vscode.workspace.asRelativePath(node.uri);
      item.description = String(node.items.length);
      item.iconPath = vscode.ThemeIcon.File;
      item.contextValue = 'driftFile';
      return item;
    }

    const line = node.comment.startLine;
    const label = node.comment.text.split('\n')[0] || '(empty comment)';
    const commits = `${node.score} commit${node.score === 1 ? '' : 's'}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = `${commits} · L${line + 1}`;
    item.iconPath = ICON[node.severity];
    item.tooltip = driftMarkdown(node);
    item.contextValue = 'driftItem';
    item.accessibilityInformation = {
      label: `${node.severity} drift, ${commits}, line ${line + 1}: ${label}`,
    };
    item.command = {
      command: 'vscode.open',
      title: 'Open Comment',
      arguments: [
        vscode.Uri.file(path.join(node.repoRoot, node.file)),
        { selection: new vscode.Range(line, 0, line, 0) },
      ],
    };
    return item;
  }
}

export function registerDriftTree(context: vscode.ExtensionContext, cache: DriftCache): DriftTree {
  const tree = new DriftTree(cache);

  // Picks the empty-state message in viewsWelcome.
  const updateHasRepo = async () => {
    const roots = await Promise.all(
      (vscode.workspace.workspaceFolders ?? [])
        .filter((f) => f.uri.scheme === 'file')
        .map((f) => repoRoot(f.uri.fsPath).catch(() => undefined)),
    );
    await vscode.commands.executeCommand('setContext', 'projectDrift.hasRepo', roots.some(Boolean));
  };

  context.subscriptions.push(
    vscode.window.createTreeView(VIEW, { treeDataProvider: tree, showCollapseAll: true }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void updateHasRepo()),
  );
  void updateHasRepo();
  return tree;
}
