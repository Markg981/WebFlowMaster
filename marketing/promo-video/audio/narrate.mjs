/**
 * The voice-over: every line of narration.json, spoken by Piper (https://github.com/OHF-Voice/piper1-gpl),
 * a neural text-to-speech that runs offline. Writes video/public/voice/<lang>/<cut>-<scene>.wav
 * and video/public/voice/timing.json (how long each line lasts), then the captions.
 *
 *   node marketing/promo-video/audio/narrate.mjs            # en and it
 *   node marketing/promo-video/audio/narrate.mjs it         # one language
 *
 * The first run installs Piper in a virtual environment under .local/piper (Python 3.10+ on
 * PATH, or PIPER_PYTHON pointing at an interpreter that already has piper-tts) and downloads
 * the two voices, both trained on CC0 recordings: en_US-joe-medium and it_IT-paola-medium.
 * A line that would still be speaking when its scene ends stops the script: shorten it, or
 * raise the voice's speed (a lower lengthScale) in narration.json.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeCaptions } from './captions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const story = JSON.parse(readFileSync(path.join(HERE, '..', 'narration.json'), 'utf8'));
const VOICE = path.join(HERE, '..', 'video', 'public', 'voice');
const PIPER = path.resolve(ROOT, process.env.WFM_LOCAL_DIR || '.local', 'piper');
// The last version these lines were checked with; a newer one may pronounce them differently.
const PIPER_VERSION = '1.8.0';
// Silence kept between the end of a line and the end of its scene.
const TAIL = 0.25;

const languages = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(story.voices);

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.error}`);
  }
  return result.stdout;
};

function python() {
  if (process.env.PIPER_PYTHON) return process.env.PIPER_PYTHON;
  const bin = path.join(PIPER, 'venv', process.platform === 'win32' ? 'Scripts' : 'bin', 'python');
  if (!existsSync(bin)) {
    console.log(`Installing piper-tts ${PIPER_VERSION} in ${path.join(PIPER, 'venv')}`);
    run(process.platform === 'win32' ? 'python' : 'python3', [
      '-m',
      'venv',
      path.join(PIPER, 'venv'),
    ]);
    run(bin, ['-m', 'pip', 'install', '--quiet', `piper-tts==${PIPER_VERSION}`]);
  }
  return bin;
}

/** Seconds of audio in a 16-bit PCM WAV, read from its header. */
function wavSeconds(file) {
  const wav = readFileSync(file);
  const byteRate = wav.readUInt32LE(28);
  let offset = 12;
  while (offset < wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'data') return size / byteRate;
    offset += 8 + size;
  }
  throw new Error(`${file} has no data chunk`);
}

const py = python();
const models = path.join(PIPER, 'voices');
mkdirSync(models, { recursive: true });
const timingFile = path.join(VOICE, 'timing.json');
const timing = existsSync(timingFile) ? JSON.parse(readFileSync(timingFile, 'utf8')) : {};
const tooLong = [];

for (const lang of languages) {
  const voice = story.voices[lang];
  if (!voice) throw new Error(`No voice for "${lang}" in narration.json`);
  const model = path.join(models, `${voice.model}.onnx`);
  if (!existsSync(model)) {
    console.log(`Downloading the voice ${voice.model}`);
    run(py, ['-m', 'piper.download_voices', '--download-dir', models, voice.model]);
  }
  const out = path.join(VOICE, lang);
  mkdirSync(out, { recursive: true });
  timing[lang] = {};
  for (const [cut, { scenes }] of Object.entries(story.cuts)) {
    timing[lang][cut] = {};
    for (const { scene, seconds, voice: lines } of scenes) {
      const text = lines?.[lang];
      if (!text) continue;
      const file = path.join(out, `${cut}-${scene}.wav`);
      run(
        py,
        [
          '-m',
          'piper',
          '-m',
          model,
          '-f',
          file,
          '--length-scale',
          String(voice.lengthScale ?? 1),
          '--sentence-silence',
          '0.12',
        ],
        { input: text },
      );
      const spoken = Math.round(wavSeconds(file) * 100) / 100;
      timing[lang][cut][scene] = spoken;
      const room = seconds - story.lead - TAIL;
      const mark = spoken > room ? '✗' : '✓';
      console.log(`${mark} ${lang} ${cut}/${scene}: ${spoken}s of ${room.toFixed(2)}s`);
      if (spoken > room)
        tooLong.push(`${lang} ${cut}/${scene} (${spoken}s, room ${room.toFixed(2)}s)`);
    }
  }
}

writeFileSync(timingFile, `${JSON.stringify(timing, null, 2)}\n`);
if (tooLong.length) {
  console.error(`\nThese lines run past the end of their scene:\n  ${tooLong.join('\n  ')}`);
  process.exit(1);
}
for (const lang of languages) writeCaptions(lang, timing[lang]);
