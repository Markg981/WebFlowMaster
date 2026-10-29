import { describe, expect, it, vi } from 'vitest';

describe('TracedQueue.add', () => {
  it('rejects instead of hanging when the queue never answers', async () => {
    vi.resetModules();
    vi.stubEnv('QUEUE_SUBMIT_TIMEOUT_MS', '50');
    vi.doMock('bullmq', () => ({
      Queue: class {
        add() {
          return new Promise(() => {});
        }
      },
    }));
    const { TracedQueue } = await import('./queue');
    const queue = new (
      TracedQueue as unknown as new () => {
        add: (name: string, data: object) => Promise<unknown>;
      }
    )();
    await expect(queue.add('job', {})).rejects.toThrow(/did not accept the job/);
    vi.unstubAllEnvs();
  });
});
