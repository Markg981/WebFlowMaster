import { defineConfig, type DefaultTheme } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

/**
 * The documentation site: `npm run docs:dev` to write, `npm run docs:build` to check and build.
 *
 * English and Italian live side by side in docs/en and docs/it, page for page. French and German
 * (docs/fr, docs/de) carry the user guide only (the home page, the paths by role and the guide)
 * and send the reader to the English pages for administration, security, reference and internals.
 * The build fails on a dead link, which is the point of building it in the verification: a page
 * that names another page that was renamed is found here rather than by a reader.
 */

type Labels = {
  guide: string;
  gettingStarted: string;
  webTests: string;
  apiTests: string;
  mobileApps: string;
  organizing: string;
  running: string;
  results: string;
  security: string;
  securityOverview: string;
  dataProtection: string;
  hardening: string;
  admin: string;
  installation: string;
  operations: string;
  configuration: string;
  administration: string;
  internals: string;
  integrations: string;
  overview: string;
  architecture: string;
  tenancy: string;
  execution: string;
  dataModel: string;
  agents: string;
  frontend: string;
  developer: string;
  decisions: string;
  glossary: string;
  ci: string;
  localAgents: string;
  reference: string;
  restApi: string;
  cli: string;
  glance: string;
  testLab: string;
  systemArchitecture: string;
  classDiagrams: string;
  databaseSchema: string;
  sequences: string;
  mobileInternals: string;
};

function sidebar(lang: 'en' | 'it', t: Labels): DefaultTheme.SidebarItem[] {
  const p = (page: string) => `/${lang}/${page}`;
  return [
    { text: t.glance, link: p('overview') },
    {
      text: lang === 'en' ? 'Start here' : 'Da dove iniziare',
      items: [
        { text: lang === 'en' ? 'Paths by role' : 'Percorsi per ruolo', link: p('start/') },
        {
          text: lang === 'en' ? 'Tester: first test in 10 minutes' : 'Test: il primo in 10 minuti',
          link: p('start/qa'),
        },
        {
          text:
            lang === 'en'
              ? 'DevOps: first run from a pipeline'
              : 'DevOps: il primo run da pipeline',
          link: p('start/devops'),
        },
        {
          text:
            lang === 'en'
              ? 'Admin: first organization with SSO'
              : 'Admin: la prima organizzazione con SSO',
          link: p('start/admin'),
        },
      ],
    },
    {
      text: t.guide,
      items: [
        { text: t.gettingStarted, link: p('guide/') },
        { text: t.webTests, link: p('guide/web-tests') },
        { text: t.apiTests, link: p('guide/api-tests') },
        { text: lang === 'it' ? 'Test di carico' : 'Load tests', link: p('guide/load-tests') },
        { text: 'BDD / Cucumber', link: p('guide/bdd-tests') },
        { text: lang === 'it' ? 'File Gherkin' : 'Gherkin files', link: p('guide/gherkin-files') },
        { text: t.mobileApps, link: p('guide/mobile-apps') },
        { text: t.organizing, link: p('guide/organizing') },
        {
          text: lang === 'en' ? 'Exporting to Playwright' : 'Esportazione in Playwright',
          link: p('guide/playwright-export'),
        },
        {
          text: lang === 'en' ? 'Conversations and dashboards' : 'Conversazioni e dashboard',
          link: p('guide/collaboration'),
        },
        { text: t.running, link: p('guide/running') },
        { text: t.results, link: p('guide/results') },
      ],
    },
    {
      text: t.admin,
      items: [
        { text: t.installation, link: p('admin/installation') },
        {
          text: lang === 'en' ? 'Shared SaaS network' : 'Rete SaaS condiviso',
          link: p('admin/saas-network'),
        },
        { text: t.operations, link: p('admin/operations') },
        {
          text: lang === 'it' ? 'Carico prolungato' : 'Endurance testing',
          link: p('admin/load-testing'),
        },
        {
          text: lang === 'it' ? 'Release riproducibili' : 'Reproducible releases',
          link: p('admin/releases'),
        },
        {
          text: lang === 'it' ? 'Pilot e decisione di adozione' : 'Pilot and adoption decision',
          link: p('admin/pilot'),
        },
        {
          text:
            lang === 'en' ? 'Metrics and distributed tracing' : 'Metriche e tracing distribuito',
          link: p('admin/telemetry'),
        },
        { text: t.configuration, link: p('admin/configuration') },
        { text: t.administration, link: p('admin/administration') },
        { text: t.testLab, link: p('admin/test-lab') },
      ],
    },
    {
      text: t.security,
      items: [
        { text: t.securityOverview, link: p('security/') },
        { text: t.dataProtection, link: p('security/data-protection') },
        { text: t.hardening, link: p('security/hardening') },
      ],
    },
    {
      text: t.integrations,
      items: [
        { text: t.ci, link: p('integrations/ci') },
        { text: t.localAgents, link: p('integrations/local-agents') },
      ],
    },
    {
      text: t.reference,
      items: [
        { text: t.restApi, link: p('reference/api') },
        {
          text: lang === 'en' ? 'API endpoints (generated)' : 'Endpoint dell’API (generati)',
          link: p('reference/api-endpoints'),
        },
        { text: t.cli, link: p('reference/cli') },
        {
          text: lang === 'en' ? 'Release notes' : 'Note di rilascio',
          link: p('reference/changelog'),
        },
      ],
    },
    {
      text: t.internals,
      items: [
        {
          text: lang === 'en' ? 'Complete suite handbook' : 'Manuale dell’intera suite',
          link: p('internals/suite-handbook'),
        },
        { text: t.overview, link: p('internals/') },
        { text: t.systemArchitecture, link: p('internals/system-architecture') },
        { text: t.classDiagrams, link: p('internals/class-diagrams') },
        { text: t.databaseSchema, link: p('internals/database-schema') },
        {
          text: lang === 'en' ? 'All tables and columns' : 'Tutte le tabelle e colonne',
          link: p('internals/schema-catalog'),
        },
        { text: t.sequences, link: p('internals/sequences') },
        { text: t.mobileInternals, link: p('internals/mobile') },
        { text: t.tenancy, link: p('internals/tenancy') },
        { text: t.execution, link: p('internals/execution') },
        { text: t.dataModel, link: p('internals/data-model') },
        { text: t.agents, link: p('internals/agents') },
        { text: t.frontend, link: p('internals/frontend') },
        { text: t.developer, link: p('internals/developer-guide') },
        {
          text: lang === 'en' ? 'Implementing an improvement' : 'Implementare un miglioramento',
          link: p('internals/contributing-guide'),
        },
        {
          text:
            lang === 'en'
              ? 'Product and documentation audit'
              : 'Audit del prodotto e della documentazione',
          link: p('internals/product-audit'),
        },
        { text: t.decisions, link: p('internals/decisions') },
        { text: t.glossary, link: p('internals/glossary') },
      ],
    },
  ];
}

