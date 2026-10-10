import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROLES, sha256, assertScanPassed, assertSourceScanPassed, createManifest, assertScannerMetadata } from './model.mjs';
import { fileHash } from './file-hash.mjs';
const [mode, role, configDigest] = process.argv.slice(2);
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const directory = 'release-artifacts';
const metadata = read(join(directory, 'metadata.json'));
// No source exception is accepted: every HIGH or CRITICAL finding in the lockfiles blocks.
function verifySource(path) {
  assertSourceScanPassed(read(path));
}
if (mode === 'record') {
  if (!ROLES.includes(role)) throw new Error('Invalid image role');
  const base = join(directory, role);
  assertScanPassed(read(join(base, 'scan.json')));
  assertScannerMetadata(read(join(base, 'scanner.json')), metadata.inputs.toolchain.trivy);
  const sbom = read(join(base, 'sbom.cdx.json'));
  if (sbom.bomFormat !== 'CycloneDX' || !Array.isArray(sbom.components) || !sbom.components.length) throw new Error('Missing complete image SBOM');
  const evidence = { configDigest, sbomSha256: await fileHash(join(base, 'sbom.cdx.json')), scanSha256: await fileHash(join(base, 'scan.json')), scannerMetadataSha256: await fileHash(join(base, 'scanner.json')), archiveSha256: await fileHash(join(base, 'image.tar.gz')), reproducibility: 'configuration-and-uncompressed-layers-equal' };
  const images = Object.fromEntries(ROLES.map(key => [key, evidence]));
  createManifest({ ...metadata, images }); // Validate digest/version formats before accepting evidence.
  writeFileSync(join(base, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
} else if (mode === 'manifest') {
  verifySource(join(directory, 'source-scan.json'));
  assertScannerMetadata(read(join(directory, 'source-scanner.json')), metadata.inputs.toolchain.trivy);
  const images = Object.fromEntries(ROLES.map(key => [key, read(join(directory, key, 'published.json'))]));
  for (const key of ROLES) {
    if (!images[key].reference || images[key].reproducibility !== 'configuration-and-uncompressed-layers-equal') throw new Error(`Missing published/rebuilt evidence for ${key}`);
    for (const [file, hash] of [['sbom.cdx.json', 'sbomSha256'], ['scan.json', 'scanSha256'], ['scanner.json', 'scannerMetadataSha256']]) {
      if (await fileHash(join(directory, key, file)) !== images[key][hash]) throw new Error(`Altered ${key} evidence: ${file}`);
    }
    assertScanPassed(read(join(directory, key, 'scan.json')));
    assertScannerMetadata(read(join(directory, key, 'scanner.json')), metadata.inputs.toolchain.trivy);
  }
  const manifest = createManifest({ ...metadata, images });
  manifest.sourceScanSha256 = sha256(readFileSync(join(directory, 'source-scan.json')));
  manifest.sourceScannerMetadataSha256 = sha256(readFileSync(join(directory, 'source-scanner.json')));
  writeFileSync(join(directory, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const env = ROLES.map(key => `WFM_${key.toUpperCase()}_IMAGE=${images[key].reference}`).join('\n');
  writeFileSync(join(directory, 'release.env'), env + '\n');
} else if (mode === 'gate') {
  assertScanPassed(read(role));
} else if (mode === 'source-gate') {
  verifySource(role);
} else throw new Error('Use record, manifest, gate or source-gate');
