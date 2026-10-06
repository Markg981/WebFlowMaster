import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { readReleaseInputs, verifyCurrentChecks, releaseVersion } from './model.mjs';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const inputs = readReleaseInputs(process.cwd());
const repository = process.env.GITHUB_REPOSITORY;
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw new Error('Set GITHUB_REPOSITORY to owner/repository');
const commit = git('rev-parse', 'HEAD');
const epoch = Number(git('show', '-s', '--format=%ct', 'HEAD'));
if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('Release inputs must be committed');
const isTag = process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_EVENT_NAME === 'push';
if (isTag) {
  if (!process.env.GITHUB_REF_NAME?.startsWith('v') || releaseVersion(process.env.GITHUB_REF_NAME) !== inputs.version) throw new Error('Tag must be v plus the package version');
  git('merge-base', '--is-ancestor', 'HEAD', 'origin/main');
  await verifyCurrentChecks(repository, commit, process.env.GITHUB_TOKEN);
}
const metadata = { repository, commit, epoch, version: inputs.version, publish: isTag, inputs };
mkdirSync('release-artifacts', { recursive: true });
writeFileSync('release-artifacts/metadata.json', JSON.stringify(metadata, null, 2) + '\n');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${inputs.version}\ncommit=${commit}\nepoch=${epoch}\nplatform=${inputs.toolchain.platform}\nbuildx=${inputs.toolchain.buildx}\nbuildkit=${inputs.toolchain.buildkit}\ntrivy=${inputs.toolchain.trivy}\ndb=${inputs.toolchain.dbRepository}\njava-db=${inputs.toolchain.javaDbRepository}\n`);
console.log(`Prepared ${isTag ? 'release' : 'candidate'} ${inputs.version} from ${commit}`);
