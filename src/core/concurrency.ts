/**
 * Runs fn over items with at most `limit` calls in flight. Once shouldStop()
 * returns true, no new items are started; calls already running finish.
 */
export async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !shouldStop()) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
