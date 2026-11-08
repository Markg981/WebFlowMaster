import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { aiUsage, organizations } from '@shared/schema';
import { privilegedDb } from '../platform/db';
import { runWithTenant } from '../platform/middleware/tenancy';
import { createTestOrganization } from '../tests/factories';
import { aiDailyLimit, reserveAiCall } from './ai-consent';

const DAY = new Date('2026-11-07T10:00:00Z');
const count = async (organizationId: number, day = '2026-11-07') => {
  const [row] = await privilegedDb
    .select()
    .from(aiUsage)
    .where(eq(aiUsage.organizationId, organizationId));
  return row?.day === day ? row.count : 0;
};

describe('aiDailyLimit', () => {
  it('defaults to 200 and ignores values that are not a positive integer', () => {
    expect(aiDailyLimit({})).toBe(200);
    expect(aiDailyLimit({ AI_DAILY_CALL_LIMIT: '5' })).toBe(5);
    for (const bad of ['0', '-3', 'abc', '2.5', ''])
      expect(aiDailyLimit({ AI_DAILY_CALL_LIMIT: bad })).toBe(200);
  });
});

describe('reserveAiCall', () => {
  it('refuses without consent and counts nothing', async () => {
    const org = await createTestOrganization('No consent');
    expect(await runWithTenant(org, () => reserveAiCall(org, DAY))).toEqual({
      ok: false,
      reason: 'consent',
    });
    expect(await count(org)).toBe(0);
  });

  it('counts calls with consent and refuses at the cap', async () => {
    const org = await createTestOrganization('Consent');
    await privilegedDb
      .update(organizations)
      .set({ aiEnabled: true })
      .where(eq(organizations.id, org));
    const previous = process.env.AI_DAILY_CALL_LIMIT;
    process.env.AI_DAILY_CALL_LIMIT = '2';
    try {
      const results = [];
      for (let i = 0; i < 3; i++)
        results.push(await runWithTenant(org, () => reserveAiCall(org, DAY)));
      expect(results).toEqual([{ ok: true }, { ok: true }, { ok: false, reason: 'quota' }]);
      expect(await count(org)).toBe(2);
      // The next day starts again.
      const next = new Date('2026-11-08T00:00:01Z');
      expect(await runWithTenant(org, () => reserveAiCall(org, next))).toEqual({ ok: true });
    } finally {
      if (previous === undefined) delete process.env.AI_DAILY_CALL_LIMIT;
      else process.env.AI_DAILY_CALL_LIMIT = previous;
    }
  });
});
