// client/src/i18n.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector'; // Optional: for detecting browser language

// Import translation files
import translationEN from './locales/en/translation.json';
import translationIT from './locales/it/translation.json';

const resources = {
  en: {
    translation: translationEN,
  },
  it: {
    translation: translationIT,
  },
};

i18n
  .use(LanguageDetector) // Optional: see docs for configuration
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en', // use English if detected lng is not available
    debug: true, // Set to false in production
    interpolation: {
      escapeValue: false, // React already safes from xss
    },
    // detection: { // Optional: LanguageDetector options
    //   order: ['queryString', 'cookie', 'localStorage', 'sessionStorage', 'navigator', 'htmlTag', 'path', 'subdomain'],
    //   caches: ['cookie', 'localStorage'],
    // }
  });

export default i18n;
