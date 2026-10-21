import { describe, expect, it } from 'vitest';
import { dismissalKey } from '../../src/core/dismissalKey';

describe('dismissalKey', () => {
  const key = dismissalKey('src/a.ts', 'Adds two numbers.', 'abc123');

  it('combines path, comment hash, and newest scope sha', () => {
    expect(key).toMatch(/^src\/a\.ts::[0-9a-f]{40}::abc123$/);
  });

  it('is stable for the same text, wherever the comment sits', () => {
    expect(dismissalKey('src/a.ts', 'Adds two numbers.', 'abc123')).toBe(key);
  });

  it('changes when the comment text changes', () => {
    expect(dismissalKey('src/a.ts', 'Adds numbers.', 'abc123')).not.toBe(key);
  });

  it('changes when the scope gets a newer commit', () => {
    expect(dismissalKey('src/a.ts', 'Adds two numbers.', 'def456')).not.toBe(key);
  });
});
