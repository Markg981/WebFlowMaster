/**
 * Downloads the promo's music track (music.json) into video/public/, once.
 *
 *   node marketing/promo-video/audio/fetch-music.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const music = JSON.parse(readFileSync(path.join(HERE, 'music.json'), 'utf8'));
const file = path.join(HERE, '..', 'video', 'public', music.file);

if (existsSync(file)) {
  console.log(`${music.title} is already in ${path.relative(process.cwd(), file)}`);
} else {
  const res = await fetch(music.source);
  if (!res.ok) throw new Error(`${music.source}: ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`${music.title} (${music.author}, ${music.license}) saved to ${file}`);
}
