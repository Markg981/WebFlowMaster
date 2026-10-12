import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * marketing/brochure/build.py needs Python and reportlab, which CI does not install: these checks
 * catch, without building, what would stop the build or ship a lopsided edition — a screenshot
 * missing in one language, a copy key only one edition has, a font that is not in the repository.
 */
const brochure = path.resolve(__dirname, '..', 'marketing', 'brochure');
const copy = JSON.parse(fs.readFileSync(path.join(brochure, 'copy.json'), 'utf8')) as Record<
  string,
  Record<string, unknown>
>;
const build = fs.readFileSync(path.join(brochure, 'build.py'), 'utf8');
const crops = [...build.matchAll(/^ {4}"([a-z-]+)": \(/gm)].map((match) => match[1]);

describe('customer brochure', () => {
  it('has an Italian and an English edition with the same copy keys', () => {
    expect(Object.keys(copy).sort()).toEqual(['en', 'it']);
    expect(Object.keys(copy.it).sort()).toEqual(Object.keys(copy.en).sort());
    for (const [key, value] of Object.entries(copy.it))
      if (Array.isArray(value)) expect(value, key).toHaveLength((copy.en[key] as unknown[]).length);
  });

  it('has every screenshot the layout shows, in both languages', () => {
    expect(crops).toEqual(expect.arrayContaining(['dashboard', 'builder', 'api', 'mobile', 'bdd']));
    for (const lang of ['it', 'en'])
      for (const name of crops)
        expect(
          fs.existsSync(path.join(brochure, 'assets', lang, `${name}.jpg`)),
          `${lang}/${name}`,
        ).toBe(true);
  });

  it('ships its fonts with their licence', () => {
    for (const file of ['Inter-Regular.ttf', 'Inter-Bold.ttf', 'OFL.txt'])
      expect(fs.existsSync(path.join(brochure, 'fonts', file)), file).toBe(true);
    expect(build).not.toMatch(/C:\/Windows\/Fonts/);
  });

  it('states the licence terms and that it is not a print-shop file', () => {
    expect(copy.it.licence).toMatch(/annuale per installazione/);
    expect(copy.en.licence).toMatch(/annual licence per installation/i);
    expect(copy.it.distribution_note).toMatch(/CMYK/);
    expect(copy.en.distribution_note).toMatch(/CMYK/);
  });
});
