import { statfsSync } from 'node:fs';
// Linux release runners need space for two builds, image import, archives and Trivy DBs.
const stats = statfsSync('.');
const freeGiB = stats.bavail * stats.bsize / 1024 ** 3;
console.log(`Release runner free space: ${freeGiB.toFixed(1)} GiB (minimum 20 GiB)`);
if (freeGiB < 20) throw new Error('Use a release runner with at least 20 GiB free disk space');
