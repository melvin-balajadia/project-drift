# Project Drift — Implementation Plan

> **Find comments your code has outgrown.**
> A VS Code extension that flags code comments that have fallen out of sync with the code they describe, using git history.

---

## 0. How to use this plan (instructions for Claude Code)

- Work **one phase at a time** (see Section 12). Do not start the next phase until the current one is reviewed and approved.
- At the end of each phase: run `npm run lint`, `npm run typecheck`, and `npm test`, fix any failures, then **stop and summarize** what was built, what was tested, and any open questions.
- Check off tasks in this file (`- [x]`) as they are completed, so it stays the source of truth.
- **Stay in scope.** Anything not listed for v1.0 goes in the backlog (Section 14), not the code.
- If something in this plan is ambiguous or turns out to be technically wrong, ask before improvising.

---

## 1. Overview

When a developer edits code but not the comment above it, the comment slowly becomes misleading. Project Drift detects this automatically:

1. For each comment, it runs `git blame` to find when the comment was last changed.
2. It finds the code the comment describes (its **scope**).
3. It counts how many distinct commits have changed that code **since** the comment was last touched.
4. If that count meets a threshold, the comment is flagged as **drifted**.

Flagged comments get a gutter marker and a hover explaining which commits caused the drift. Users can open a diff of the changes, or dismiss the warning with "Mark as still accurate". The warning returns automatically if the code changes again. A sidebar view lists every drifted comment in the workspace.

---

## 2. Goals and non-goals

### v1.0 goals
- Detect drifted **full-line comments** in JavaScript, TypeScript (including JSX/TSX), and Python.
- Show drift in the editor (decorations, hover, quick fix, diff).
- List drift across the workspace in a native sidebar tree view.
- Fast, offline, no accounts, no network calls, no telemetry.

### Non-goals for v1.0
- Block comments (`/* */`, JSDoc) and Python docstrings.
- Languages other than JS/TS/Python.
- Any AI or LLM features.
- Webviews. All v1.0 UI is native VS Code UI (see Section 3).
- Blaming unsaved editor buffers (dirty documents are handled by hiding decorations until save).

---

## 3. Key decisions

1. **Native VS Code UI only for v1.0.** TreeView, hovers, code actions, decorations, the status bar, and the built-in diff editor cover every v1.0 feature. Native UI matches all themes (including high contrast), is accessible and keyboard-navigable by default, and is far lighter than a webview. A React webview is reserved for an optional v1.1 chart dashboard (Section 13), the one feature native APIs can't provide.
2. **Use the git CLI via `execFile` with argument arrays.** Never `exec` or a shell string, so file paths can't cause command injection.
3. **Pure core.** All parsing and scoring logic lives in `src/core/` and must not import `vscode`. This is enforced with an ESLint rule, so the core is unit-testable with Vitest alone.
4. **Blame-based scoring is approximate, and that is documented.** `git blame` records only the *last* commit per line, so a line changed three times counts once. This trade-off keeps the extension fast. An accurate mode using `git log -L` is in the backlog.

---

## 4. Tech stack

- **Language:** TypeScript 5.x, `strict: true`
- **Runtime:** Node 20+ (extension host); `engines.vscode`: `^1.90.0`
- **Bundler:** esbuild (single bundle at `dist/extension.js`)
- **Unit tests:** Vitest (for `src/core/**`)
- **Integration tests:** `@vscode/test-cli` + `@vscode/test-electron` (Mocha)
- **Lint/format:** ESLint (flat config) + Prettier
- **Runtime dependency:** `minimatch` (exclude globs). Keep runtime dependencies to a minimum.
- **Publishing:** `@vscode/vsce` (VS Code Marketplace) and `ovsx` (Open VSX)
- **CI:** GitHub Actions (lint, typecheck, unit tests, integration tests under `xvfb-run -a`)

---

## 5. Project structure

