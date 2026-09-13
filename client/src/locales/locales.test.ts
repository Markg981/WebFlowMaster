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
