/**
 * The captions of every cut: what the voice says, when it says it. One cue per sentence (a long
 * one is split at its commas), at most two lines of 42 characters, timed on the length of the
 * spoken line (video/public/voice/timing.json, written by narrate.mjs) and shared out in
 * proportion to the characters of each sentence.
 *
 *   node marketing/promo-video/audio/captions.mjs     # rewrite them from the last voice-over
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const story = JSON.parse(readFileSync(path.join(HERE, '..', 'narration.json'), 'utf8'));
export const CAPTIONS = path.join(HERE, '..', 'video', 'captions');
const BURNED = path.join(HERE, '..', 'video', 'public', 'voice', 'captions.json');
const LINE = 42;

/** The file name of a cut's captions or video, without extension. */
export const cutFile = (lang, cut) => `webflowmaster-promo-${lang}${story.cuts[cut].suffix}`;

/** A sentence too long for one cue, cut at the comma nearest its middle, as often as needed. */
function split(sentence) {
  if (sentence.length <= LINE * 2) return [sentence];
  const commas = [...sentence.matchAll(/,\s+/g)].map((m) => m.index + 1);
  if (!commas.length) return [sentence];
  const at = commas.reduce((best, i) =>
    Math.abs(i - sentence.length / 2) < Math.abs(best - sentence.length / 2) ? i : best,
  );
  return [...split(sentence.slice(0, at).trim()), ...split(sentence.slice(at).trim())];
}

/** The text of a line as cues: whole sentences packed together while they fit in two lines. */
function chunks(text) {
  const pieces = text.split(/(?<=[.?!:])\s+/).flatMap(split);
  const cues = [];
  for (const piece of pieces) {
    const last = cues.length - 1;
    if (last >= 0 && `${cues[last]} ${piece}`.length <= LINE * 2) cues[last] += ` ${piece}`;
    else cues.push(piece);
  }
  return cues;
}

function wrap(text) {
  if (text.length <= LINE) return text;
  // Break at the space nearest the middle, so the two lines are balanced.
  const middle = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ' && (best < 0 || Math.abs(i - middle) < Math.abs(best - middle))) best = i;
  }
  return `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

const stamp = (seconds) => {
  const ms = Math.round(seconds * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

/** The cues of one cut in one language: [{ start, end, text }], in seconds. */
export function cues(lang, cut, spoken) {
  const list = [];
  let sceneStart = 0;
  for (const { scene, seconds, voice } of story.cuts[cut].scenes) {
    const text = voice?.[lang];
    if (text) {
      const length = spoken?.[scene];
      if (!length)
        throw new Error(`No voice-over timing for ${lang} ${cut}/${scene}: run narrate.mjs`);
      const parts = chunks(text);
      const total = parts.reduce((sum, part) => sum + part.length, 0);
      let at = sceneStart + story.lead;
      for (const part of parts) {
        const end = at + (length * part.length) / total;
        list.push({ start: at, end, text: wrap(part) });
        at = end;
      }
    }
    sceneStart += seconds;
  }
  return list;
}

/**
 * The SRT files beside the videos, and public/voice/captions.json: the same cues, which the
 * square and vertical formats burn into the picture (feeds autoplay them muted).
 */
export function writeCaptions(lang, timing) {
  const burned = existsSync(BURNED) ? JSON.parse(readFileSync(BURNED, 'utf8')) : {};
  burned[lang] = {};
  for (const cut of Object.keys(story.cuts)) {
    const list = cues(lang, cut, timing[cut]);
    burned[lang][cut] = list;
    const srt = list
      .map((cue, i) => `${i + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`)
      .join('\n');
    const file = path.join(CAPTIONS, `${cutFile(lang, cut)}.srt`);
    writeFileSync(file, srt);
    console.log(`  captions ${path.relative(process.cwd(), file)}`);
  }
  writeFileSync(BURNED, `${JSON.stringify(burned, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const timing = JSON.parse(
    readFileSync(path.join(HERE, '..', 'video', 'public', 'voice', 'timing.json'), 'utf8'),
  );
  for (const lang of Object.keys(timing)) writeCaptions(lang, timing[lang]);
}