```
project-drift/
├─ src/
│  ├─ extension.ts            # activate/deactivate, wiring only
│  ├─ core/                   # PURE: no `vscode` imports (lint-enforced)
│  │  ├─ types.ts
│  │  ├─ blameParser.ts       # porcelain output -> BlameLine[]
│  │  ├─ comments.ts          # detect comment blocks per language
│  │  ├─ scope.ts             # heuristic scope + symbol-scope selection
│  │  ├─ drift.ts             # scoring + severity
│  │  └─ dismissalKey.ts
│  ├─ git/
│  │  ├─ exec.ts              # execFile wrapper (timeout, maxBuffer, errors)
│  │  ├─ repo.ts              # repo root (cached), shallow check, HEAD sha
│  │  ├─ blame.ts             # runs git blame, calls blameParser
│  │  ├─ files.ts             # git ls-files, git show <sha>:<path>
│  │  └─ gitExtension.ts      # optional built-in Git extension API (HEAD changes)
│  └─ vscode/
│     ├─ analyzer.ts          # document -> DriftItem[] (orchestrates core + git)
│     ├─ cache.ts
│     ├─ dismissals.ts        # workspaceState-backed store
│     ├─ decorations.ts
│     ├─ hover.ts
│     ├─ codeActions.ts
│     ├─ diffContentProvider.ts
│     ├─ driftTree.ts         # TreeDataProvider
│     ├─ workspaceScan.ts
│     ├─ statusBar.ts
│     ├─ diagnostics.ts       # optional Problems panel output
│     ├─ config.ts            # typed settings access
│     └─ log.ts               # OutputChannel logger
├─ test/
│  ├─ unit/                   # Vitest
│  │  └─ fixtures/            # saved porcelain outputs, sample sources
│  └─ integration/            # @vscode/test-cli
│     └─ helpers/makeRepo.ts  # builds temp git repos with fixed dates
├─ scripts/
│  └─ make-demo-repo.mjs      # demo repo for screenshots/GIF
├─ media/
│  ├─ icon.png                # 128x128 marketplace icon
│  └─ drift.svg               # activity bar icon
├─ .vscode-test.mjs
├─ .vscodeignore
├─ esbuild.mjs
├─ eslint.config.mjs
├─ vitest.config.ts
├─ CHANGELOG.md
├─ LICENSE                    # MIT
└─ README.md
```

---

## 6. Detection algorithm

### 6.1 Blame

Run from the repo root:

```
git blame --porcelain -w [--ignore-revs-file <repoRoot>/.git-blame-ignore-revs] -- <relativePath>
```

- `-w` ignores whitespace-only changes, reducing false positives from reformatting.
- Only pass `--ignore-revs-file` if that file exists (git errors otherwise).
- Convert `relativePath` to forward slashes (Windows).
- Use `execFile` with `timeout: 10_000` and a large `maxBuffer` (e.g. 50 MB).

**Porcelain format notes for the parser:**
- Each group starts with a header line: `<40-hex sha> <origLine> <finalLine> [<numLines>]`.
- Header key/value lines follow (`author`, `committer-time`, `summary`, `boundary`, `previous`, `filename`, …). **They appear only the first time a sha appears in the output**, so the parser must cache commit info by sha.
- Each group ends with the line content prefixed by a tab (`\t`).
- Uncommitted lines use the all-zeros sha (`0000000000000000000000000000000000000000`).
- Use **`committer-time`** (not author-time) for ordering, so rebased history orders correctly.

### 6.2 Comment detection

Supported language IDs: `javascript`, `javascriptreact`, `typescript`, `typescriptreact`, `python`.

