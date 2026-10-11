import { describe, it, expect, vi } from 'vitest';
import translationEN from './locales/en/translation.json';
import translationIT from './locales/it/translation.json';

/**
 * The application's own i18n setup (i18n.ts), not the English-only instance setupTests.ts
 * builds: English bundled, the other languages fetched by a backend when chosen. Nothing else
 * runs that backend, so an i18next or react-i18next upgrade that broke it would only show in the
 * browser, as untranslated keys.
 */
type Tree = { [key: string]: string | Tree };

/** A key whose Italian text differs from the English one, so the assertion proves which bundle answered. */
function differingKey(en: Tree, it: Tree, prefix = ''): string | null {
  for (const [key, value] of Object.entries(it)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const other = en[key];
    if (typeof value === 'string') {
      if (typeof other === 'string' && other !== value && !value.includes('{{')) return path;
    } else if (other && typeof other === 'object') {
      const found = differingKey(other, value, path);
      if (found) return found;
    }
  }
  return null;
}

describe('the application translations', () => {
  it('bundle English and fetch Italian when it is chosen', async () => {
    vi.resetModules();
    const { default: i18n } = await import('./i18n');
    const key = differingKey(translationEN as Tree, translationIT as Tree);
    expect(key).not.toBeNull();

    await i18n.changeLanguage('en');
    expect(i18n.hasResourceBundle('it', 'translation')).toBe(false);
    const english = i18n.t(key!);

    await i18n.changeLanguage('it');
    expect(i18n.hasResourceBundle('it', 'translation')).toBe(true);
    expect(i18n.t(key!)).not.toBe(english);
    expect(i18n.t(key!)).toBe(key!.split('.').reduce<unknown>((node, part) => (node as Tree)[part], translationIT));
  });

  it('fall back to English for a language it does not have', async () => {
    vi.resetModules();
    const { default: i18n } = await import('./i18n');
    const key = differingKey(translationEN as Tree, translationIT as Tree)!;
    await i18n.changeLanguage('pt');
    expect(i18n.t(key)).toBe(key.split('.').reduce<unknown>((node, part) => (node as Tree)[part], translationEN));
  });
});
