import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension', () => {
  test('activates', async () => {
    const ext = vscode.extensions.getExtension('melvinbalajadia.project-drift');
    assert.ok(ext, 'extension not found');
    await ext.activate();
    assert.ok(ext.isActive);
  });
});
