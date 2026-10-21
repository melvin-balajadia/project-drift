import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Project Drift');
  context.subscriptions.push(output);
  output.appendLine('Project Drift activated');
}

export function deactivate(): void {}
