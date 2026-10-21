import { createHash } from 'node:crypto';

/**
 * Identifies a dismissal. Line numbers are deliberately excluded so dismissals
 * survive code moving; changing the comment text or committing to its scope
 * produces a new key, so the warning comes back.
 */
export function dismissalKey(
  file: string,
  normalizedCommentText: string,
  newestScopeCommitSha: string,
): string {
  const hash = createHash('sha1').update(normalizedCommentText).digest('hex');
  return `${file}::${hash}::${newestScopeCommitSha}`;
}
