// Lists keys whose it/fr/de value is identical to the English one (audit finding B-20).
// Usage: node scripts/i18n-untranslated.mjs [--all]   (--all also prints allowlisted keys)
//
// Not every identical value is a bug. A value is accepted when:
//  - it is short (<= 12 chars: single terms like "Account", "Hook", "editor") or has no letters;
//  - after stripping {{placeholders}} and `code`, it has no word left that is plain prose;
//  - every word is in ALLOWED_TERMS: product / brand names, protocols, technical identifiers and
//    loanwords that the locale keeps in English ("Email", "Webhook", "Dashboard", ...);
//  - the key is in ALLOWED_KEYS, for values that are legitimately equal.
// ALLOWED_KEYS lists exact keys or prefixes (ending in "." or "_") per language.
// The same rules are used by client/src/locales/locales.test.ts, which imports this module.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALLOWED_TERMS = new Set(
  `ok id url uri api apis sso saml oidc oauth ldap scim jwt json xml csv yaml html css sql http https
  webhook webhooks email e-mail dashboard cron token tokens ip dns tls ssl ssh sftp ftp smtp rest
  graphql grpc websocket signalr docker redis postgres postgresql kubernetes jenkins github gitlab
  azure devops jira slack teams discord telegram webflowmaster wfm playwright selenium appium cypress
  junit allure xray testrail zephyr jmeter k6 mcp ai llm openai claude anthropic gemini copilot
  android ios windows linux macos chrome firefox safari edge webkit chromium pdf png jpg svg
  gherkin cucumber bdd tdd qa ci cd cli sdk ui ux cpu gpu ram url urls uuid regex npm node
  excel dmo ncc staging production sandbox beta pro enterprise standard premium team
  login logout password username hash status log logs debug info warning error fatal trace
  tag tags pool agent agents backup proxy cache timeout offline online
  mobile desktop web tablet`
    .split(/\s+/)
    .filter(Boolean),
);

// Keys that stay identical on purpose, per language ('*' = every language). An entry ending in
// "." is a prefix. Add an entry only with a reason.
// Short values are skipped: the audit measured "identical and longer than 12 characters".
export const MIN_LENGTH = 12;

export const ALLOWED_KEYS = {
  '*': [
    'GET', // stray top-level key holding a URL path, not UI text
    'apiTesterPage.', // MIME types (application/json, ...)
    'apiTester.authTypeDropdown.', // auth scheme names as in the specs (Akamai EdgeGrid, Atlassian ASAP)
    'authForms.', // OAuth2 / Hawk / JWT field names (Client Credentials, Client secret, Audience (aud))
    'dashboardOverviewPage.webtestPlatform', // product name
    'authPage.webtestPlatform', // product name
    'dashboardPageNew.actions.', // value hints: syntax examples, not prose
    'testCaseHub.import.suiteNamePlaceholder', // example name typed by the user
    'sso.clientSecret', // OAuth2 term
    'testManagement.clientSecret', // OAuth2 term
    'auditLog.categories.scim', // "Provisioning (SCIM)" is the standard term in every language
    'sso.scim.title',
    'settings.tags.usage_', // "{{count}} test(s)": same word in these languages
    'planSuites.tests', // "{{count}} tests" (fr)
    'settings.languageSettings.', // each language is shown by its own name
  ],
  it: [
    'dashboardPageNew.stepGroups.stepCount_', // "step" is the term used across the Italian UI
    'testHistory.steps_',
    'stepGroupsManager.stepCount_',
  ],
  fr: [
    'recording.capturedCount_', // "{{count}} action(s)": same word
    'settings.sections.notifications',
    'settings.notifications.title',
    'dashboardPageNew.notifications.button',
    'apiTesterPage.notifications.requestSucceeded.assertions', // "Assertions" is used as is
    'reviews.version',
    'testHistory.version',
  ],
  de: [
    'apiTesterPage.notifications.requestSucceeded.assertions', // "Assertions" is used as is
    'authPage.edition.text', // product edition name
    'browserGrids.token', // "Token (optional)": "optional" is German too
    'testHistory.version',
  ],
};

const stripNonProse = (v) =>
  v
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[A-Z][A-Z0-9_]{2,}/g, ' ') // ENV_VARIABLES and acronyms
    .replace(/\b[\w.-]+\.(json|ya?ml|ts|js|md|xml|csv)\b/gi, ' ');

export function isAllowed(key, value, lang) {
  const keys = [...ALLOWED_KEYS['*'], ...(ALLOWED_KEYS[lang] ?? [])];
  if (
    keys.some(
      (k) =>
        key === k ||
        key.startsWith(`${k}.`) ||
        (k.endsWith('.') || k.endsWith('_') ? key.startsWith(k) : false),
    )
  ) {
    return true;
  }
  const stripped = stripNonProse(value);
  const words = stripped.toLowerCase().match(/\p{L}[\p{L}\p{N}'-]*/gu) ?? [];
  if (value.trim().length <= MIN_LENGTH || words.length === 0) return true;
  return words.every((w) => ALLOWED_TERMS.has(w) || w.length <= 2);
}

export function flatten(node, prefix = '') {
  return Object.entries(node).flatMap(([k, v]) =>
    v !== null && typeof v === 'object'
      ? flatten(v, `${prefix}${k}.`)
      : typeof v === 'string'
        ? [[`${prefix}${k}`, v]]
        : [],
  );
}

export function findUntranslated(en, other, lang) {
  const o = new Map(flatten(other));
  return flatten(en).filter(([k, v]) => o.get(k) === v && !isAllowed(k, v, lang));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'src', 'locales');
  const load = (l) => JSON.parse(readFileSync(join(dir, l, 'translation.json'), 'utf8'));
  const en = load('en');
  let total = 0;
  for (const lang of ['it', 'fr', 'de']) {
    const rows = findUntranslated(en, load(lang), lang);
    total += rows.length;
    console.log(`\n${lang}: ${rows.length}`);
    for (const [k, v] of rows) console.log(`  ${k} = ${JSON.stringify(v)}`);
  }
  process.exitCode = total ? 1 : 0;
}