- Full-line comments only: optional leading whitespace, then `//` (JS/TS) or `#` (Python).
- Group **consecutive** comment lines with the same indentation into one `CommentBlock`.
- **Skip** (not drift candidates):
  - Trailing inline comments (`foo(); // note`)
  - Shebangs (`#!`) and Python encoding lines (`# -*- coding: … -*-`)
  - Tool pragmas, e.g. `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `prettier-ignore`, `istanbul ignore`, `type: ignore`, `noqa`, `pylint:`, `fmt: off/on`
  - A comment block at the top of the file containing `copyright` or `license` (case-insensitive)
  - Comment blocks with no code following them before EOF

### 6.3 Scope (the code a comment describes)

1. **Symbol scope (preferred).** Using document symbols (`vscode.executeDocumentSymbolProvider`, flattened), find a symbol whose range starts within 2 lines after the comment block ends (this allows for decorators). If found, the scope is the symbol's range, capped at `maxScopeLines`.
2. **Heuristic fallback.** Starting at the first non-blank line after the comment, take lines until: a blank line, a line indented *less* than the comment, or `maxScopeLines` is reached.

`selectSymbolScope()` in `src/core/scope.ts` takes plain range objects (not `vscode` types) so it stays pure and testable.

### 6.4 Scoring

```ts
const commentTime = Math.max(...commentLines.map(l => blame[l].committerTime));
const newerCommits = uniqueBySha(
  scopeLines
    .map(l => blame[l])
    .filter(b => !b.uncommitted && b.committerTime > commentTime)
);
const score = newerCommits.length; // flagged if score >= threshold
```

- If any comment line is uncommitted, skip the block (the user is editing it right now).
- Uncommitted scope lines never count toward drift.

### 6.5 Severity

- **low:** `threshold <= score < threshold * 2`
- **medium:** `threshold * 2 <= score < threshold * 4`
- **high:** `score >= threshold * 4`

Severity controls the tree view icon and sort order.

### 6.6 Dismissal key

```
${relativePath}::${sha1(normalizedCommentText)}::${newestScopeCommitSha}
```

- `normalizedCommentText`: comment text with markers and surrounding whitespace stripped, lines joined with `\n`.
- Line numbers are deliberately **excluded**, so dismissals survive code moving up or down.
- If the comment text changes **or** the code receives a new commit, the key no longer matches and the warning reappears.
- Use Node's `crypto.createHash('sha1')`.

---

## 7. Data model (`src/core/types.ts`)

```ts
export interface CommitInfo {
  sha: string;
  committerTime: number;   // unix seconds
  author: string;
  summary: string;
}

export interface BlameLine {
  line: number;            // 0-based final line number
  commit: CommitInfo;
  uncommitted: boolean;
}

export interface CommentBlock {
  startLine: number;       // 0-based, inclusive
  endLine: number;         // 0-based, inclusive
  indent: number;
  text: string;            // normalized text, markers stripped
}

export interface Scope {
  startLine: number;
  endLine: number;
  source: 'symbol' | 'heuristic';
}

export type Severity = 'low' | 'medium' | 'high';

