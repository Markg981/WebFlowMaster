/** Keep video bit-for-bit, trim AAC padding to exactly 60s, and export silent masters. */
import { spawnSync } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const video = fileURLToPath(new URL('../video/', import.meta.url));
const bundled = path.join(video, 'node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe');
const ffmpeg = process.env.PROMO_FFMPEG_PATH || (existsSync(bundled) ? bundled : 'ffmpeg');
const languages = process.argv.slice(2);
if (!languages.length || languages.some((lang) => !['en', 'it'].includes(lang))) {
  throw new Error('Usage: node finalize.mjs en [it]');
}
const run = (args) => {
  const result = spawnSync(ffmpeg, ['-y', '-v', 'error', ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw result.error || new Error(`FFmpeg failed (${result.status})`);
};
for (const lang of languages) {
  const source = path.join(video, `out/webflowmaster-promo-${lang}.mp4`);
  const final = path.join(video, `out/webflowmaster-promo-${lang}-final.mp4`);
  run([
    '-i',
    source,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-t',
    '60',
    '-movflags',
    '+faststart',
    final,
  ]);
  renameSync(final, source);
  run([
    '-i',
    source,
    '-map',
    '0:v:0',
    '-c:v',
    'copy',
    '-an',
    '-movflags',
    '+faststart',
    path.join(video, `out/webflowmaster-promo-${lang}-silent.mp4`),
  ]);
  console.log(`${lang}: finalized 60-second music edition and matching silent master`);
}
