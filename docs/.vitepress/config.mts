import { defineConfig, type DefaultTheme } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

/**
 * The documentation site: `npm run docs:dev` to write, `npm run docs:build` to check and build.
 *
 * English and Italian live side by side in docs/en and docs/it, page for page. The build fails on a
 * dead link, which is the point of building it in the verification: a page that names another page
 * that was renamed is found here rather than by a reader.
 */

type Labels = {
  guide: string;
  gettingStarted: string;
  webTests: string;
  apiTests: string;
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
};

function sidebar(lang: 'en' | 'it', t: Labels): DefaultTheme.SidebarItem[] {
  const p = (page: string) => `/${lang}/${page}`;
  return [
    {
      text: t.guide,
      items: [
        { text: t.gettingStarted, link: p('guide/') },
        { text: t.webTests, link: p('guide/web-tests') },
        { text: t.apiTests, link: p('guide/api-tests') },
        { text: t.organizing, link: p('guide/organizing') },
        { text: t.running, link: p('guide/running') },
        { text: t.results, link: p('guide/results') },
      ],
    },
    {
      text: t.admin,
      items: [
        { text: t.installation, link: p('admin/installation') },
        { text: t.operations, link: p('admin/operations') },
        { text: t.configuration, link: p('admin/configuration') },
        { text: t.administration, link: p('admin/administration') },
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
        { text: t.ci, link: p('CI_INTEGRATION') },
        { text: t.localAgents, link: p('LOCAL_AGENT') },
      ],
    },
    {
      text: t.reference,
      items: [
        { text: t.restApi, link: p('reference/api') },
        { text: t.cli, link: p('reference/cli') },
      ],
    },
    {
      text: t.internals,
      items: [
        { text: t.overview, link: p('internals/') },
        { text: t.tenancy, link: p('internals/tenancy') },
        { text: t.execution, link: p('internals/execution') },
        { text: t.dataModel, link: p('internals/data-model') },
        { text: t.agents, link: p('internals/agents') },
        { text: t.frontend, link: p('internals/frontend') },
        { text: t.developer, link: p('internals/developer-guide') },
        { text: t.decisions, link: p('internals/decisions') },
        { text: t.glossary, link: p('internals/glossary') },
      ],
    },
  ];
}

const en: Labels = {
  guide: 'User guide',
  gettingStarted: 'Getting started',
  webTests: 'Web tests',
  apiTests: 'API tests',
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
};

const it: Labels = {
  guide: 'Guida utente',
  gettingStarted: 'Primi passi',
  webTests: 'Test web',
  apiTests: 'Test API',
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
};

export default withMermaid(
  defineConfig({
    title: 'WebFlowMaster',
    description: 'Documentation for WebFlowMaster, the test automation platform.',
    cleanUrls: true,
    lastUpdated: true,
    markdown: {
      // The product's own `{{variable}}` syntax appears all over these pages in inline code, and
      // VitePress would otherwise read it as a Vue interpolation and fail the build.
      config(md) {
        const render = md.renderer.rules.code_inline!;
        md.renderer.rules.code_inline = (...args) => render(...args).replace('<code', '<code v-pre');
      },
    },
    // Not documentation for readers: design notes, generated PDFs, and the record of dependency
    // reviews, which lives in the repository and is linked from the security pages.
    srcExclude: [
      'superpowers/**',
      'pdf/**',
      'SECURITY-AUDIT.md',
    ],
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
                  footer: { selectText: 'per selezionare', navigateText: 'per spostarti', closeText: 'per chiudere' },
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
