import { describe, expect, it } from 'vitest';
import { forEachLimited } from '../../src/core/concurrency';

const tick = () => new Promise((r) => setTimeout(r, 1));

describe('forEachLimited', () => {
  it('processes every item with at most `limit` in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await forEachLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      peak = Math.max(peak, ++inFlight);
      await tick();
      seen.push(n);
      inFlight--;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });

  it('stops starting new items once shouldStop is true', async () => {
    const seen: number[] = [];
    await forEachLimited(
      [1, 2, 3, 4, 5, 6],
      2,
      async (n) => {
        seen.push(n);
        await tick();
      },
      () => seen.length >= 3,
    );
    expect(seen).toEqual([1, 2, 3]);
  });

  it('handles an empty list', async () => {
    await expect(forEachLimited([], 4, async () => {})).resolves.toBeUndefined();
  });
});