/** The user guide in a language that has only that part: French and German. */
type GuideLabels = {
  glance: string;
  start: string;
  paths: string;
  qa: string;
  devops: string;
  admin: string;
  guide: string;
  gettingStarted: string;
  webTests: string;
  apiTests: string;
  loadTests: string;
  gherkinFiles: string;
  mobileApps: string;
  organizing: string;
  collaboration: string;
  running: string;
  results: string;
  english: string;
  installAdmin: string;
  security: string;
  integrations: string;
  reference: string;
  releaseNotes: string;
  internals: string;
};

function guideSidebar(lang: 'fr' | 'de', t: GuideLabels): DefaultTheme.SidebarItem[] {
  const p = (page: string) => `/${lang}/${page}`;
  return [
    {
      text: t.start,
      items: [
        { text: t.paths, link: p('start/') },
        { text: t.qa, link: p('start/qa') },
        { text: t.devops, link: p('start/devops') },
        { text: t.admin, link: p('start/admin') },
      ],
    },
    {
      text: t.guide,
      items: [
        { text: t.gettingStarted, link: p('guide/') },
        { text: t.webTests, link: p('guide/web-tests') },
        { text: t.apiTests, link: p('guide/api-tests') },
        { text: t.loadTests, link: p('guide/load-tests') },
        { text: 'BDD / Cucumber', link: p('guide/bdd-tests') },
        { text: t.gherkinFiles, link: p('guide/gherkin-files') },
        { text: t.mobileApps, link: p('guide/mobile-apps') },
        { text: t.organizing, link: p('guide/organizing') },
        { text: t.collaboration, link: p('guide/collaboration') },
        { text: t.running, link: p('guide/running') },
        { text: t.results, link: p('guide/results') },
      ],
    },
    // The rest of the documentation exists in English (and Italian) only.
    {
      text: t.english,
      collapsed: true,
      items: [
        { text: t.glance, link: '/en/overview' },
        { text: t.installAdmin, link: '/en/admin/installation' },
        { text: t.security, link: '/en/security/' },
        { text: t.integrations, link: '/en/integrations/ci' },
        { text: t.reference, link: '/en/reference/api' },
        { text: t.releaseNotes, link: '/en/reference/changelog' },
        { text: t.internals, link: '/en/internals/' },
      ],
    },
  ];
}

