import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import type { DriftItem } from '../../src/core/types';
import type { DriftApi } from '../../src/extension';
import type { FileNode } from '../../src/vscode/driftTree';
import { makeRepo, type Repo } from './helpers/makeRepo';

async function waitFor<T>(what: string, check: () => T | undefined | false): Promise<T> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const hoverText = (hovers: vscode.Hover[]) =>
  hovers
    .flatMap((h) => h.contents)
    .map((c) => (typeof c === 'string' ? c : c.value))
    .join('\n');

suite('Drift detection', () => {
  let repo: Repo;
  let api: DriftApi;
  let math: vscode.Uri;
  const items = () => api.cache.items(math);
  const treeFiles = () =>
    (api.tree.getChildren() as FileNode[]).map((f) => api.tree.getTreeItem(f).label);

  suiteSetup(async function () {
    this.timeout(60_000);
    // The workspace folder (see .vscode-test.mjs) becomes the test repo.
    repo = makeRepo(vscode.workspace.workspaceFolders![0]!.uri.fsPath);
    repo.write(
      'src/math.ts',
      [
        '// Adds two numbers.',
        'export function add(a: number, b: number): number {',
        '  const x = a;',
        '  const y = b;',
        '  return x + y;',
        '}',
        '',
        '// Subtracts b from a.',
        'export function sub(a: number, b: number): number {',
        '  return a - b;',
        '}',
        '',
      ].join('\n'),
    );
    repo.write(
      'src/util.py',
      [
        '# Doubles the value.',
        'def double(value):',
        '    result = value * 2',
        '    return result',
        '',
      ].join('\n'),
    );
    repo.commit('Add math and util');
    // add() changes in three later commits, on three different lines; double() in two.
    repo.edit('src/math.ts', 'const x = a;', 'const x = Number(a);');
    repo.commit('Coerce x');
    repo.edit('src/util.py', 'value * 2', 'value * 3');
    repo.commit('Triple instead');
    repo.edit('src/math.ts', 'const y = b;', 'const y = Number(b);');
    repo.commit('Coerce y');
    repo.edit('src/util.py', 'return result', 'return int(result)');
    repo.commit('Return an int');
    repo.edit('src/math.ts', 'return x + y;', 'return x + y + 0;');
    repo.commit('Add zero');

    api = await vscode.extensions
      .getExtension<DriftApi>('melvinbalajadia.project-drift')!
      .activate();
    await vscode.commands.executeCommand('git.openRepository', repo.dir);
    math = vscode.Uri.file(path.join(repo.dir, 'src/math.ts'));
    await vscode.window.showTextDocument(math);
  });

  teardown(() => vscode.commands.executeCommand('workbench.action.closeAllEditors'));

  test('flags a comment whose code changed in three later commits', async () => {
    const [item] = await waitFor('drift in math.ts', () => items().length > 0 && items());
    assert.strictEqual(items().length, 1, 'sub() is unchanged and must not be flagged');
    assert.strictEqual(item!.comment.startLine, 0);
    assert.strictEqual(item!.score, 3);
    assert.strictEqual(item!.severity, 'low');
    assert.deepStrictEqual(
      item!.newerCommits.map((c) => c.summary),
      ['Add zero', 'Coerce y', 'Coerce x'],
    );
  });

  test('hover lists the commits; quick fixes are offered', async () => {
    await vscode.window.showTextDocument(math);
    const text = hoverText(
      await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        math,
        new vscode.Position(0, 3),
      ),
    );
    assert.ok(text.includes('Possibly outdated comment'), text);
    assert.ok(text.includes('changed in 3 commits'), text);
    assert.ok(text.includes('Coerce y'), text);

    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      math,
      new vscode.Range(0, 0, 0, 0),
    );
    assert.deepStrictEqual(
      actions.map((a) => a.title).filter((t) => t.startsWith('Project Drift')),
      [
        'Project Drift: Mark comment as still accurate',
        'Project Drift: Show changes since comment',
      ],
    );
  });

  test('show changes opens a diff against the comment commit', async () => {
    const item = items()[0]!;
    await vscode.commands.executeCommand('projectDrift.showDiff', item);
    const tab = await waitFor('diff tab', () => {
      const active = vscode.window.tabGroups.activeTabGroup.activeTab;
      return active?.input instanceof vscode.TabInputTextDiff && active.input;
    });
    const before = await vscode.workspace.openTextDocument(tab.original);
    assert.strictEqual(
      before.getText().trim(),
      repo.git('show', `${item.commentCommit.sha}:src/math.ts`),
    );
  });

  test('a workspace scan fills the tree', async () => {
    await vscode.commands.executeCommand('projectDrift.scanWorkspace');
    assert.deepStrictEqual(treeFiles(), ['src/math.ts', 'src/util.py']);
    const [mathNode] = api.tree.getChildren() as FileNode[];
    const [itemNode] = api.tree.getChildren(mathNode) as DriftItem[];
    const treeItem = api.tree.getTreeItem(itemNode!);
    assert.strictEqual(treeItem.label, 'Adds two numbers.');
    assert.strictEqual(treeItem.description, '3 commits · L1');
    assert.strictEqual(treeItem.contextValue, 'driftItem');
  });

  test('results are hidden while the document has unsaved changes', async () => {
    const editor = await vscode.window.showTextDocument(math);
    await editor.edit((e) => e.insert(new vscode.Position(11, 0), '\n'));
    await waitFor('hidden while dirty', () => items().length === 0);
    await vscode.commands.executeCommand('workbench.action.files.revert');
    await waitFor('shown after revert', () => items().length === 1);
  });

  test('untracked files get no results and no errors', async () => {
    repo.write('src/new.ts', '// Not committed yet.\nexport const n = 1;\n');
    const uri = vscode.Uri.file(path.join(repo.dir, 'src/new.ts'));
    await api.cache.refresh(await vscode.workspace.openTextDocument(uri));
    assert.deepStrictEqual(api.cache.items(uri), []);
  });

  test('mark as accurate hides it; a new commit to the code brings it back', async () => {
    await vscode.window.showTextDocument(math);
    await vscode.commands.executeCommand('projectDrift.markAccurate', items()[0]);
    assert.strictEqual(items().length, 0);
    assert.deepStrictEqual(treeFiles(), ['src/util.py']);

    repo.edit('src/math.ts', 'Number(a);', 'Number(a) || 0;');
    repo.commit('Default x to zero');
    const [item] = await waitFor(
      'drift back after a new commit',
      () => items().length > 0 && items(),
    );
    assert.strictEqual(item!.newerCommits[0]!.summary, 'Default x to zero');
    assert.deepStrictEqual(treeFiles(), ['src/math.ts', 'src/util.py']);
  });
});
