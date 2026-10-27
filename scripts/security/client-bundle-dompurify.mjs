#!/usr/bin/env node
// Fails when the built client ships a dompurify affected by GHSA-p98j-92pf-mc4p or
// GHSA-6688-9rhm-gjv2 (fixed in 3.4.16). monaco-editor vendors its own copy, which npm audit
// cannot see and client/monaco-dompurify.ts replaces at build time: this reads what was built.
// Usage: node scripts/security/client-bundle-dompurify.mjs [assets dir, default dist/public/assets]
import fs from 'node:fs';
import path from 'node:path';

const PATCHED = [3, 4, 17];
const dir = path.resolve(process.argv[2] ?? 'dist/public/assets');

const isPatched = (version) => {
  const parts = version.split('.').map(Number);
  for (let i = 0; i < PATCHED.length; i++) {
    if (parts[i] !== PATCHED[i]) return parts[i] > PATCHED[i];
  }
  return true;
};

const files = (root) =>
  fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return files(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });

if (!fs.existsSync(dir)) {
  console.error(`No client bundle at ${dir}: build the client first.`);
  process.exit(2);
}

const found = files(dir).flatMap((file) =>
  [...fs.readFileSync(file, 'utf8').matchAll(/@license DOMPurify (\d+\.\d+\.\d+)/g)].map(
    ([, version]) => ({ file: path.relative(dir, file), version }),
  ),
);
// The code editor always sanitizes with dompurify: none at all means this check read the wrong place.
if (found.length === 0) {
  console.error(`No dompurify found in ${dir}.`);
  process.exit(1);
}
const affected = found.filter(({ version }) => !isPatched(version));
for (const { file, version } of found) {
  console.log(`${isPatched(version) ? 'ok      ' : 'AFFECTED'} dompurify ${version}  ${file}`);
}
process.exit(affected.length === 0 ? 0 : 1);
