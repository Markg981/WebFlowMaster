// client/src/i18n.ts
import i18n, { type BackendModule, type ResourceLanguage } from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// English is bundled: it is the fallback for every missing key, so it is needed whatever the
// language. The others are fetched when chosen. All four used to be in the entry chunk, 618 KB
// that every first visit downloaded to use one of them.
import translationEN from './locales/en/translation.json';

const otherLanguages: Record<string, () => Promise<{ default: ResourceLanguage }>> = {
  it: () => import('./locales/it/translation.json'),
  fr: () => import('./locales/fr/translation.json'),
  de: () => import('./locales/de/translation.json'),
};

const lazyLocales: BackendModule = {
  type: 'backend',
  init() {},
  read(language, _namespace, callback) {
    const load = otherLanguages[language];
    if (!load) return callback(null, {});
    load().then((module) => callback(null, module.default), (error) => callback(error, false));
  },
};

i18n
  .use(LanguageDetector)
  .use(lazyLocales)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: translationEN } },
    // Bundled English plus the backend for the rest.
    partialBundledLanguages: true,
    fallbackLng: 'en',
    // It logged every initialisation and language change to every user's console.
    debug: import.meta.env.DEV,
    interpolation: {
      escapeValue: false, // React already safes from xss
    },
  });

export default i18n;
