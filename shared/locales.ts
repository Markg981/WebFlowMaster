/**
 * The languages a plan runs its tests in.
 *
 * A plan can name locales the way it names browsers, and every test then runs once per locale:
 * the browser is started in that language (`navigator.language`, the Accept-Language header,
 * number and date formats), and `{{locale}}` holds it for the steps that expect a translated
 * text. None named is what every plan did before: the browser's own default.
 */

/** BCP 47, the shapes people write: "it", "it-IT", "zh-Hant", "zh-Hant-TW". */
export const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?$/;

/** A run multiplies by this; a matrix of twenty languages is a request nobody meant to make. */
export const MAX_LOCALES = 10;

/** The variable a test reads its locale from. */
export const LOCALE_VARIABLE = "locale";

/**
 * Tidies what a plan stored or a request sent: "it_it" and " IT-it " both mean "it-IT".
 * Invalid entries are dropped and duplicates kept once, in the order given.
 */
export function normalizeLocales(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const locale = canonicalLocale(entry);
    if (locale && !out.includes(locale)) out.push(locale);
    if (out.length === MAX_LOCALES) break;
  }
  return out;
}

export function canonicalLocale(raw: string): string | null {
  const parts = raw.trim().replace(/_/g, "-").split("-").filter(Boolean);
  if (parts.length === 0) return null;
  const [language, ...rest] = parts;
  const shaped = [
    language.toLowerCase(),
    ...rest.map((part) =>
      part.length === 4 ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part.toUpperCase(),
    ),
  ].join("-");
  return LOCALE_PATTERN.test(shaped) ? shaped : null;
}

/** What a result row says it ran on: "chromium · it-IT", or just the locale on the default browser. */
export function passLabel(browser: string | null | undefined, locale: string | null | undefined): string | null {
  if (!locale) return browser ?? null;
  return browser ? `${browser} · ${locale}` : locale;
}
