import { describe, expect, it } from 'vitest';
import { relativeTime } from '../../src/core/format';

const now = Date.UTC(2024, 5, 1);
const ago = (seconds: number) => relativeTime(now / 1000 - seconds, now);

describe('relativeTime', () => {
  it.each([
    [10, 'just now'],
    [90, '2 minutes ago'],
    [3 * 3600, '3 hours ago'],
    [86400, 'yesterday'],
    [3 * 86400, '3 days ago'],
    [14 * 86400, '2 weeks ago'],
    [90 * 86400, '3 months ago'],
    [400 * 86400, 'last year'],
    [3 * 365 * 86400, '3 years ago'],
  ])('%i seconds ago -> %s', (seconds, expected) => {
    expect(ago(seconds)).toBe(expected);
  });
});
