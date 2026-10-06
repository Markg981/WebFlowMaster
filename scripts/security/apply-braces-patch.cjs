// Temporary mitigation for CVE-2026-93687; retain upstream identity for scanners.
// Remove only after upgrading to an upstream release with equivalent depth protection.
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const originalHash = 'e572166565f15fa6ad9865ae49d678218e32aabfd1b3720f6d0d43d39800d310';
const original = '      depth++;';
const replacement = "      if (depth >= 100) throw new SyntaxError('braces exceeds maximum nesting depth (100)');\n      depth++;";
const hash = source => createHash('sha256').update(source).digest('hex');
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
for (const [path, pkg] of Object.entries(lock.packages)) {
  if (!path.endsWith('/braces')) continue;
  const parser = join(path, 'lib/parse.js');
  if (!existsSync(parser)) continue; // Omitted development/workspace dependencies.
  if (pkg.version !== '3.0.3') throw new Error('Review braces patch for the new upstream version');
  const source = readFileSync(parser, 'utf8').replaceAll('\r\n', '\n');
  const unpatched = source.replace(replacement, original);
  if (hash(unpatched) !== originalHash) throw new Error(`Unexpected braces parser content: ${parser}`);
  if (source === unpatched) writeFileSync(parser, source.replace(original, replacement));
  console.log(`Applied CVE-2026-93687 depth mitigation to ${path}`);
}
