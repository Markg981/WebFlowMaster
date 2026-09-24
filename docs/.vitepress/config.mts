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
};

function sidebar(lang: 'en' | 'it', t: Labels): DefaultTheme.SidebarItem[] {
  const p = (page: string) => `/${lang}/${page}`;
  return [
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
      text: t.integrations,
      items: [
        { text: t.ci, link: p('CI_INTEGRATION') },
        { text: t.localAgents, link: p('LOCAL_AGENT') },
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
};

const it: Labels = {
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
    // Not documentation for readers: design notes, generated PDFs, and the guides still to be
    // rewritten (they are replaced page by page, and leave this list as they are).
    srcExclude: [
      'superpowers/**',
      'pdf/**',
      'JSDOC_SNIPPETS.md',
      'USER_GUIDE.md',
      'API_REFERENCE.md',
      'en/USER_GUIDE.md',
      'it/USER_GUIDE.md',
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
            { text: 'Administration', link: '/en/admin/installation' },
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
            { text: 'Amministrazione', link: '/it/admin/installation' },
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
  }),
);
