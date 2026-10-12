/**
 * Films the product again and rebuilds the customer materials from it, so they show the release
 * being sold rather than an older one. Run it before each release, on the collaudo stack with
 * the Northwind Commerce demo loaded (promo-video/README.md, steps 1-4):
 *
 *   npm run marketing:refresh                  # screens, voice-over, music, videos, brochure
 *   npm run marketing:refresh -- --skip-capture   # rebuild from the screens already filmed
 *
 * Every step is one of the scripts the READMEs describe; this only runs them in order and
 * stops at the first that fails.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO = path.join(ROOT, 'marketing', 'promo-video', 'video');
const skipCapture = process.argv.includes('--skip-capture');
const env = {
  ...process.env,
  NODE_EXTRA_CA_CERTS:
    process.env.NODE_EXTRA_CA_CERTS ?? path.join(ROOT, 'collaudo', 'collaudo-root.crt'),
};

const step = (title, command, args, cwd = ROOT) => {
  console.log(`\n▶ ${title}`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`\n✗ ${title} failed`);
    process.exit(result.status ?? 1);
  }
};

if (!existsSync(path.join(VIDEO, 'node_modules'))) {
  step('Video dependencies', 'npm', ['ci', '--no-audit', '--no-fund'], VIDEO);
}
if (!skipCapture) {
  step('Video: screens and live clips', 'node', ['marketing/promo-video/demo/capture.mjs']);
}
step('Video: voice-over and captions', 'node', ['marketing/promo-video/audio/narrate.mjs']);
step('Video: music', 'node', ['marketing/promo-video/audio/fetch-music.mjs']);
step('Video: release set', 'node', ['marketing/promo-video/render.mjs']);

const brochure = path.join(ROOT, 'marketing', 'brochure');
if (!skipCapture && existsSync(path.join(brochure, 'capture.mjs'))) {
  step('Brochure: screens', 'node', ['marketing/brochure/capture.mjs']);
}
step('Brochure: PDFs', process.platform === 'win32' ? 'py' : 'python3', [
  'marketing/brochure/build.py',
]);

console.log('\n✓ Materials rebuilt: marketing/promo-video/video/out/ and marketing/brochure/');
