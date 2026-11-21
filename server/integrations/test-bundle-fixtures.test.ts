import { describe, it, expect } from 'vitest';
import { insertTestSchema, type Test } from '@shared/schema';
import { exportBundle, parseBundle, TEST_FIELDS } from './test-bundle';

/**
 * A test file carries the teardown of a test's data fixtures: exporting and importing it must keep
 * the script and the policy, for an inline fixture and for a reference to the library.
 */

const dataFixtures = [
  {
    id: 'fx-customer',
    name: 'Customer Ann',
    alias: 'customer',
    connection: null,
    params: [{ name: 'email', type: 'string', value: 'ann@shop.test' }],
    check: 'SELECT id FROM customers WHERE email = {{params.email}}',
    apply: 'INSERT INTO customers (email) VALUES ({{params.email}})',
    teardown: 'DELETE FROM customers WHERE id = {{fx.customer.id}}',
    teardownPolicy: 'onSuccess',
    outputs: ['id'],
    timeoutMs: 10_000,
  },
  {
    kind: 'ref',
    id: 'fx-orders',
    alias: 'orders',
    fixtureId: 7,
    version: 'latest',
    params: {},
    teardownPolicy: 'never',
  },
];

describe('the test file and fixture teardown', () => {
  it('keeps the teardown script and policy through export and import', () => {
    const test = {
      name: 'Checkout',
      url: '{{baseUrl}}',
      sequence: [],
      dataFixtures,
    } as unknown as Test;
    for (const format of ['yaml', 'json'] as const) {
      const exported = exportBundle({ project: 'Shop', tests: [test], apiTests: [] }, format);
      const bundle = parseBundle(exported.content);
      const raw = bundle.tests[0];
      expect(TEST_FIELDS).toContain('dataFixtures');
      const parsed = insertTestSchema.safeParse({ elements: [], ...raw, projectId: 1 });
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      const fixtures = parsed.data!.dataFixtures as Array<Record<string, unknown>>;
      expect(fixtures[0].teardown).toBe('DELETE FROM customers WHERE id = {{fx.customer.id}}');
      expect(fixtures[0].teardownPolicy).toBe('onSuccess');
      expect(fixtures[1].teardownPolicy).toBe('never');
    }
  });
});
