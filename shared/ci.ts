import { z } from 'zod';

/**
 * Where a run started from CI came from: the build, the commit, the branch.
 *
 * A run a pipeline started said only "triggered by api". From the report there was no way back to
 * the commit it tested or the build that asked for it. From the build, the only way to the report
 * was to go looking. The CLI reads this out of the CI system's own environment variables and sends
 * it with the run. It is recorded, shown on the report, and carried by the notification and the
 * exported files, so each end links to the other.
 */

export const CI_PROVIDERS = ['github', 'gitlab', 'jenkins', 'azure', 'bitbucket', 'circleci', 'other'] as const;
export type CiProvider = (typeof CI_PROVIDERS)[number];

export const CI_PROVIDER_NAMES: Record<CiProvider, string> = {
  github: 'GitHub Actions',
  gitlab: 'GitLab CI',
  jenkins: 'Jenkins',
  azure: 'Azure Pipelines',
  bitbucket: 'Bitbucket Pipelines',
  circleci: 'CircleCI',
  other: 'CI',
};

const text = (max: number) => z.string().trim().min(1).max(max);

/** A link the report will render: http(s) only, so a javascript: URL is refused here and not escaped later. */
const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'Only http and https links');

export const ciContextSchema = z
  .object({
    provider: z.enum(CI_PROVIDERS),
    repository: text(300).optional(),
    commit: z.string().trim().regex(/^[0-9a-f]{7,64}$/i, 'A commit is a hexadecimal hash').optional(),
    branch: text(300).optional(),
    pullRequest: text(50).optional(),
    buildId: text(200).optional(),
    buildUrl: httpUrl.optional(),
    /** Who or what started the build: a user name, "schedule", a bot. */
    actor: text(200).optional(),
  })
  .strict();

export type CiContext = z.infer<typeof ciContextSchema>;

/** One line: "GitHub Actions · acme/shop@3f2a1c9 on main · PR 42 · build 1234". */
export function describeCi(ci: CiContext): string {
  const parts: string[] = [CI_PROVIDER_NAMES[ci.provider]];
  const where = [ci.repository, ci.commit ? ci.commit.slice(0, 7) : null].filter(Boolean).join('@');
  if (where || ci.branch) parts.push(`${where}${ci.branch ? `${where ? ' ' : ''}on ${ci.branch}` : ''}`);
  if (ci.pullRequest) parts.push(`PR ${ci.pullRequest}`);
  if (ci.buildId) parts.push(`build ${ci.buildId}`);
  return parts.join(' · ');
}
