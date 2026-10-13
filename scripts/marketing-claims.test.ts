import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * marketing/claims.json is the list of what the README, the brochure, the video and the landing
 * page say the product does. A claim whose code is gone fails its evidence; a channel that stops
 * naming a claim fails its mentions; a new CI integration or UI language without a claim fails the
 * inventory. Either way the materials and the product cannot drift apart silently.
 */
type Words = string[] | Record<string, string[]>;
type Claim = {
  id: string;
  en: string;
  it: string;
  evidence: Array<{ path: string; pattern?: string }>;
  mentions: Record<string, Words>;
};
type Claims = {
  channels: Record<string, Record<string, string[]>>;
  inventories: Array<{ dir: string; claim: string }>;
  claims: Claim[];
};

const root = path.resolve(__dirname, '..');
const claims = JSON.parse(
  fs.readFileSync(path.join(root, 'marketing', 'claims.json'), 'utf8'),
) as Claims;

/** Text of a source: a whole file, or one language of a JSON file (`file.json#it`). */
function text(source: string): string {
  const [file, lang] = source.split('#');
  const raw = fs.readFileSync(path.join(root, file), 'utf8');
  if (!lang) return raw;
  const strings: string[] = [];
  const collect = (value: unknown, inLang: boolean) => {
    if (typeof value === 'string') {
      if (inLang) strings.push(value);
    } else if (Array.isArray(value)) value.forEach((item) => collect(item, inLang));
    else if (value && typeof value === 'object')
      for (const [key, item] of Object.entries(value)) collect(item, inLang || key === lang);
  };
  collect(JSON.parse(raw), false);
  return strings.join('\n');
}

const channelText = Object.fromEntries(
  Object.entries(claims.channels).map(([channel, langs]) => [
    channel,
    Object.fromEntries(
      Object.entries(langs).map(([lang, sources]) => [
        lang,
        sources.map(text).join('\n').replace(/\s+/g, ' ').toLowerCase(),
      ]),
    ),
  ]),
) as Record<string, Record<string, string>>;

describe('marketing claims', () => {
  it('have unique ids and both an English and an Italian wording', () => {
    const ids = claims.claims.map((claim) => claim.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const claim of claims.claims) {
      expect(claim.en, claim.id).toBeTruthy();
      expect(claim.it, claim.id).toBeTruthy();
      expect(claim.evidence.length, claim.id).toBeGreaterThan(0);
    }
  });

  it.each(claims.claims.map((claim) => [claim.id, claim] as const))(
    '%s is backed by the product',
    (_id, claim) => {
      for (const { path: target, pattern } of claim.evidence) {
        const file = path.join(root, target);
        expect(fs.existsSync(file), `${claim.id}: ${target}`).toBe(true);
        if (pattern)
          expect(fs.readFileSync(file, 'utf8'), `${claim.id}: ${target}`).toMatch(
            new RegExp(pattern, 'i'),
          );
      }
    },
  );

  it.each(claims.claims.map((claim) => [claim.id, claim] as const))(
    '%s is named by every channel that carries it',
    (_id, claim) => {
      for (const [channel, words] of Object.entries(claim.mentions)) {
        const langs = channelText[channel];
        expect(langs, `${claim.id}: unknown channel ${channel}`).toBeDefined();
        for (const [lang, haystack] of Object.entries(langs)) {
          const expected = Array.isArray(words) ? words : words[lang];
          expect(expected, `${claim.id}: no ${lang} words for ${channel}`).toBeDefined();
          for (const word of expected)
            expect(
              haystack.includes(word.toLowerCase()),
              `${claim.id}: ${channel}/${lang} "${word}"`,
            ).toBe(true);
        }
      }
    },
  );

  it.each(claims.inventories.map((inventory) => [inventory.dir, inventory] as const))(
    'every entry of %s has a claim',
    (dir, { claim: id }) => {
      const claim = claims.claims.find((candidate) => candidate.id === id);
      expect(claim, id).toBeDefined();
      const claimed = new Set(claim!.evidence.map((evidence) => evidence.path));
      const entries = fs
        .readdirSync(path.join(root, dir), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${dir}/${entry.name}`);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) expect(claimed.has(entry), `${entry} has no claim`).toBe(true);
    },
  );
});
