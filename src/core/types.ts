export interface CommitInfo {
  sha: string;
  committerTime: number; // unix seconds
  author: string;
  summary: string;
}

export interface BlameLine {
  line: number; // 0-based final line number
  commit: CommitInfo;
  uncommitted: boolean;
}

export interface CommentBlock {
  startLine: number; // 0-based, inclusive
  endLine: number; // 0-based, inclusive
  indent: number;
  text: string; // normalized text, markers stripped
}

export interface Scope {
  startLine: number;
  endLine: number;
  source: 'symbol' | 'heuristic';
}

export type Severity = 'low' | 'medium' | 'high';

export interface DriftItem {
  id: string; // dismissal key
  file: string; // repo-relative path, forward slashes
  repoRoot: string;
  comment: CommentBlock;
  scope: Scope;
  commentCommit: CommitInfo;
  newerCommits: CommitInfo[]; // sorted newest first
  score: number;
  severity: Severity;
}
