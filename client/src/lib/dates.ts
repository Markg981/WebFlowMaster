import i18n from 'i18next';
import type { Locale } from 'date-fns';
import { de, enUS, fr, it } from 'date-fns/locale';

/**
 * Dates as the app's language reads them, not the browser's.
 *
 * `new Date(x).toLocaleString()` and date-fns `format()` with no locale both follow the
 * browser, so someone using the app in Italian on an English-locale machine read every
 * timestamp as "10/11/2026, 3:04 PM" while the rest of the screen said "Report". Every
 * screen that shows a person a date goes through here, and the language is the one i18next
 * is running in — the same thing the words around the date follow.
 *
 * Technical renderings (ISO strings, the `sv-SE` wall-clock form a schedule is labelled
 * with) are not language-dependent and stay as they are.
 */

const DATE_FNS_LOCALES: Record<string, Locale> = { en: enUS, it, fr, de };

/** `it-IT` → `it`; anything we have no bundle for → `en`. */
function baseLanguage(language?: string): string {
  const tag = (language ?? i18n.language ?? 'en').toLowerCase();
  const base = tag.split('-')[0];
  return base in DATE_FNS_LOCALES ? base : 'en';
}

/** The date-fns locale for `format(date, pattern, { locale })`. */
export function dateFnsLocale(language?: string): Locale {
  return DATE_FNS_LOCALES[baseLanguage(language)];
}

function toDate(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function intlFormat(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions,
  language?: string,
): string {
  const date = toDate(value);
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat(baseLanguage(language), options).format(date);
  } catch {
    return date.toISOString();
  }
}

/** Date and time, e.g. "11 Oct 2026, 15:04" in English or "11 ott 2026, 15:04" in Italian. */
export function formatDateTime(value: Date | string | number, language?: string): string {
  return intlFormat(value, { dateStyle: 'medium', timeStyle: 'short' }, language);
}

/** The date alone, e.g. "11 Oct 2026". */
export function formatDate(value: Date | string | number, language?: string): string {
  return intlFormat(value, { dateStyle: 'medium' }, language);
}

/** The time alone, e.g. "15:04". */
export function formatTime(value: Date | string | number, language?: string): string {
  return intlFormat(value, { timeStyle: 'short' }, language);
}

/**
 * A moment as it reads on the wall clock of a given zone, in the fixed `YYYY-MM-DD HH:mm`
 * form. Language-independent on purpose: it sits next to the zone's name and is meant to be
 * compared with a cron expression, not read as prose.
 */
export function formatInZone(value: Date | string | number, timeZone?: string | null): string {
  const date = toDate(value);
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .format(date)
      .replace(',', '');
  } catch {
    // An unknown zone should not blank the row; show UTC and let the label say what it is.
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}
