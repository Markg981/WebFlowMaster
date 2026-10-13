import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  DOCS_BASE,
  HELP_TOPICS,
  helpUrl,
  pageLanguages,
  type DocLanguage,
} from '../client/src/lib/help-links';

/**
 * The "?" in the top bar opens a section of the manual. A renamed page or heading would leave it
 * pointing at nothing, silently, so every page and anchor in the map is checked against the
 * Markdown it is built from.
 */

const docs = path.resolve(__dirname, '..', 'docs');

// VitePress's slugify (vitepress/dist/node, `const slugify`), which turns a heading into its id.
// eslint-disable-next-line no-control-regex -- copied as is; VitePress strips control characters
const rControl = /[\u0000-\u001f]/g;
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g;
const rCombining = /[̀-ͯ]/g;
const slugify = (str: string) =>
  str
    .normalize('NFKD')
    .replace(rCombining, '')
    .replace(rControl, '')
    .replace(rSpecial, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase();

function source(lang: DocLanguage, page: string): string {
  const file = page.endsWith('/') ? `${page}index.md` : `${page}.md`;
  return path.join(docs, lang, file);
}

function anchors(file: string): Set<string> {
  const ids = new Set<string>();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const heading = line.match(/^#{1,6} (.*)$/);
    if (!heading) continue;
    const explicit = heading[1].match(/\{#([^}]+)\}\s*$/);
    ids.add(explicit ? explicit[1] : slugify(heading[1]));
  }
  return ids;
}

describe('contextual help links', () => {
  for (const topic of HELP_TOPICS) {
    for (const lang of pageLanguages(topic.page)) {
      it(`${topic.route} → ${lang}/${topic.page}`, () => {
        const file = source(lang, topic.page);
        expect(fs.existsSync(file), `${file} is missing`).toBe(true);
        const anchor = topic.anchors?.[lang];
        if (anchor) expect([...anchors(file)]).toContain(anchor);
      });
    }
  }

  it('opens the section in the user language', () => {
    expect(helpUrl('/suites', 'it')).toBe(`${DOCS_BASE}it/guide/organizing#suite`);
    expect(helpUrl('/suites', 'de-CH')).toBe(`${DOCS_BASE}de/guide/organizing#suites`);
    expect(helpUrl('/test-plans/7/executions/9/report', 'fr')).toBe(
      `${DOCS_BASE}fr/guide/results#le-rapport-d-une-execution`,
    );
  });

  it('falls back to English for a page or language the manual does not have', () => {
    expect(helpUrl('/whats-new', 'de')).toBe(`${DOCS_BASE}en/reference/changelog`);
    expect(helpUrl('/whats-new', 'it')).toBe(`${DOCS_BASE}it/reference/changelog`);
    expect(helpUrl('/scheduling', 'es')).toBe(`${DOCS_BASE}en/guide/running#scheduling`);
  });

  it('opens the user guide from a page with no topic of its own', () => {
    expect(helpUrl('/nowhere', 'en')).toBe(`${DOCS_BASE}en/guide/`);
    expect(fs.existsSync(source('en', 'guide/'))).toBe(true);
  });

  it('matches specific routes before their prefixes', () => {
    expect(helpUrl('/dashboard/api-tester', 'en')).toBe(`${DOCS_BASE}en/guide/api-tests`);
    expect(helpUrl('/test-plan/3/run', 'en')).toBe(`${DOCS_BASE}en/guide/running#running-now`);
    expect(helpUrl('/test-plans', 'en')).toBe(`${DOCS_BASE}en/guide/running#creating-a-plan`);
  });
});
