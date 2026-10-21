import type { BlameLine, CommentBlock, CommitInfo, Scope, Severity } from './types';

export interface DriftScore {
  commentCommit: CommitInfo;
  newerCommits: CommitInfo[]; // sorted newest first
  score: number;
  severity: Severity;
}

export function severityFor(score: number, threshold: number): Severity | undefined {
  if (score < threshold) return undefined;
  if (score >= threshold * 4) return 'high';
  if (score >= threshold * 2) return 'medium';
  return 'low';
}

/**
 * Counts distinct commits that changed the scope after the comment was last
 * changed. Returns undefined when the comment isn't drifted, or when any comment
 * line is uncommitted (it's being edited right now).
 *
 * `blame` is indexed by line number, as returned by parseBlame.
 */
export function scoreDrift(
  blame: readonly (BlameLine | undefined)[],
  comment: CommentBlock,
  scope: Scope,
  threshold: number,
): DriftScore | undefined {
  let commentCommit: CommitInfo | undefined;
  for (let l = comment.startLine; l <= comment.endLine; l++) {
    const b = blame[l];
    if (!b || b.uncommitted) return undefined;
    if (!commentCommit || b.commit.committerTime > commentCommit.committerTime) {
      commentCommit = b.commit;
    }
  }
  if (!commentCommit) return undefined;

  const newer = new Map<string, CommitInfo>();
  for (let l = scope.startLine; l <= scope.endLine; l++) {
    const b = blame[l];
    if (b && !b.uncommitted && b.commit.committerTime > commentCommit.committerTime) {
      newer.set(b.commit.sha, b.commit);
    }
  }

  const score = newer.size;
  const severity = severityFor(score, threshold);
  if (!severity) return undefined;
  const newerCommits = [...newer.values()].sort((a, b) => b.committerTime - a.committerTime);
  return { commentCommit, newerCommits, score, severity };
}
