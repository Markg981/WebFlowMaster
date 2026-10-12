import { describe, expect, it } from 'vitest';
import { format } from 'date-fns';
import { dateFnsLocale, formatDate, formatDateTime, formatInZone, formatTime } from './dates';

const moment = new Date(Date.UTC(2026, 9, 11, 13, 4, 0)); // 2026-10-11T13:04:00Z

describe('formatDateTime', () => {
  it('follows the language asked for, not the machine', () => {
    expect(formatDateTime(moment, 'en')).toMatch(/Oct 11, 2026/);
    expect(formatDateTime(moment, 'it')).toMatch(/11 ott 2026/);
    expect(formatDateTime(moment, 'fr')).toMatch(/11 oct\. 2026/);
    expect(formatDateTime(moment, 'de')).toMatch(/11\.10\.2026/);
  });

  it('reads a region tag by its language and falls back to English for the rest', () => {
    expect(formatDateTime(moment, 'it-IT')).toBe(formatDateTime(moment, 'it'));
    expect(formatDateTime(moment, 'pt-BR')).toBe(formatDateTime(moment, 'en'));
  });

  it('takes an ISO string or a timestamp as readily as a Date', () => {
    expect(formatDateTime(moment.toISOString(), 'en')).toBe(formatDateTime(moment, 'en'));
    expect(formatDateTime(moment.getTime(), 'en')).toBe(formatDateTime(moment, 'en'));
  });

  it('shows nothing for a value that is not a date, rather than "Invalid Date"', () => {
    expect(formatDateTime('not a date', 'en')).toBe('');
    expect(formatDate('', 'en')).toBe('');
    expect(formatTime(Number.NaN, 'en')).toBe('');
  });
});

describe('formatDate and formatTime', () => {
  it('are the two halves of formatDateTime', () => {
    const [date, time] = [formatDate(moment, 'en'), formatTime(moment, 'en')];
    expect(date).toMatch(/Oct 11, 2026/);
    expect(time).toMatch(/\d{1,2}:04/);
    expect(formatDateTime(moment, 'en')).toContain(date);
  });
});

describe('dateFnsLocale', () => {
  it('maps the four app languages and defaults to English', () => {
    expect(dateFnsLocale('it').code).toBe('it');
    expect(dateFnsLocale('fr').code).toBe('fr');
    expect(dateFnsLocale('de').code).toBe('de');
    expect(dateFnsLocale('en').code).toBe('en-US');
    expect(dateFnsLocale('xx').code).toBe('en-US');
    expect(format(moment, 'PPP', { locale: dateFnsLocale('it') })).toMatch(/ottobre/);
  });
});

describe('formatInZone', () => {
  it('reads on the wall clock of the zone, in the fixed technical form', () => {
    expect(formatInZone(moment, 'Europe/Rome')).toBe('2026-10-11 15:04');
    expect(formatInZone(moment, 'UTC')).toBe('2026-10-11 13:04');
    expect(formatInZone(moment, null)).toBe('2026-10-11 13:04');
  });

  it('falls back to UTC for a zone it does not know', () => {
    expect(formatInZone(moment, 'Mars/Olympus')).toBe('2026-10-11 13:04');
  });
});
