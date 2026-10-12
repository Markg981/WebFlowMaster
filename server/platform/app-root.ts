import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * The directory that holds the app's package.json: the repository in development, /app in the
 * image. Found by walking up from the calling module rather than by a fixed count of `..`,
 * because the same code runs from server/platform/ under tsx and from dist/ once esbuild has
 * bundled it, and those sit at different depths.
 */
export function findAppRoot(from: string = path.dirname(fileURLToPath(import.meta.url))): string {
  for (let dir = from; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    if (path.dirname(dir) === dir) return process.cwd();
  }
}

export const APP_ROOT = findAppRoot();
