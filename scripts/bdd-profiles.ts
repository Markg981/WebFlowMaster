import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { BddAgentProfileSchema, type BddAgentProfile } from '../shared/bdd-agent';

const forbiddenEnvironment =
  /^(?:NODE_.*|CUCUMBER_.*|WFM_.*|DATABASE_URL|REDIS_URL|SESSION_SECRET|ENCRYPTION_KEY|.*(?:AGENT|RELAY).*(?:TOKEN|SECRET|KEY))$/i;
const safeGlob = z
  .string()
  .min(1)
  .max(400)
  .refine(
    (value) =>
      !path.isAbsolute(value) &&
      !value.includes('\\') &&
      !value.split('/').some((part) => part === '..' || part === 'node_modules') &&
      ![...value].some((character) => character === ':' || character.charCodeAt(0) < 32),
    'Support globs must stay inside the approved project',
  );
export const OperatorBddProfileSchema = BddAgentProfileSchema.extend({
  projectDirectory: z
    .string()
    .min(1)
    .refine(path.isAbsolute, 'An absolute operator project directory is required'),
  requirePaths: z.array(safeGlob).max(100).default([]),
  importPaths: z.array(safeGlob).max(100).default([]),
  loader: z.literal('tsx').optional(),
  maxConcurrency: z.number().int().min(1).max(16).default(1),
  environment: z
    .array(
      z
        .string()
        .regex(/^[A-Z_][A-Z0-9_]*$/)
        .refine(
          (name) => !forbiddenEnvironment.test(name),
          'Reserved agent or runtime environment variable',
        ),
    )
    .max(100)
    .default([]),
})
  .strict()
  .refine(
    (profile) => profile.requirePaths.length + profile.importPaths.length > 0,
    'At least one support glob is required',
  );
export type OperatorBddProfile = z.infer<typeof OperatorBddProfileSchema>;

export function publicBddProfiles(profiles: readonly OperatorBddProfile[]): BddAgentProfile[] {
  return profiles.map(({ id, label, provider, revision, maxDurationMs }) => ({
    id,
    label,
    provider,
    revision,
    maxDurationMs,
  }));
}

/** Only the operator manifest supplies executable coordinates; never tenant requests. */
export async function loadBddProfiles(manifestPath: string): Promise<OperatorBddProfile[]> {
  if ((await stat(manifestPath)).size > 1024 * 1024) throw new Error('BDD manifest exceeds 1 MiB');
  const manifest = z
    .object({ profiles: z.array(OperatorBddProfileSchema).max(100) })
    .strict()
    .parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (new Set(manifest.profiles.map((profile) => profile.id)).size !== manifest.profiles.length)
    throw new Error('Duplicate BDD profile ID');
  for (const profile of manifest.profiles) {
    profile.projectDirectory = await realpath(profile.projectDirectory);
    await resolveProfileSupport(profile);
  }
  return manifest.profiles;
}

/** Every support module must register on exactly the same installed Cucumber instance. */
export async function resolveProfileSupport(
  profile: OperatorBddProfile,
): Promise<{ apiPath: string; requirePaths: string[]; importPaths: string[] }> {
  const project = await realpath(profile.projectDirectory);
  const projectRequire = createRequire(path.join(project, 'package.json'));
  const cucumberPath = await realpath(projectRequire.resolve('@cucumber/cucumber'));
  const apiPath = projectRequire.resolve('@cucumber/cucumber/api');
  const cucumberRequire = createRequire(cucumberPath);
  const packageInfo = projectRequire('@cucumber/cucumber/package.json') as { version: string };
  if (packageInfo.version !== '12.9.0')
    throw new Error('BDD support projects require Cucumber.js 12.9.0');
  const { glob } = cucumberRequire('glob') as {
    glob: { sync(patterns: string[], options: Record<string, unknown>): string[] };
  };
  const expand = async (patterns: string[]) => {
    if (!patterns.length) return [];
    const files = glob.sync(patterns, { cwd: project, absolute: true, nodir: true });
    if (files.length > 1000) throw new Error('BDD profile exceeds 1000 support files');
    if (!files.length) throw new Error('BDD support glob matched no files');
    const canonical = await Promise.all(files.map((file) => realpath(file)));
    for (const file of canonical) {
      const relative = path.relative(project, file);
      if (relative.startsWith('..') || path.isAbsolute(relative))
        throw new Error('BDD support file escapes approved project');
      if ((await realpath(createRequire(file).resolve('@cucumber/cucumber'))) !== cucumberPath)
        throw new Error('BDD support files must resolve the same Cucumber instance as the runtime');
      if (
        !/\.(?:cjs|mjs|js|ts|cts|mts)$/.test(file) ||
        (/\.(?:ts|cts|mts)$/.test(file) && profile.loader !== 'tsx')
      )
        throw new Error('Unsupported BDD support file or missing TypeScript loader');
    }
    return canonical;
  };
  if (profile.loader) projectRequire.resolve('tsx/esm/api');
  return {
    apiPath,
    requirePaths: await expand(profile.requirePaths),
    importPaths: await expand(profile.importPaths),
  };
}