const fr: GuideLabels = {
  glance: 'En bref',
  start: 'Par où commencer',
  paths: 'Parcours par rôle',
  qa: 'Testeur : le premier test en 10 minutes',
  devops: 'DevOps : la première exécution depuis un pipeline',
  admin: 'Admin : la première organisation avec SSO',
  guide: 'Guide utilisateur',
  gettingStarted: 'Premiers pas',
  webTests: 'Tests web',
  apiTests: 'Tests API',
  loadTests: 'Tests de charge',
  gherkinFiles: 'Fichiers Gherkin',
  mobileApps: 'Applications mobiles',
  organizing: 'Organiser les tests',
  collaboration: 'Conversations et tableaux de bord',
  running: 'Exécuter les tests',
  results: 'Résultats',
  english: 'Documentation de référence (en anglais)',
  installAdmin: 'Installation et administration',
  security: 'Sécurité et conformité',
  integrations: 'Intégrations',
  reference: 'Référence de l’API',
  releaseNotes: 'Notes de version',
  internals: 'Fonctionnement interne',
};

const de: GuideLabels = {
  glance: 'Auf einen Blick',
  start: 'Hier beginnen',
  paths: 'Wege nach Rolle',
  qa: 'Tester: der erste Test in 10 Minuten',
  devops: 'DevOps: der erste Lauf aus einer Pipeline',
  admin: 'Admin: die erste Organisation mit SSO',
  guide: 'Benutzerhandbuch',
  gettingStarted: 'Einstieg',
  webTests: 'Webtests',
  apiTests: 'API-Tests',
  loadTests: 'Lasttests',
  gherkinFiles: 'Gherkin-Dateien',
  mobileApps: 'Mobile Apps',
  organizing: 'Tests organisieren',
  collaboration: 'Gespräche und Dashboards',
  running: 'Tests ausführen',
  results: 'Ergebnisse',
  english: 'Referenzdokumentation (auf Englisch)',
  installAdmin: 'Installation und Verwaltung',
  security: 'Sicherheit und Compliance',
  integrations: 'Integrationen',
  reference: 'API-Referenz',
  releaseNotes: 'Versionshinweise',
  internals: 'Interna',
};

const en: Labels = {
  guide: 'User guide',
  gettingStarted: 'Getting started',
  webTests: 'Web tests',
  apiTests: 'API tests',
  mobileApps: 'Mobile apps',
  organizing: 'Organizing tests',
  running: 'Running tests',
  results: 'Results',
  security: 'Security and compliance',
  securityOverview: 'Security overview',
  dataProtection: 'Data protection',
  hardening: 'Hardening checklist',
  admin: 'Install and administer',
  installation: 'Installation',
  operations: 'Operations',
  configuration: 'Configuration reference',
  administration: 'Administration',
  internals: 'Internals',
  integrations: 'Integrations',
  overview: 'Architecture overview',
  architecture: 'Architecture',
  tenancy: 'Tenancy and access',
  execution: 'Run lifecycle',
  dataModel: 'Data model',
  agents: 'Local agents (internals)',
  frontend: 'Web client',
  developer: 'Developer guide',
  decisions: 'Decision records',
  glossary: 'Glossary',
  ci: 'CI integration',
  localAgents: 'Local agents',
  reference: 'Reference',
  restApi: 'REST API',
  cli: 'wfm command line',
  glance: 'At a glance',
  testLab: 'Test lab',
  systemArchitecture: 'System architecture',
  classDiagrams: 'Class diagrams',
  databaseSchema: 'Database schema',
  sequences: 'Sequence diagrams',
  mobileInternals: 'Mobile subsystem',
};

