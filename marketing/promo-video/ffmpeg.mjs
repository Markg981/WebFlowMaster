/** The FFmpeg the promo's scripts use: PROMO_FFMPEG_PATH, Remotion's own, or `ffmpeg` on PATH. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const compositor = {
  win32: 'compositor-win32-x64-msvc/ffmpeg.exe',
  linux: `compositor-linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}-gnu/ffmpeg`,
  darwin: `compositor-darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}/ffmpeg`,
}[process.platform];
const bundled = compositor
  ? path.join(
      fileURLToPath(new URL('./video/node_modules/@remotion/', import.meta.url)),
      compositor,
    )
  : '';

export const FFMPEG =
  process.env.PROMO_FFMPEG_PATH || (bundled && existsSync(bundled) ? bundled : 'ffmpeg');

export function ffmpeg(args) {
  const result = spawnSync(FFMPEG, ['-y', '-v', 'error', ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw result.error || new Error(`FFmpeg failed (${result.status})`);
}
