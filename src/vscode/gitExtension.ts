import * as vscode from 'vscode';

// The slice of the built-in Git extension API we use (extensions/git/src/api/git.d.ts).
interface Repository {
  readonly state: {
    readonly HEAD?: { readonly commit?: string };
    readonly onDidChange: vscode.Event<void>;
  };
}

interface GitAPI {
  readonly repositories: Repository[];
  readonly onDidOpenRepository: vscode.Event<Repository>;
}

interface GitExtension {
  getAPI(version: 1): GitAPI;
}

/**
 * Calls onHeadChange when the HEAD commit of any open repository changes
 * (commit, checkout, pull, ...). Resolves false if the Git extension is unavailable.
 */
export async function watchHead(
  context: vscode.ExtensionContext,
  onHeadChange: () => void,
): Promise<boolean> {
  try {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) return false;
    const api = (extension.isActive ? extension.exports : await extension.activate()).getAPI(1);

    const watch = (repo: Repository) => {
      let head = repo.state.HEAD?.commit;
      context.subscriptions.push(
        repo.state.onDidChange(() => {
          const next = repo.state.HEAD?.commit;
          if (next === head) return;
          head = next;
          onHeadChange();
        }),
      );
    };
    api.repositories.forEach(watch);
    context.subscriptions.push(api.onDidOpenRepository(watch));
    return true;
  } catch {
    return false; // e.g. git.enabled is false
  }
}
