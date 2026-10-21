import * as vscode from 'vscode';

export const log = vscode.window.createOutputChannel('Project Drift', { log: true });

/**
 * registerCommand whose failures go to the log instead of an error popup or an
 * unhandled rejection.
 */
export function registerCommand<A extends unknown[]>(
  id: string,
  run: (...args: A) => unknown,
): vscode.Disposable {
  return vscode.commands.registerCommand(id, async (...args: unknown[]) => {
    try {
      return await run(...(args as A));
    } catch (error) {
      log.error(`${id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
