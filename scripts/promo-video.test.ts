import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The promo video is told once, in marketing/promo-video/narration.json: the cuts, the voice-over
 * and the captions all come from it. Rendering needs the collaudo stack and a TTS, so CI checks
 * what can drift without them: the story itself, the committed captions against it, the Italian
 * overlays against the scenes, and the contact the closing card and the landing page show.
 */
const root = path.resolve(__dirname, '..');
const promo = path.join(root, 'marketing/promo-video');
const story = JSON.parse(fs.readFileSync(path.join(promo, 'narration.json'), 'utf8')) as {
  voices: Record<string, unknown>;
  lead: number;
  cuts: Record<
    string,
    {
      suffix: string;
      scenes: Array<{ scene: string; seconds: number; voice?: Record<string, string> }>;
    }
  >;
};
const languages = Object.keys(story.voices);
const promoSource = fs.readFileSync(path.join(promo, 'video/src/Promo.tsx'), 'utf8');
const copySource = fs.readFileSync(path.join(promo, 'video/src/copy.tsx'), 'utf8');

const seconds = (stamp: string) => {
  const [h, m, rest] = stamp.split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(rest.replace(',', '.'));
};

function readSrt(file: string) {
  return fs
    .readFileSync(file, 'utf8')
    .trim()
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const [, times, ...text] = block.split(/\r?\n/);
      const [start, end] = times.split(' --> ').map(seconds);
      return { start, end, lines: text };
    });
}

describe('promo video narration', () => {
  const sceneIds = [...promoSource.matchAll(/^ {2}(\w+): \w+,$/gm)].map((m) => m[1]);

  it.each(Object.entries(story.cuts))('cut %s lasts what its name says', (_, cut) => {
    const total = cut.scenes.reduce((sum, scene) => sum + scene.seconds, 0);
    expect(total).toBe(cut.suffix ? Number(cut.suffix.match(/\d+/)![0]) : 60);
    for (const { scene, voice } of cut.scenes) {
      expect(sceneIds, `scene ${scene} has a component`).toContain(scene);
      for (const lang of languages) expect(voice?.[lang], `${scene} in ${lang}`).toBeTruthy();
    }
  });

  it.each(languages.flatMap((lang) => Object.keys(story.cuts).map((cut) => [lang, cut] as const)))(
    'the %s captions of %s say what the voice says, in order and in time',
    (lang, cut) => {
      const { suffix, scenes } = story.cuts[cut];
      const cues = readSrt(
        path.join(promo, `video/captions/webflowmaster-promo-${lang}${suffix}.srt`),
      );
      const spoken = scenes.map((scene) => scene.voice?.[lang] ?? '').join(' ');
      const captioned = cues.map((cue) => cue.lines.join(' ')).join(' ');
      expect(captioned.replace(/\s+/g, ' ')).toBe(spoken.replace(/\s+/g, ' ').trim());
      const length = scenes.reduce((sum, scene) => sum + scene.seconds, 0);
      let previous = 0;
      for (const cue of cues) {
        expect(cue.start).toBeGreaterThanOrEqual(previous - 0.001);
        expect(cue.end).toBeGreaterThan(cue.start);
        expect(cue.lines.length).toBeLessThanOrEqual(2);
        previous = cue.end;
      }
      expect(previous).toBeLessThanOrEqual(length);
    },
  );

  it('every overlay of the video has its Italian text', () => {
    const overlays = [
      ...[...promoSource.matchAll(/\btext="([^"]+)"/g)].map((m) => m[1]),
      ...[...promoSource.matchAll(/^\s+\[\w+, '([^']+)'\],$/gm)].map((m) => m[1]),
    ];
    expect(overlays.length).toBeGreaterThan(20);
    for (const text of overlays) {
      // A key of the `italian` object, quoted or (a single word) not.
      const key = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(copySource, text).toMatch(new RegExp(`^\\s+('${key}'|${key}):`, 'm'));
    }
  });
});

describe('demo request', () => {
  const contact = JSON.parse(fs.readFileSync(path.join(root, 'marketing/contact.json'), 'utf8'));
  const landing = fs.readFileSync(path.join(root, 'marketing/landing/index.html'), 'utf8');

  it('the closing card has a short address to type', () => {
    expect(contact.demoUrl).toMatch(/^[\w.-]+\/[\w-]+$/);
    expect(contact.demoUrl.length).toBeLessThanOrEqual(32);
  });

  it('the landing page writes to the contact of the video and the brochure', () => {
    expect(landing).toContain(`data-email="${contact.email}"`);
  });
});
