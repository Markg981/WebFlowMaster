import { describe, expect, it, vi } from 'vitest';

const transition = vi.fn();
vi.mock('../execution-state', () => ({
  transitionExecution: (...args: unknown[]) => transition(...args),
}));

describe('transitionWithRetry', () => {
  it('survives one failed transition', async () => {
    transition.mockRejectedValueOnce(new Error('blip')).mockResolvedValueOnce({ id: 'x' });
    const { transitionWithRetry } = await import('./finalize');
    await expect(transitionWithRetry('x', 'passed', {} as never)).resolves.toEqual({ id: 'x' });
    expect(transition).toHaveBeenCalledTimes(2);
  });
});
