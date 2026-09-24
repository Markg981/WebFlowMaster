import { describe, expect, it } from 'vitest';

import de from './de/translation.json';
import en from './en/translation.json';
import fr from './fr/translation.json';
import italian from './it/translation.json';

/**
 * Guards on the translation bundles themselves.
 *
 * Three of these files shipped with 982 values that read `[TRANSLATE] Total Tests` — the
 * marker a bulk import leaves behind for a human to come back to. Nobody came back, so the
 * marker rendered: the login page showed `[TRANSLATE] Username` next to the field. It is
 * invisible to a type check, to lint and to every component test, because a locale file is
 * just data — which is exactly why it survived so long.
 *
 * A second, quieter version of the same problem: French and German were missing 180 keys
 * that English had. i18next falls back to English for a missing key, so nothing breaks and
 * nothing complains — the settings page and the whole action palette simply appeared in
 * English to a French user, and no test noticed.
 */

type Bundle = Record<string, unknown>;

const BUNDLES: Array<[string, Bundle]> = [
  ['en', en as Bundle],
  ['it', italian as Bundle],
  ['fr', fr as Bundle],
  ['de', de as Bundle],
];

/** Flatten to dotted paths, the form i18next looks keys up by. */
function flatten(node: Bundle, prefix = ''): Array<[string, string]> {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = `${prefix}${key}`;
    if (value !== null && typeof value === 'object') {
      return flatten(value as Bundle, `${path}.`);
    }
    return typeof value === 'string' ? [[path, value] as [string, string]] : [];
  });
}

const flat = new Map(BUNDLES.map(([lang, bundle]) => [lang, new Map(flatten(bundle))]));
const english = flat.get('en')!;

describe.each(BUNDLES.map(([lang]) => lang))('%s translation bundle', (lang) => {
  const bundle = flat.get(lang)!;

  it('carries no untranslated placeholder', () => {
    const marked = [...bundle].filter(([, value]) => value.includes('[TRANSLATE]'));
    expect(marked.map(([key]) => key)).toEqual([]);
  });

  it('has no blank values', () => {
    const blank = [...bundle].filter(([, value]) => value.trim() === '');
    expect(blank.map(([key]) => key)).toEqual([]);
  });

  it('writes nested keys as nesting, not as a dotted name', () => {
    // i18next resolves both `{"a": {"b": …}}` and `{"a.b": …}`, so the two forms coexisted
    // here — until a new `testSuitesPage.description` string was written on top of an
    // existing `testSuitesPage.description.label` and neither the writer nor i18next said
    // anything. One form removes that collision entirely.
    const dotted: string[] = [];
    const walk = (node: Bundle, prefix = '') => {
      for (const [key, value] of Object.entries(node)) {
        if (key.includes('.')) dotted.push(`${prefix}${key}`);
        if (value !== null && typeof value === 'object') walk(value as Bundle, `${prefix}${key}.`);
      }
    };
    walk(BUNDLES.find(([name]) => name === lang)![1]);
    expect(dotted).toEqual([]);
  });

  it('covers every key English has', () => {
    const missing = [...english.keys()].filter((key) => !bundle.has(key));
    expect(missing).toEqual([]);
  });

  it('keeps the interpolation placeholders English uses', () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort();

    const drifted = [...english]
      .map(([key, source]) => ({ key, source, translated: bundle.get(key) }))
      .filter(({ translated }) => translated !== undefined)
      .filter(
        ({ source, translated }) =>
          placeholders(source).join(',') !== placeholders(translated!).join(','),
      )
      .map(({ key, source, translated }) => `${key}: "${source}" -> "${translated}"`);

    expect(drifted).toEqual([]);
  });
});

/**
 * Keys the code asks for that no bundle has.
 *
 * The checks above compare the bundles with each other, so a key that is in none of them passes
 * all of them: `t('key', 'English text')` renders its inline English in every language and nothing
 * complains. That is how the plan's whole Run settings window came to be English for everybody.
 *
 * Every literal key in the code must be in English, and so, by the checks above, in the other
 * three. When this guard arrived, 290 keys across 28 files were in none of them.
 */
describe('keys used in the code', () => {
  const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  const used = new Map<string, string>();
  for (const [file, source] of Object.entries(sources)) {
    for (const match of source.matchAll(/\bt\(\s*(['"])([\w-]+(?:\.[\w-]+)+)\1/g)) {
      if (!used.has(match[2])) used.set(match[2], file);
    }
  }
  // A key called with a count may exist only in its plural forms, which i18next picks from.
  const inEnglish = (key: string) => english.has(key) || english.has(`${key}_one`) || english.has(`${key}_other`);

  it('finds the calls it is meant to check', () => {
    expect(used.get('editTestPlanSettings.runOn.label')).toMatch(/EditTestPlanSettingsModal\.tsx$/);
  });

  it('are all in the English bundle', () => {
    const missing = [...used]
      .filter(([key]) => !inEnglish(key))
      .map(([key, file]) => `${key} (${file})`);
    expect(missing).toEqual([]);
  });
});
