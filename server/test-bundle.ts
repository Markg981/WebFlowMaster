import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import type { ApiTest, Test, MobileTest } from '@shared/schema';
import type { MobileGroupDefinition } from '@shared/mobile-groups';
import { exportMobileCatalog } from './mobile-bundle';
import { referencedGroupIds } from './step-groups';
import { referencedCustomActionIds } from './custom-actions';
import { referencedElementIds } from './step-elements';
import { asSteps } from './step-groups';
import { exportGherkin, parseGherkin, autodetectGherkin } from './gherkin';
import type { GherkinImportOptions } from '@shared/bdd';

/**
 * An organization's tests as a file to keep under version control: the web and API tests of a
 * project, in YAML (or JSON), with stable keys and nothing that belongs to one installation — no
 * ids, authors, organizations or timestamps — so a diff shows what changed in the tests and nothing
 * else. Importing the file back updates the tests of the same name and creates the others; each
 * update is a new version of the test, as a save from the builder is.
 *
 * Steps are kept as stored. A step that calls a step group or a custom action, or names an element
 * of the project's repository, refers to it by id: such a test round-trips within its organization,
 * and the export says which tests do, for anyone moving them elsewhere.
 *
 * Secrets stay out: a literal token, password, API key or client secret in an API test's
 * authorization is written as a {{variable}} instead, and listed, so the file can be committed.
 */

export const BUNDLE_KIND = 'webflowmaster/tests';
export const BUNDLE_VERSION = 2;

const TEST_FIELDS = [
  'name', 'url', 'module', 'featureArea', 'scenario', 'component', 'priority', 'severity', 'status',
  'sequence', 'preconditions', 'cleanups', 'dataset', 'bdd',
] as const;

const API_TEST_FIELDS = [
  'name', 'method', 'url', 'module', 'featureArea', 'scenario', 'component', 'priority', 'severity',
  'queryParams', 'requestHeaders', 'requestBody', 'assertions', 'extractions', 'performance',
  'authType', 'authParams', 'bodyType', 'bodyRawContentType', 'bodyFormData', 'bodyUrlEncoded',
  'bodyGraphqlQuery', 'bodyGraphqlVariables', 'protoDefinition', 'protocolConfig',
] as const;

/** The parameters of an authorization that are secrets, by authorization type. */
const SECRET_PARAMS: Record<string, string[]> = {
  basic: ['password'],
  bearer: ['token'],
  apiKey: ['value'],
  jwtBearer: ['secret', 'privateKey'],
  digest: ['password'],
  oauth1: ['consumerSecret', 'token', 'tokenSecret'],
  oauth2: ['clientSecret', 'password', 'accessToken', 'refreshToken'],
  hawk: ['authKey'],
  aws: ['secretKey', 'sessionToken'],
  ntlm: ['password'],
  akamai: ['clientToken', 'clientSecret', 'accessToken'],
  asap: ['privateKey'],
};

export interface BundleExport {
  content: string;
  fileName: string;
  /** Literal secrets replaced by variables, as `test: parameter → {{variable}}`. */
  secretsReplaced: string[];
  /** Tests whose steps refer to groups, custom actions or repository elements by id. */
  withReferences: string[];
}

function pick<T extends Record<string, unknown>>(row: T, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = row[field];
    // Empty values are left out, so a file holds what a test has and a diff shows only that.
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0 && field !== 'sequence') continue;
    out[field] = value;
  }
  return out;
}

function withoutSecrets(test: Record<string, unknown>, replaced: string[]): Record<string, unknown> {
  const auth = test.authParams as { type?: string; params?: Record<string, unknown> } | undefined;
  const keys = auth?.type ? SECRET_PARAMS[auth.type] ?? [] : [];
  if (!auth?.params || keys.length === 0) return test;
  const params = { ...auth.params };
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value !== '' && !/^\s*\{\{.*\}\}\s*$/.test(value)) {
      const variable = `${auth.type}_${key}`;
      params[key] = `{{${variable}}}`;
      replaced.push(`${String(test.name)}: ${key} → {{${variable}}}`);
    }
  }
  return { ...test, authParams: { ...auth, params } };
}