const it: Labels = {
  guide: 'Guida utente',
  gettingStarted: 'Primi passi',
  webTests: 'Test web',
  apiTests: 'Test API',
  mobileApps: 'App mobili',
  organizing: 'Organizzare i test',
  running: 'Eseguire i test',
  results: 'Risultati',
  security: 'Sicurezza e compliance',
  securityOverview: 'Panoramica sulla sicurezza',
  dataProtection: 'Protezione dei dati',
  hardening: 'Checklist di hardening',
  admin: 'Installazione e amministrazione',
  installation: 'Installazione',
  operations: 'Operatività',
  configuration: 'Riferimento della configurazione',
  administration: 'Amministrazione',
  internals: 'Interni',
  integrations: 'Integrazioni',
  overview: "Panoramica dell'architettura",
  architecture: 'Architettura',
  tenancy: 'Tenancy e accessi',
  execution: 'Ciclo di vita di un run',
  dataModel: 'Modello dati',
  agents: 'Agenti locali (interni)',
  frontend: 'Client web',
  developer: 'Guida sviluppatore',
  decisions: 'Registro delle decisioni',
  glossary: 'Glossario',
  ci: 'Integrazione CI',
  localAgents: 'Agenti locali',
  reference: 'Riferimento',
  restApi: 'API REST',
  cli: 'Riga di comando wfm',
  glance: 'In breve',
  testLab: 'Ambiente di collaudo',
  systemArchitecture: 'Architettura di sistema',
  classDiagrams: 'Diagrammi delle classi',
  databaseSchema: 'Schema del database',
  sequences: 'Diagrammi di sequenza',
  mobileInternals: 'Sottosistema mobile',
};