export interface DriftItem {
  id: string;              // dismissal key
  file: string;            // repo-relative path, forward slashes
  repoRoot: string;
  comment: CommentBlock;
  scope: Scope;
  commentCommit: CommitInfo;
  newerCommits: CommitInfo[];   // sorted newest first
  score: number;
  severity: Severity;
}
```

---

## 8. VS Code integration

### 8.1 Activation
- `activationEvents`: `["onStartupFinished"]`. Do no heavy work on activation; analyze lazily.
- Create the OutputChannel logger ("Project Drift") first.

### 8.2 Analysis triggers and caching
- Analyze **visible editors** for supported languages on: activation, `onDidChangeVisibleTextEditors`, `onDidSaveTextDocument` (debounced ~500 ms), config changes, and HEAD changes.
- **HEAD changes:** use the built-in Git extension API (`vscode.extensions.getExtension('vscode.git')?.exports.getAPI(1)`, `repository.state.onDidChange`, `repository.state.HEAD?.commit`). If unavailable, re-check HEAD with `git rev-parse HEAD` on window focus.
- **Dirty documents:** blame reflects the file on disk, so line numbers can be misaligned. While a document is dirty, hide its decorations. Re-analyze on save.
- **Cache** results per file, keyed by `repoRoot | relativePath | HEAD sha | file mtime`.

### 8.3 Decorations
- One `TextEditorDecorationType` with: a gutter icon, `isWholeLine: true` on the comment lines, a background from a contributed theme color `projectDrift.driftBackground`, and an overview ruler mark.
- Only comment lines are decorated, not the scope.
- `projectDrift.toggleDecorations` turns them on or off (persisted in workspaceState).

### 8.4 Hover
- `registerHoverProvider` for the supported languages, active on drifted comment lines.
- Markdown content:
  - Title: **"Possibly outdated comment"**, plus "The code below changed in N commits since this comment was last updated (date)."
  - Up to 5 newer commits: short sha, summary, author, relative date. Then "+N more" if needed.
  - Command links: **Show changes since comment** and **Mark as still accurate**.
- Set `isTrusted = { enabledCommands: ['projectDrift.showDiff', 'projectDrift.markAccurate'] }`. Do not trust all commands.

### 8.5 Code action
- `CodeActionProvider` (kind `QuickFix`) on drifted comment lines, offering:
  - "Project Drift: Mark comment as still accurate"
  - "Project Drift: Show changes since comment"

### 8.6 Dismissals
- Stored in `context.workspaceState` as a set of dismissal keys.
- `projectDrift.markAccurate` adds the key and refreshes everything.
- `projectDrift.clearDismissals` clears the set (with a confirmation prompt).

### 8.7 Diff ("Show changes since comment")
- Register a `TextDocumentContentProvider` for the scheme `project-drift-git`. It serves `git show <sha>:<relativePath>`.
- Run `vscode.diff` with the left side being the file at `commentCommit.sha` and the right side being the current file. Title: `<file> (since <shortSha>) ↔ Current`.
- If `git show` fails (for example, the file was renamed), show an info message instead of throwing.

### 8.8 Sidebar tree view
- A custom activity bar container "Project Drift" with the view "Drifted Comments".
- Tree shape: **file nodes** (label: path, description: count) containing **drift item nodes** (label: first line of the comment; description: `N commits · L<line>`; icon based on severity; tooltip: hover-style markdown).
- Sort files by highest severity, then score. Sort items by line.
- Clicking an item opens the file and reveals the comment.
- Inline/context actions on items (`contextValue: 'driftItem'`): Mark as still accurate, Show changes.
- Use a `viewsWelcome` contribution for empty states ("No drifted comments found." with a Scan button, or "Open a git repository to use Project Drift.").

### 8.9 Workspace scan
- `projectDrift.scanWorkspace` runs per repo (multi-root aware):
  - `git ls-files -z` filtered to supported extensions (`.js .jsx .mjs .cjs .ts .tsx .py`), then filtered with `projectDrift.exclude` globs (minimatch) and `projectDrift.maxFileSizeKB`.
  - Concurrency limit of 4 (small in-house limiter, no dependency).
  - `withProgress` notification, **cancellable**.
  - Scope: open each file with `openTextDocument` and request symbols with a ~1500 ms timeout, falling back to the heuristic.
- Results populate the tree and the cache.

### 8.10 Status bar
- Shows `$(history) Drift: N` for the active file. Hidden when N is 0 or the language is unsupported.
- Clicking it focuses the sidebar view.

### 8.11 Diagnostics (optional)
- When `projectDrift.showInProblems` is true, publish an `Information`-severity diagnostic per drifted comment (source: "Project Drift").

---

## 9. `package.json` contributions (reference)

```json
"activationEvents": ["onStartupFinished"],
"contributes": {
  "commands": [
    { "command": "projectDrift.scanWorkspace", "title": "Scan Workspace", "category": "Project Drift", "icon": "$(refresh)" },
    { "command": "projectDrift.markAccurate", "title": "Mark Comment as Still Accurate", "category": "Project Drift" },
    { "command": "projectDrift.showDiff", "title": "Show Changes Since Comment", "category": "Project Drift" },
    { "command": "projectDrift.clearDismissals", "title": "Clear All Dismissals", "category": "Project Drift" },
    { "command": "projectDrift.toggleDecorations", "title": "Toggle Decorations", "category": "Project Drift" }
  ],
  "menus": {
    "commandPalette": [
      { "command": "projectDrift.showDiff", "when": "false" }
    ],
    "view/title": [
      { "command": "projectDrift.scanWorkspace", "when": "view == projectDrift.driftList", "group": "navigation" }
    ],
    "view/item/context": [
      { "command": "projectDrift.markAccurate", "when": "view == projectDrift.driftList && viewItem == driftItem", "group": "inline" },
      { "command": "projectDrift.showDiff", "when": "view == projectDrift.driftList && viewItem == driftItem" }
    ]
  },
  "viewsContainers": {
    "activitybar": [
      { "id": "projectDrift", "title": "Project Drift", "icon": "media/drift.svg" }
    ]
  },
  "views": {
    "projectDrift": [
      { "id": "projectDrift.driftList", "name": "Drifted Comments" }
    ]
  },
  "viewsWelcome": [
    {
      "view": "projectDrift.driftList",
      "contents": "No drifted comments found yet.\n[Scan Workspace](command:projectDrift.scanWorkspace)"
    }
  ],
  "configuration": {
    "title": "Project Drift",
    "properties": {
      "projectDrift.threshold": {
        "type": "integer", "default": 2, "minimum": 1,
        "description": "Number of newer commits to a comment's code before the comment is flagged."
      },
      "projectDrift.maxScopeLines": {
        "type": "integer", "default": 20, "minimum": 1,
        "description": "Maximum number of code lines considered to belong to a comment."
      },
      "projectDrift.showInProblems": {
        "type": "boolean", "default": false,
        "description": "Also report drifted comments in the Problems panel."
      },
      "projectDrift.exclude": {
        "type": "array", "items": { "type": "string" },
        "default": ["**/node_modules/**", "**/dist/**", "**/build/**", "**/vendor/**", "**/*.min.js"],
        "description": "Glob patterns to skip during workspace scans."
      },
      "projectDrift.maxFileSizeKB": {
        "type": "integer", "default": 512, "minimum": 1,
        "description": "Files larger than this are skipped."
      }
    }
  },
  "colors": [
    {
      "id": "projectDrift.driftBackground",
      "description": "Background of drifted comment lines.",
      "defaults": { "dark": "#ffb80014", "light": "#ffb80022" }
    }
  ]
}
```

Command IDs in the welcome view and menus must match exactly. If the implementation needs an extra internal command (for example, revealing a tree item), add it here and hide it from the Command Palette.

---

## 10. Error handling and edge cases

- **git not installed** (`ENOENT`): show a one-time warning, then disable analysis for the session.
- **Not a git repo / file outside any repo:** no results, no message.
- **Untracked file** (blame fails with "no such path"): no results, no message.
- **Shallow clone** (`git rev-parse --is-shallow-repository` returns `true`): show a one-time info message that results may be incomplete.
- **Large or minified files:** skipped by `maxFileSizeKB` and exclude globs.
- **CRLF line endings:** the parser and comment detection must handle `\r\n`.
- **Windows paths:** forward slashes for git paths; use `vscode.Uri` for file system paths.
- **Multi-root workspaces:** resolve the repo root per file (`git rev-parse --show-toplevel`, cached per directory).
- **Timeouts / huge output:** fail that file gracefully and log it to the OutputChannel. Never show an error popup per file.
- **No uncaught promise rejections**; all async entry points wrap errors and log.

---

## 11. Testing strategy

### Unit tests (Vitest, `test/unit/`)
- **blameParser:** repeated shas (info only on first appearance), uncommitted lines, `boundary` commits, CRLF, empty output.
- **comments:** each language; grouping; indentation changes splitting blocks; skipped pragmas, shebangs, encoding lines, license headers, inline comments.
- **scope:** symbol selection (including decorator offset), heuristic stops (blank line, dedent, cap).
- **drift:** threshold boundaries, uncommitted handling, equal timestamps, unique-by-sha counting, severity bands.
- **dismissalKey:** stable across line moves; changes when comment text or newest scope sha changes.

### Integration tests (`@vscode/test-cli`, `test/integration/`)
- `makeRepo.ts` creates a temp repo with deterministic history by setting `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` per commit and configuring `user.name`/`user.email` locally.
- **Scenario:** commit a file with a comment above a function → modify the function in 3 later commits → assert a DriftItem with `score === 3` → mark as accurate → assert it is gone → commit another change to the function → assert it returns.
- Assert that the tree view provider returns the expected nodes after a scan.

### Demo repo
- `scripts/make-demo-repo.mjs` generates `demo-repo/` with a realistic mix of fresh and drifted comments across JS, TS, and Python. It's used for the README GIF and for manual testing. Add `demo-repo/` to `.gitignore`.

---

## 12. Phases

### Phase 0 — Setup
- [x] Scaffold the extension (TypeScript + esbuild). `yo code` is interactive (`npx --package yo --package generator-code -- yo code`). If it can't be run, create the equivalent structure by hand.
- [x] `package.json` metadata: `name: "project-drift"`, `displayName: "Project Drift"`, `description`, `publisher` (placeholder), `repository`, `license: "MIT"`, `engines`, `categories: ["Linters", "Other"]`, `keywords`.
- [x] Strict `tsconfig.json`.
- [x] ESLint flat config + Prettier, including a `no-restricted-imports` rule banning `vscode` in `src/core/**`.
- [x] Vitest config for `test/unit/`.
- [x] `.vscode-test.mjs` for integration tests.
- [x] npm scripts: `build`, `watch`, `lint`, `typecheck`, `test:unit`, `test:integration`, `test`, `package`.
- [x] GitHub Actions CI on push and PR (lint, typecheck, unit, integration with `xvfb-run -a`).
- [x] `.vscodeignore` so only `dist/`, `media/`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `package.json` ship.

**Done when:** all scripts pass, and pressing F5 launches the Extension Development Host with "Project Drift activated" in the Output channel.

### Phase 1 — Core engine (pure)
- [ ] `types.ts`
- [ ] `blameParser.ts`
- [ ] `comments.ts`
- [ ] `scope.ts` (heuristic + `selectSymbolScope`)
- [ ] `drift.ts` (scoring + severity)
- [ ] `dismissalKey.ts`
- [ ] Unit tests and fixtures for all of the above (Section 11)

**Done when:** all unit tests pass, `src/core` has high coverage, and nothing in `src/core` imports `vscode`.

### Phase 2 — Git layer and analyzer
- [ ] `git/exec.ts` (execFile wrapper with timeout, maxBuffer, typed errors)
- [ ] `git/repo.ts` (repo root cache, shallow check, HEAD sha)
- [ ] `git/blame.ts` (with `-w` and conditional `--ignore-revs-file`)
- [ ] `git/files.ts` (`ls-files -z`, `show <sha>:<path>`)
- [ ] `vscode/analyzer.ts`: document → `DriftItem[]` (comments → scopes → blame → scoring → filter dismissals)
- [ ] `vscode/log.ts` OutputChannel logger
- [ ] Temporary dev command that logs analyzer output for the active file (remove in Phase 5)

**Done when:** running the dev command on the demo repo logs the expected drift items.

### Phase 3 — Editor experience
- [ ] Decorations + contributed theme color
- [ ] Hover with commit list and trusted command links
- [ ] Code actions
- [ ] Dismissal store + `markAccurate` + `clearDismissals`
- [ ] Diff content provider + `showDiff`
- [ ] Status bar item
- [ ] `toggleDecorations`
- [ ] Analysis triggers, debouncing, dirty-document handling, cache
- [ ] HEAD change detection via the Git extension API, with fallback
- [ ] Optional diagnostics (`showInProblems`)

**Done when:** in the demo repo, drifted comments are marked; the hover lists the correct commits; the diff opens; dismissing hides the warning; a new commit to that code brings it back; switching branches refreshes results.

### Phase 4 — Sidebar and workspace scan
- [ ] View container, view, and icon
- [ ] `driftTree.ts` with file and item nodes, sorting, severity icons, tooltips
- [ ] Click to reveal; inline and context actions
- [ ] `workspaceScan.ts`: ls-files, filters, concurrency limit, cancellable progress, symbol timeout fallback
- [ ] `viewsWelcome` empty states
- [ ] Tree refreshes on save, dismissal, config change, and HEAD change

**Done when:** scanning the demo repo lists every expected item, actions work from the tree, and cancelling a scan leaves the extension in a consistent state.

### Phase 5 — Robustness and tests
- [ ] Handle every case in Section 10
- [ ] Integration tests (Section 11)
- [ ] Remove the Phase 2 dev command
- [ ] Profile a scan on a mid-sized open-source repo and record the results for the README
- [ ] Review logs: useful, not noisy

**Done when:** all tests pass in CI and no edge case in Section 10 produces an error popup or an uncaught exception.

### Phase 6 — Docs and release
- [ ] `README.md`: one-line pitch, demo GIF, features, how it works (comment → scope → blame → score), settings, commands, **Limitations** (blame approximation, full-line comments only, supported languages), **Design decisions** (why native UI instead of a webview), contributing
- [ ] Demo GIF recorded from the demo repo
- [ ] `media/icon.png` (128x128)
- [ ] `CHANGELOG.md` (1.0.0) and `LICENSE` (MIT)
- [ ] `vsce package`, install the `.vsix` locally, and smoke-test it in a clean VS Code profile
- [ ] Confirm the name "Project Drift" is available, then publish to the VS Code Marketplace (`vsce publish`) and Open VSX (`ovsx publish`)

**Done when:** the extension installs from the Marketplace and works on a fresh machine.

---

## 13. v1.1 (optional): Drift Dashboard webview

The only planned webview: a repo-wide dashboard with charts (drift by folder, most-drifted files, when comments went stale), which native APIs can't draw.

- **Stack:** React + Vite + Tailwind v4 in a separate `webview-ui/` folder, built to `dist/webview/` with fixed filenames (no hashes).
- **Theming:** map Tailwind theme tokens to VS Code CSS variables (`--vscode-editor-foreground`, `--vscode-editor-background`, etc.) with `@theme`, so the dashboard follows the user's theme.
- **Security:** strict Content Security Policy with a nonce; load assets via `webview.asWebviewUri()`.
- **Messaging:** a shared, typed message protocol (discriminated unions) in `src/shared/messages.ts`, imported by both builds.
- **Do not use** `@vscode/webview-ui-toolkit` (deprecated). Use Tailwind with theme variables, or `@vscode-elements/elements` if native-looking components are needed.
- Exclude `webview-ui/` sources from the package via `.vscodeignore`.

---

## 14. Backlog (post-v1.0)

- Block comments (`/* */`, JSDoc) and Python docstrings
- More languages (Go, Rust, Java, C#)
- Blame unsaved buffers with `git blame --contents -` (instead of hiding decorations on dirty documents)
- Accurate mode using `git log -L` for exact commit counts
- Heuristic to skip commented-out code
- CLI / GitHub Action that reports drift in pull requests
- Per-folder thresholds

---

## 15. Definition of done (v1.0)

- Every Phase 0–6 checkbox is complete.
- CI is green: lint, typecheck, unit tests, integration tests.
- Works on macOS, Windows, and Linux.
- No network calls, no telemetry, no runtime errors in the Extension Host log during normal use.
- README clearly explains what it does, how it works, and its limitations.
