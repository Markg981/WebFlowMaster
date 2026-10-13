/**
 * Contextual help: the documentation section that explains the page the user is on.
 *
 * The manual is built with the application and served by it at DOCS_BASE (server/docs-site.ts),
 * so every installation links to the pages of its own version, air-gapped ones included.
 *
 * Anchors are per language because VitePress derives them from the translated headings
 * ("#suites", "#suite", …). scripts/help-links.test.ts checks every page and anchor below
 * against the Markdown sources, so renaming a heading fails a test, not a user's click.
 */

export const DOCS_BASE = '/docs/';

export const DOC_LANGUAGES = ['en', 'it', 'fr', 'de'] as const;
export type DocLanguage = (typeof DOC_LANGUAGES)[number];

export type HelpTopic = {
  /** Matched against the path, first match wins: specific routes before their prefixes. */
  route: RegExp;
  /** Page under docs/<language>/, without extension. */
  page: string;
  /** Section anchor in each language; a page without anchors opens at the top. */
  anchors?: Record<DocLanguage, string>;
};

export const HELP_TOPICS: HelpTopic[] = [
  { route: /^\/dashboard\/create-test/, page: 'guide/web-tests' },
  { route: /^\/dashboard\/api-tester/, page: 'guide/api-tests' },
  {
    route: /^\/dashboard/,
    page: 'guide/results',
    anchors: { en: 'dashboard', it: 'dashboard', fr: 'tableau-de-bord', de: 'ubersicht' },
  },
  {
    route: /^\/scheduling/,
    page: 'guide/running',
    anchors: { en: 'scheduling', it: 'pianificazione', fr: 'planification', de: 'zeitplanung' },
  },
  {
    route: /^\/test-plans\/[^/]+\/executions\/[^/]+\/report/,
    page: 'guide/results',
    anchors: {
      en: 'a-run-s-report',
      it: 'il-report-di-un-run',
      fr: 'le-rapport-d-une-execution',
      de: 'der-bericht-eines-laufs',
    },
  },
  {
    route: /^\/test-plan\/[^/]+\/run/,
    page: 'guide/running',
    anchors: {
      en: 'running-now',
      it: 'eseguire-subito',
      fr: 'executer-maintenant',
      de: 'jetzt-ausfuhren',
    },
  },
  {
    route: /^\/test-plans/,
    page: 'guide/running',
    anchors: {
      en: 'creating-a-plan',
      it: 'creare-un-piano',
      fr: 'creer-un-plan',
      de: 'einen-plan-anlegen',
    },
  },
  {
    route: /^\/suites/,
    page: 'guide/organizing',
    anchors: { en: 'suites', it: 'suite', fr: 'suites', de: 'suites' },
  },
  {
    route: /^\/requirements/,
    page: 'guide/organizing',
    anchors: { en: 'requirements', it: 'requisiti', fr: 'requirements', de: 'requirements' },
  },
  {
    route: /^\/test-data/,
    page: 'guide/organizing',
    anchors: { en: 'test-data', it: 'test-data', fr: 'test-data', de: 'test-data' },
  },
  { route: /^\/mobile-tests/, page: 'guide/mobile-apps' },
  { route: /^\/load-tests/, page: 'guide/load-tests' },
  {
    route: /^\/test-manager/,
    page: 'guide/organizing',
    anchors: {
      en: 'test-manager',
      it: 'test-manager',
      fr: 'gestionnaire-de-tests',
      de: 'testmanager',
    },
  },
  {
    route: /^\/tests/,
    page: 'guide/organizing',
    anchors: {
      en: 'the-test-library',
      it: 'la-libreria-dei-test',
      fr: 'la-bibliotheque-de-tests',
      de: 'die-testbibliothek',
    },
  },
  {
    route: /^\/reviews/,
    page: 'guide/organizing',
    anchors: {
      en: 'publishing-and-reviews',
      it: 'pubblicazione-e-revisioni',
      fr: 'publishing-and-reviews',
      de: 'publishing-and-reviews',
    },
  },
  {
    route: /^\/reports/,
    page: 'guide/results',
    anchors: { en: 'reports', it: 'report', fr: 'rapports', de: 'berichte' },
  },
  {
    route: /^\/settings/,
    page: 'guide/index',
    anchors: {
      en: 'personal-settings',
      it: 'impostazioni-personali',
      fr: 'parametres-personnels',
      de: 'personliche-einstellungen',
    },
  },
  { route: /^\/whats-new/, page: 'reference/changelog' },
];

/**
 * The languages a page is written in. The user guide and "Start here" exist in all four;
 * administration, reference and internals only in English and Italian (see docs/fr/index.md).
 */
export function pageLanguages(page: string): readonly DocLanguage[] {
  return page.startsWith('guide/') || page.startsWith('start/') ? DOC_LANGUAGES : ['en', 'it'];
}

function docLanguage(language: string | undefined): DocLanguage {
  const short = (language ?? 'en').slice(0, 2).toLowerCase();
  return (DOC_LANGUAGES as readonly string[]).includes(short) ? (short as DocLanguage) : 'en';
}

/**
 * The documentation address for a path, in the user's language when the page exists in it
 * and in English otherwise. Pages with no topic of their own open the user guide.
 */
export function helpUrl(path: string, language: string | undefined): string {
  const topic = HELP_TOPICS.find((t) => t.route.test(path));
  const wanted = docLanguage(language);
  const page = topic?.page ?? 'guide/';
  const lang = pageLanguages(page).includes(wanted) ? wanted : 'en';
  const anchor = topic?.anchors?.[lang];
  return `${DOCS_BASE}${lang}/${page}${anchor ? `#${anchor}` : ''}`;
}
