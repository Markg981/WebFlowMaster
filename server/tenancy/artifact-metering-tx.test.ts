import { beforeEach, describe, expect, it, vi } from 'vitest';
import { organizations, quotaArtifacts, testPlanExecutions } from '@shared/schema';

/**
 * TD-002. A comparison is computed in ONE tenant transaction (comparison-orchestrator `compute`),
 * and its engine reads the runs' screenshots through the metered artifact store. That store used to
 * find the owner of a `results/<plan>/<run>/...` key with the PRIVILEGED handle, beside the open
 * transaction. On PGlite (one connection) a query sent while a transaction is open waits for that
 * transaction, which waits for the read: the process stops answering every database request.
 *
 * Hermetic on purpose (no database is opened): the privileged handle here fails loudly, as the
 * wedged connection would hang, when it is used while a transaction is open.
 */
const ORG = 7;
const KEY = 'results/plan-1/exec-1/units/u_0123456789abcdef01234567/attempt_1/step.png';

const state = vi.hoisted(() => ({
  txOpen: false,
  /** What the tenant transaction can see, by table (row-level security hides the rest). */
  visible: new Map<unknown, unknown[]>(),
  /** What the privileged handle sees: every row. */
  privileged: new Map<unknown, unknown[]>(),
  privilegedCalls: 0,
}));

const rowsFrom = (source: Map<unknown, unknown[]>) => ({
  select: () => ({
    from: (table: unknown) => ({ where: async () => source.get(table) ?? [] }),
  }),
});

vi.mock('../platform/db', () => ({
  privilegedDb: {
    select: (...args: unknown[]) => {
      state.privilegedCalls += 1;
      if (state.txOpen)
        throw new Error('DEADLOCK: privileged query while a tenant transaction is open');
      return (rowsFrom(state.privileged).select as (...a: unknown[]) => unknown)(...args);
    },
  },
  withArtifactLock: async (_org: number, work: () => Promise<unknown>) => work(),
}));

vi.mock('../platform/middleware/tenancy', () => ({
  getTenantOrgId: () => ORG,
  tenantTransactionInScope: () => (state.txOpen ? rowsFrom(state.visible) : undefined),
  runWithTenant: async (_org: number, fn: () => unknown) => fn(),
  withTenantTransaction: async (fn: (tx: unknown) => unknown) => fn(rowsFrom(state.visible)),
}));

vi.mock('./tenant-quotas', () => ({
  quotaUsage: vi.fn(),
  quotasFor: vi.fn(),
  QuotaError: class QuotaError extends Error {},
}));

import { meterArtifactStore } from './artifact-metering';
import type { ArtifactStore } from './artifact-store';

function rawStore(): ArtifactStore & { read: ReturnType<typeof vi.fn> } {
  return {
    kind: 'local',
    read: vi.fn(async () => Buffer.from('png')),
    write: vi.fn(),
    open: vi.fn(),
    publishDirectory: vi.fn(),
    deletePrefix: vi.fn(),
  } as unknown as ArtifactStore & { read: ReturnType<typeof vi.fn> };
}

describe('metered artifact store inside a tenant transaction (TD-002)', () => {
  beforeEach(() => {
    state.txOpen = false;
    state.privilegedCalls = 0;
    state.visible = new Map();
    state.privileged = new Map([[testPlanExecutions, [{ organizationId: ORG }]]]);
  });

  it('finds the owner of a run key through the open transaction, not beside it', async () => {
    state.txOpen = true;
    state.visible = new Map<unknown, unknown[]>([
      [testPlanExecutions, [{ organizationId: ORG }]],
      [organizations, [{ reconciled: null }]],
      [quotaArtifacts, [{ reservationId: null }]],
    ]);
    const raw = rawStore();
    const store = meterArtifactStore(raw);

    await expect(store.read(KEY)).resolves.toEqual(Buffer.from('png'));
    expect(state.privilegedCalls).toBe(0);
    expect(raw.read).toHaveBeenCalledTimes(1);
  });

  it('does not read a run the transaction cannot see (another organization, or none)', async () => {
    state.txOpen = true;
    state.visible = new Map<unknown, unknown[]>(); // row-level security hides the execution
    const raw = rawStore();
    const store = meterArtifactStore(raw);

    await expect(store.read(KEY)).rejects.toThrow(/another organization/);
    expect(state.privilegedCalls).toBe(0);
    expect(raw.read).not.toHaveBeenCalled();
  });

  it('keeps the privileged lookup outside any transaction', async () => {
    state.txOpen = false;
    state.visible = new Map<unknown, unknown[]>([
      [organizations, [{ reconciled: null }]],
      [quotaArtifacts, [{ reservationId: null }]],
    ]);
    const raw = rawStore();
    const store = meterArtifactStore(raw);

    await expect(store.read(KEY)).resolves.toEqual(Buffer.from('png'));
    expect(state.privilegedCalls).toBe(1);
  });
});
