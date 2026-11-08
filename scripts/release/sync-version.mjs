// Copies the package.json version into the other version carriers (see VERSION_CARRIERS in
// model.mjs): node scripts/release/sync-version.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION_CARRIERS, readVersionCarriers } from './model.mjs';

const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const version = readVersionCarriers(root)['package.json'];
for (const { file, pattern } of VERSION_CARRIERS.slice(1)) {
  const path = join(root, file);
  writeFileSync(path, readFileSync(path, 'utf8').replace(pattern, `$1${version}$3`));
}
console.log(`Version carriers set to ${version}`);
