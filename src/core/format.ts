const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['week', 7 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];
const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "3 days ago", "last year", ... for a unix timestamp in seconds. */
export function relativeTime(unixSeconds: number, nowMs = Date.now()): string {
  const diff = unixSeconds - nowMs / 1000;
  for (const [unit, seconds] of UNITS) {
    // Round the magnitude: Math.round(-1.5) is -1, which would skew past times.
    const count = Math.sign(diff) * Math.round(Math.abs(diff) / seconds);
    if (Math.abs(diff) >= seconds) return formatter.format(count, unit);
  }
  return 'just now';
}
