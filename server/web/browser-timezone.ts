/**
 * The browser's time zone for every session (WFM_BROWSER_TIMEZONE).
 *
 * A page that takes "today" from the browser while the system under test takes it from the server's zone only
 * differs for the hours in which the two zones are on different dates. A run that happens outside those hours
 * passes and hides the defect (DMO NetContent, D-059: the server in UTC+5, the browser in Rome, the date
 * windows differ only 19:00-24:00 UTC, so daytime comparisons were clean).
 *
 *   unset                      the browser's own zone, as before
 *   <IANA zone>                that zone, e.g. Asia/Karachi
 *   skew:<IANA server zone>    a zone whose date differs from the server's date now, and keeps differing longest:
 *                              any defect of that kind shows on every run, whatever the hour
 */

/** Candidates for skew: the two ends of the offsets, between them always one on another date than any zone. */
export const SKEW_ZONES = ['Etc/GMT-14', 'Etc/GMT+12'] as const;

const dayIn = (zone: string, at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** Whether a zone name is known to this runtime (Playwright takes the same IANA names). */
export function isZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Minutes from `at` during which `zone` stays on another date than `server` (0 when it is on the same date). */
export function skewMinutes(zone: string, server: string, at: Date): number {
  let m = 0;
  while (m < 24 * 60 && dayIn(zone, new Date(at.getTime() + m * 60_000)) !== dayIn(server, new Date(at.getTime() + m * 60_000))) m += 15;
  return m;
}

/** The zone a session's context is opened in, or undefined for the browser's own. Throws on a value it cannot use. */
export function browserTimezone(value: string | undefined = process.env.WFM_BROWSER_TIMEZONE, at: Date = new Date()): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (!v.startsWith('skew:')) {
    if (!isZone(v)) throw new Error(`WFM_BROWSER_TIMEZONE: "${v}" is not a time zone`);
    return v;
  }
  const server = v.slice('skew:'.length).trim();
  if (!isZone(server)) throw new Error(`WFM_BROWSER_TIMEZONE: "${server}" (after skew:) is not a time zone`);
  const best = SKEW_ZONES.map((zone) => ({ zone, minutes: skewMinutes(zone, server, at) })).sort((a, b) => b.minutes - a.minutes)[0];
  return best.minutes > 0 ? best.zone : undefined;
}
