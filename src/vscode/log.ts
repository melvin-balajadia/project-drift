import * as vscode from 'vscode';

export const log = vscode.window.createOutputChannel('Project Drift', { log: true });