export function exportBundle(
  input: { project: string | null; tests: Test[]; apiTests: ApiTest[];mobileTests?:MobileTest[];mobileStepGroups?:MobileGroupDefinition[] },
  format: 'yaml' | 'json' | 'gherkin' = 'yaml',
): BundleExport {
  const secretsReplaced: string[] = [];
  const withReferences: string[] = [];
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
  const tests = [...input.tests].sort(byName).map((test) => {
    const steps = asSteps(test.sequence);
    if (referencedGroupIds(test.sequence).length || referencedCustomActionIds(steps).length || referencedElementIds(test.sequence).length) {
      withReferences.push(test.name);
    }
    return pick(test as unknown as Record<string, unknown>, TEST_FIELDS);
  });
  const apiTests = [...input.apiTests]
    .sort(byName)
    .map((test) => withoutSecrets(pick(test as unknown as Record<string, unknown>, API_TEST_FIELDS), secretsReplaced));
  if (format === 'gherkin') {
    return { ...exportGherkin({ project: input.project, tests }), secretsReplaced: [], withReferences };
  }
  let native;
  try {native=exportMobileCatalog(input.mobileTests??[],input.mobileStepGroups??[]);}catch(error){throw new BundleError((error as Error).message);}
  const bundle = { kind: BUNDLE_KIND, version: BUNDLE_VERSION, project: input.project, tests, apiTests,...native };
  const content = format === 'json' ? `${JSON.stringify(bundle, null, 2)}\n` : toYaml(bundle, { lineWidth: 0 });
  const slug = (input.project ?? 'tests').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tests';
  return { content, fileName: `${slug}.wfm.${format === 'json' ? 'json' : 'yaml'}`, secretsReplaced, withReferences };
}

const bundleSchema = z.object({
  kind: z.literal(BUNDLE_KIND),
  version: z.number().int().min(1),
  project: z.string().nullable().optional(),
  tests: z.array(z.record(z.unknown())).max(2000).default([]),
  apiTests: z.array(z.record(z.unknown())).max(2000).default([]),
  mobileTests: z.array(z.record(z.unknown())).max(2000).default([]),
  mobileStepGroups: z.array(z.record(z.unknown())).max(2000).default([]),
});
export type Bundle = z.infer<typeof bundleSchema>;

export class BundleError extends Error {}

/** Reads a bundle; the tests in it are checked one by one by the caller, against the same schemas as a save. */
export function parseBundle(content: string, format?: 'gherkin', bdd?:GherkinImportOptions): Bundle {
  let doc: unknown;
  const text = content.trim();
  const gherkinBundle = (): Bundle => ({ kind: BUNDLE_KIND, version: BUNDLE_VERSION, ...parseGherkin(content,bdd),mobileTests:[],mobileStepGroups:[] });
  if (format === 'gherkin') {
    return gherkinBundle();
  }
  try {
    doc = text.startsWith('{') ? JSON.parse(text) : parseYaml(text, { maxAliasCount: 100 });
  } catch (error) {
    if (autodetectGherkin(text)) return gherkinBundle();
    throw new BundleError(`Not JSON or YAML: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
  // A YAML bundle can contain indented Feature/language lines inside bdd.source.
  // Its envelope takes precedence over detecting those embedded lines as a feature file.
  const hasBundleKind = doc !== null && typeof doc === 'object' && !Array.isArray(doc) && (doc as Record<string,unknown>).kind === BUNDLE_KIND;
  if (!hasBundleKind && autodetectGherkin(text)) return gherkinBundle();
  const parsed = bundleSchema.safeParse(doc);
  if (!parsed.success) {
    throw new BundleError(`Not a WebFlowMaster test file (kind: ${BUNDLE_KIND}): ${parsed.error.issues[0]?.path.join('.') || 'top'} ${parsed.error.issues[0]?.message ?? ''}`.trim());
  }
  if (parsed.data.version > BUNDLE_VERSION) {
    throw new BundleError(`This file is version ${parsed.data.version}; this installation reads up to version ${BUNDLE_VERSION}. Update WebFlowMaster first.`);
  }
  return parsed.data;
}

/** Whether a stored row already says what the file says, field by field: an unchanged test is not saved again. */
export function sameAs(row: Record<string, unknown>, incoming: Record<string, unknown>, fields: readonly string[]): boolean {
  const norm = (v: unknown) => (v === undefined || v === null || (Array.isArray(v) && v.length === 0) ? null : v);
  return fields.every((field) => field === 'name' || isDeepStrictEqual(norm(row[field]), norm(incoming[field])));
}

export { TEST_FIELDS, API_TEST_FIELDS };
