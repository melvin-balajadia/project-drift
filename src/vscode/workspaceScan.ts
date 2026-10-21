import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import { minimatch } from 'minimatch';
import * as vscode from 'vscode';
import { listFiles } from '../git/files';
import type { DriftCache } from './cache';
import { getConfig } from './config';
import { log } from './log';
import { FOCUS_VIEW } from './driftTree';

export const SCAN_WORKSPACE = 'projectDrift.scanWorkspace';
const EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py']);

export interface ScanResult {
  files: number;
  cancelled: boolean;
}

/** Analyzes every tracked, supported file in the workspace folders. */
export async function scanWorkspace(
  cache: DriftCache,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken,
): Promise<ScanResult> {
  const uris = await scannableFiles();
  let done = 0;
  await cache.refreshMany(uris, token, () => {
    done++;
    progress.report({ message: `${done}/${uris.length} files`, increment: 100 / uris.length });
  });
  return { files: done, cancelled: token.isCancellationRequested };
}

/** Tracked files with a supported extension, minus exclude globs and oversized files. */
async function scannableFiles(): Promise<vscode.Uri[]> {
  const candidates = new Map<string, number>(); // absolute path -> size limit in bytes
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme !== 'file') continue;
    const { exclude, maxFileSizeKB } = getConfig(folder.uri);
    let files: string[];
    try {
      files = await listFiles(folder.uri.fsPath); // relative to the folder
    } catch (error) {
      log.info(`Skipping ${folder.name}: ${String(error)}`); // usually not a git repo
      continue;
    }
    for (const file of files) {
      if (!EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
      if (exclude.some((glob) => minimatch(file, glob, { dot: true }))) continue;
      candidates.set(path.join(folder.uri.fsPath, file), maxFileSizeKB * 1024);
    }
  }

  const kept = await Promise.all(
    [...candidates].map(async ([file, limit]) => {
      const size = (await stat(file).catch(() => undefined))?.size ?? Infinity; // deleted but tracked
      return size <= limit ? vscode.Uri.file(file) : undefined;
    }),
  );
  return kept.filter((uri) => uri !== undefined);
}

export function registerWorkspaceScan(context: vscode.ExtensionContext, cache: DriftCache): void {
  let running = false;
  context.subscriptions.push(
    vscode.commands.registerCommand(SCAN_WORKSPACE, async () => {
      if (running) {
        void vscode.window.showInformationMessage('Project Drift: A scan is already running.');
        return;
      }
      running = true;
      const start = Date.now();
      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Project Drift: Scanning workspace',
            cancellable: true,
          },
          (progress, token) => scanWorkspace(cache, progress, token),
        );
        log.info(
          `Scan ${result.cancelled ? 'cancelled' : 'finished'}: ${result.files} files in ${Date.now() - start} ms`,
        );
        await vscode.commands.executeCommand(FOCUS_VIEW);
      } catch (error) {
        log.error(`Scan failed: ${String(error)}`);
      } finally {
        running = false;
      }
    }),
  );
}
