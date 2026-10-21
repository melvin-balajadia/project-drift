import * as vscode from 'vscode';

export interface DriftConfig {
  threshold: number;
  maxScopeLines: number;
  showInProblems: boolean;
}

export function getConfig(scope?: vscode.Uri): DriftConfig {
  const config = vscode.workspace.getConfiguration('projectDrift', scope);
  return {
    threshold: config.get('threshold', 2),
    maxScopeLines: config.get('maxScopeLines', 20),
    showInProblems: config.get('showInProblems', false),
  };
}
