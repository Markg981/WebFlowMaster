import { beforeEach, describe, expect, it, vi } from 'vitest';

const publishDirectory = vi.fn();
const update = vi.fn();
vi.mock('../../tenancy/artifact-store', () => ({ artifactStore: () => ({ publishDirectory }) }));
vi.mock('../../platform/middleware/tenancy', () => ({
  withTenantTransaction: (work: (tx: unknown) => unknown) =>
    work({
      update: () => ({
        set: (values: unknown) => {
          update(values);
          return { where: () => ({ returning: async () => [] }) };
        },
      }),
    }),
}));
vi.mock('../../http/websocket', () => ({ getWsEmitter: () => ({ emitExecutionLog: vi.fn() }) }));
vi.mock('../../platform/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { QuotaError } from '../../tenancy/tenant-quotas';
import { publishArtifacts } from './artifacts';

beforeEach(() => {
  publishDirectory.mockReset();
  update.mockReset();
});

describe('publishArtifacts', () => {
  it('retries a failed upload and records nothing when a later attempt works', async () => {
    publishDirectory.mockRejectedValueOnce(new Error('blip')).mockResolvedValueOnce(1);
    await publishArtifacts('results/p/r', 'r', 0);
    expect(publishDirectory).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
  });

  it('gives up after three attempts and marks the run so the report shows it', async () => {
    publishDirectory.mockRejectedValue(new Error('bucket down'));
    await publishArtifacts('results/p/r', 'r', 0);
    expect(publishDirectory).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenCalledWith({ artifactStorageStatus: 'error' });
  });

  it('does not retry a quota refusal', async () => {
    publishDirectory.mockRejectedValue(
      new QuotaError('artifact_quota_exceeded', 'artifact_bytes', 2, 1),
    );
    await publishArtifacts('results/p/r', 'r', 0);
    expect(publishDirectory).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ artifactStorageStatus: 'quota_exceeded' });
  });
});
