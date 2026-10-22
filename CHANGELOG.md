# Changelog

## 1.0.2

- Improved Marketplace overview: getting started steps, screenshots of each feature, a demo video link, and a dark page banner.

## 1.0.1

- New icon: the amber gutter marker beside a drifting `//`. The activity bar icon matches it.

## 1.0.0

First release.

- Flags full-line comments in JavaScript, TypeScript (including JSX/TSX), and Python whose code changed in at least `projectDrift.threshold` commits since the comment was last updated, using `git blame`.
- Editor markers: line highlight, gutter dot, and scrollbar mark, with a toggle.
- Hover listing the newer commits, with links to show the changes or dismiss the warning.
- Quick fixes: **Mark comment as still accurate** and **Show changes since comment**.
- Dismissals that come back automatically when the comment's code changes again.
- Diff of the file as of the comment's last update against the current file.
- Sidebar view of drifted comments across the workspace, sorted by severity, with a cancellable **Scan Workspace**.
- Status bar count for the current file, and optional Problems panel entries.
- Refreshes on save, branch switches, commits, and settings changes.
- Settings: `threshold`, `maxScopeLines`, `showInProblems`, `exclude`, `maxFileSizeKB`.
