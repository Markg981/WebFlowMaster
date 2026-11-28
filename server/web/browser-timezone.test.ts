import { describe, expect, it } from 'vitest';
import { browserTimezone, skewMinutes, SKEW_ZONES } from './browser-timezone';

const dayIn = (zone: string, at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

describe('browserTimezone', () => {
  it('leaves the browser zone alone when unset', () => {
    expect(browserTimezone(undefined)).toBeUndefined();
    expect(browserTimezone('  ')).toBeUndefined();
  });

  it('takes a plain IANA zone and refuses a name it does not know', () => {
    expect(browserTimezone('Asia/Karachi')).toBe('Asia/Karachi');
    expect(() => browserTimezone('Mars/Olympus')).toThrow(/not a time zone/);
    expect(() => browserTimezone('skew:Nowhere/City')).toThrow(/not a time zone/);
  });

  it('skew: at every hour of the day the browser is on another date than the server (D-059: server UTC+5)', () => {
    for (let h = 0; h < 24; h++) {
      for (const min of [0, 30]) {
        const at = new Date(Date.UTC(2026, 10, 28, h, min));
        const zone = browserTimezone('skew:Asia/Karachi', at);
        expect(zone, `${h}:${min} UTC`).toBeDefined();
        expect(SKEW_ZONES).toContain(zone);
        expect(dayIn(zone!, at), `${h}:${min} UTC`).not.toBe(dayIn('Asia/Karachi', at));
      }
    }
  });

  it('skew: picks the zone that stays on another date longest (a run lasts more than an hour)', () => {
    const at = new Date(Date.UTC(2026, 10, 28, 9, 0));
    const zone = browserTimezone('skew:Asia/Karachi', at)!;
    const other = SKEW_ZONES.find((z) => z !== zone)!;
    expect(skewMinutes(zone, 'Asia/Karachi', at)).toBeGreaterThanOrEqual(skewMinutes(other, 'Asia/Karachi', at));
    expect(skewMinutes(zone, 'Asia/Karachi', at)).toBeGreaterThanOrEqual(60);
  });
});
