import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { privilegedDb } from './db';
import { environments, secrets } from '@shared/schema';
import { encryptSecret } from './crypto';
import { createTestOrganization, createTestUser } from './tests/factories';
import { resolveVariables } from './variables';

/**
 * One source of `{{name}}` values.
 *
 * There were two, and they resolved different things: the test-plan path read the
 * encrypted `secrets` table, while the single-test and ad-hoc paths called
 * `requestVariables()`, which returned exactly one variable from a process env var. So a
 * recorded `{{secret_password}}` resolved inside a plan and was typed into the app under
 * test verbatim everywhere else.
 */

let organizationId: number;
let userId: number;
let savedBaseUrl: string | undefined;

beforeAll(async () => {
  organizationId = await createTestOrganization('Variables Org');
  userId = await createTestUser(organizationId, 'variables-user');
  savedBaseUrl = process.env.DMO_BASE_URL;
});

afterAll(() => {
  if (savedBaseUrl === undefined) delete process.env.DMO_BASE_URL;
  else process.env.DMO_BASE_URL = savedBaseUrl;
});

beforeEach(async () => {
  await privilegedDb.delete(secrets);
  await privilegedDb.delete(environments);
  delete process.env.DMO_BASE_URL;
});

async function makeEnvironment(name: string): Promise<number> {
  const [row] = await privilegedDb
    .insert(environments)
    .values({ name, userId, organizationId })
    .returning();
  return row.id;
}

async function addSecret(environmentId: number, keyName: string, value: string) {
  const { encryptedValue, iv, authTag } = encryptSecret(value);
  await privilegedDb
    .insert(secrets)
    .values({ environmentId, keyName, encryptedValue, iv, authTag, userId, organizationId });
}

describe('resolveVariables', () => {
  it('always provides baseUrl, even with no environment selected', async () => {
    process.env.DMO_BASE_URL = 'https://dmo.example.test';

    const vars = await resolveVariables({ userId, organizationId });

    expect(vars.baseUrl).toBe('https://dmo.example.test');
  });

  it('decrypts the selected environment secrets by key name', async () => {
    const environmentId = await makeEnvironment('Acceptance');
    await addSecret(environmentId, 'secret_password', 'hunter2');
    await addSecret(environmentId, 'apiUser', 'svc-account');

    const vars = await resolveVariables({ userId, organizationId, environmentId });

    expect(vars.secret_password).toBe('hunter2');
    expect(vars.apiUser).toBe('svc-account');
  });

  it('lets an environment override baseUrl, so a project is not tied to one process env var', async () => {
    process.env.DMO_BASE_URL = 'https://from-the-process.test';
    const environmentId = await makeEnvironment('Site B');
    await addSecret(environmentId, 'baseUrl', 'https://site-b.factory.test');

    const vars = await resolveVariables({ userId, organizationId, environmentId });

    expect(vars.baseUrl).toBe('https://site-b.factory.test');
  });

  it('does not leak another organization environment secrets', async () => {
    const otherOrg = await createTestOrganization('Other Org');
    const otherUser = await createTestUser(otherOrg, 'other-user');
    const [foreign] = await privilegedDb
      .insert(environments)
      .values({ name: 'Foreign', userId: otherUser, organizationId: otherOrg })
      .returning();
    const { encryptedValue, iv, authTag } = encryptSecret('not-yours');
    await privilegedDb.insert(secrets).values({
      environmentId: foreign.id, keyName: 'secret_password',
      encryptedValue, iv, authTag, userId: otherUser, organizationId: otherOrg,
    });

    const vars = await resolveVariables({ userId, organizationId, environmentId: foreign.id });

    expect(vars.secret_password).toBeUndefined();
  });

  it('reports an unknown environment as no secrets rather than throwing', async () => {
    const vars = await resolveVariables({ userId, organizationId, environmentId: 999999 });

    expect(vars.baseUrl).toBeTruthy();
    expect(Object.keys(vars)).toEqual(['baseUrl']);
  });
});

describe('unresolved secret placeholders', () => {
  it('names the variables a value still needs', async () => {
    const { findUnresolvedVariables } = await import('./variables');

    expect(findUnresolvedVariables('{{secret_password}}', { baseUrl: 'x' })).toEqual([
      'secret_password',
    ]);
    expect(findUnresolvedVariables('{{baseUrl}}/orders', { baseUrl: 'x' })).toEqual([]);
  });
});