export default withMermaid(
  defineConfig({
    title: 'WebFlowMaster',
    description: 'Documentation for WebFlowMaster, the test automation platform.',
    cleanUrls: true,
    // `npm run build:docs` builds the copy the application serves under /docs/ (server/static.ts),
    // which the "?" in the top bar links to; docs:dev, docs:build and the PDFs keep the root.
    base: process.env.WFM_DOCS_BASE || '/',
    outDir: process.env.WFM_DOCS_OUT_DIR || undefined,
    // That copy goes into the release image, which must rebuild bit for bit (admin/releases). The
    // local search index lists pages in the order they finish indexing, which with parallel
    // indexing differs on every build, and so does every hash that depends on it: one at a time.
    buildConcurrency: process.env.WFM_DOCS_BASE ? 1 : undefined,
    // Pages name addresses of a local stack (Mailpit at http://localhost:8025): not reachable from a build.
    ignoreDeadLinks: [/^http:\/\/localhost/],
    lastUpdated: true,
    markdown: {
      // The product's own `{{variable}}` syntax appears all over these pages in inline code, and
      // VitePress would otherwise read it as a Vue interpolation and fail the build.
      config(md) {
        const render = md.renderer.rules.code_inline!;
        md.renderer.rules.code_inline = (...args) =>
          render(...args).replace('<code', '<code v-pre');
      },
    },
    // Not documentation for readers: design notes, generated PDFs, the record of dependency
    // reviews (linked from the security pages), the acceptance procedures the collaudo app
    // follows, and archived plans. They live in the repository, not on the site.
    srcExclude: ['superpowers/**', 'pdf/**', 'SECURITY-AUDIT.md', 'acceptance/**', 'archive/**'],
    themeConfig: {
      search: {
        provider: 'local',
        options: {
          locales: {
            it: {
              translations: {
                button: { buttonText: 'Cerca', buttonAriaLabel: 'Cerca' },
                modal: {
                  displayDetails: 'Mostra dettagli',
                  resetButtonTitle: 'Cancella la ricerca',
                  backButtonTitle: 'Chiudi la ricerca',
                  noResultsText: 'Nessun risultato per',
                  footer: {
                    selectText: 'per selezionare',
                    navigateText: 'per spostarti',
                    closeText: 'per chiudere',
                  },
                },
              },
            },
            fr: {
              translations: {
                button: { buttonText: 'Rechercher', buttonAriaLabel: 'Rechercher' },
                modal: {
                  displayDetails: 'Afficher les détails',
                  resetButtonTitle: 'Effacer la recherche',
                  backButtonTitle: 'Fermer la recherche',
                  noResultsText: 'Aucun résultat pour',
                  footer: {
                    selectText: 'pour sélectionner',
                    navigateText: 'pour naviguer',
                    closeText: 'pour fermer',
                  },
                },
              },
            },
            de: {
              translations: {
                button: { buttonText: 'Suchen', buttonAriaLabel: 'Suchen' },
                modal: {
                  displayDetails: 'Details anzeigen',
                  resetButtonTitle: 'Suche löschen',
                  backButtonTitle: 'Suche schließen',
                  noResultsText: 'Keine Ergebnisse für',
                  footer: {
                    selectText: 'zum Auswählen',
                    navigateText: 'zum Navigieren',
                    closeText: 'zum Schließen',
                  },
                },
              },
            },
          },
        },
      },
      socialLinks: [{ icon: 'github', link: 'https://github.com/Markg981/WebFlowMaster' }],
    },
    locales: {
      root: { label: 'Languages', lang: 'en' },
      en: {
        label: 'English',
        lang: 'en',
        link: '/en/',
        themeConfig: {
          nav: [
            { text: 'Home', link: '/en/' },
            { text: 'At a glance', link: '/en/overview' },
            { text: 'Start here', link: '/en/start/' },
            { text: 'Guide', link: '/en/guide/' },
            { text: 'Administration', link: '/en/admin/installation' },
            { text: 'Security', link: '/en/security/' },
            { text: 'Reference', link: '/en/reference/api' },
            { text: 'Internals', link: '/en/internals/' },
          ],
          sidebar: { '/en/': sidebar('en', en) },
          outline: { level: [2, 3], label: 'On this page' },
        },
      },
      it: {
        label: 'Italiano',
        lang: 'it',
        link: '/it/',
        themeConfig: {
          nav: [
            { text: 'Home', link: '/it/' },
            { text: 'In breve', link: '/it/overview' },
            { text: 'Inizia', link: '/it/start/' },
            { text: 'Guida', link: '/it/guide/' },
            { text: 'Amministrazione', link: '/it/admin/installation' },
            { text: 'Sicurezza', link: '/it/security/' },
            { text: 'Riferimento', link: '/it/reference/api' },
            { text: 'Interni', link: '/it/internals/' },
          ],
          sidebar: { '/it/': sidebar('it', it) },
          outline: { level: [2, 3], label: 'In questa pagina' },
          docFooter: { prev: 'Pagina precedente', next: 'Pagina successiva' },
          lastUpdated: { text: 'Ultimo aggiornamento' },
          returnToTopLabel: 'Torna su',
          sidebarMenuLabel: 'Menu',
          darkModeSwitchLabel: 'Tema',
        },
      },
      fr: {
        label: 'Français',
        lang: 'fr',
        link: '/fr/',
        themeConfig: {
          nav: [
            { text: 'Accueil', link: '/fr/' },
            { text: 'Commencer', link: '/fr/start/' },
            { text: 'Guide', link: '/fr/guide/' },
            { text: 'Référence (EN)', link: '/en/reference/api' },
          ],
          sidebar: { '/fr/': guideSidebar('fr', fr) },
          // The language menu opens the same page in French, and only the guide exists in French.
          notFound: {
            title: 'PAGE INTROUVABLE EN FRANÇAIS',
            quote:
              'Seul le guide utilisateur est traduit en français. Le reste de la documentation est en anglais : remplacez /fr/ par /en/ dans l’adresse.',
            linkLabel: 'aller à l’accueil',
            linkText: 'Retour à l’accueil',
          },
          outline: { level: [2, 3], label: 'Sur cette page' },
          docFooter: { prev: 'Page précédente', next: 'Page suivante' },
          lastUpdated: { text: 'Dernière mise à jour' },
          returnToTopLabel: 'Retour en haut',
          sidebarMenuLabel: 'Menu',
          darkModeSwitchLabel: 'Thème',
        },
      },
      de: {
        label: 'Deutsch',
        lang: 'de',
        link: '/de/',
        themeConfig: {
          nav: [
            { text: 'Startseite', link: '/de/' },
            { text: 'Loslegen', link: '/de/start/' },
            { text: 'Handbuch', link: '/de/guide/' },
            { text: 'Referenz (EN)', link: '/en/reference/api' },
          ],
          sidebar: { '/de/': guideSidebar('de', de) },
          notFound: {
            title: 'SEITE AUF DEUTSCH NICHT GEFUNDEN',
            quote:
              'Nur das Benutzerhandbuch ist ins Deutsche übersetzt. Der Rest der Dokumentation ist auf Englisch: Ersetzen Sie /de/ in der Adresse durch /en/.',
            linkLabel: 'zur Startseite',
            linkText: 'Zur Startseite',
          },
          outline: { level: [2, 3], label: 'Auf dieser Seite' },
          docFooter: { prev: 'Vorherige Seite', next: 'Nächste Seite' },
          lastUpdated: { text: 'Zuletzt aktualisiert' },
          returnToTopLabel: 'Nach oben',
          sidebarMenuLabel: 'Menü',
          darkModeSwitchLabel: 'Darstellung',
        },
      },
    },
    mermaid: {},
    // Mermaid reaches fastdom, which ships only as CommonJS. `docs:build` converts it, but the
    // dev server loaded mermaid as plain ES modules, so the browser asked fastdom for a default
    // export it does not have and every page of `docs:dev` stayed blank. Pre-bundling mermaid
    // converts its CommonJS dependencies the same way the build does.
    vite: {
      optimizeDeps: { include: ['mermaid'] },
    },
  }),
);
