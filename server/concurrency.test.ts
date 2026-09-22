import { describe, it, expect, afterEach } from 'vitest';
import { concurrencyCeiling, effectiveConcurrency, runWithConcurrency } from './concurrency';

/**
 * A plan ran its tests strictly one at a time, and once browsers became a matrix it ran each
 * test once per browser — sequentially. These are the rules by which several now run at once,
 * and the two things that must not change: the order of the results, and the fact that one
 * broken task does not cost the run the others.
 */

const deferred = () => {
  let resolve!: (value?: unknown) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res as typeof resolve;
    reject = rej;
  });
  return { promise, resolve, reject };
};

afterEach(() => {
  delete process.env.RUN_MAX_PARALLEL;
});

describe('runWithConcurrency', () => {
  it('never has more than the limit in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 10 }, () => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return 'done';
    });

    await runWithConcurrency(3, tasks);

    expect(peak).toBe(3);
  });

  it('returns results in the order the tasks were given, not the order they finished', async () => {
    const slow = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 'slow';
    };
    const fast = async () => 'fast';

    const results = await runWithConcurrency(2, [slow, fast]);

    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : r.reason))).toEqual(['slow', 'fast']);
  });

  it('runs the remaining tasks when one of them throws, and reports which', async () => {
    const results = await runWithConcurrency(2, [
      async () => 'first',
      async () => {
        throw new Error('boom');
      },
      async () => 'third',
    ]);

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'first' });
    expect(results[1].status).toBe('rejected');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'third' });
  });

  it('actually overlaps work rather than merely promising to', async () => {
    const first = deferred();
    const second = deferred();
    let secondStarted = false;

    const all = runWithConcurrency(2, [
      async () => {
        await first.promise;
        return 1;
      },
      async () => {
        secondStarted = true;
        await second.promise;
        return 2;
      },
    ]);

    await Promise.resolve();
    expect(secondStarted).toBe(true);

    first.resolve();
    second.resolve();
    await all;
  });

  it('starts no more workers than there is work', async () => {
    let started = 0;
    const results = await runWithConcurrency(8, [
      async () => {
        started++;
        return 'a';
      },
      async () => {
        started++;
        return 'b';
      },
    ]);

    expect(started).toBe(2);
    expect(results).toHaveLength(2);
  });

  it('treats a nonsense limit as one', async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 4 }, () => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return null;
    });

    await runWithConcurrency(0, tasks);

    expect(peak).toBe(1);
  });

  it('does nothing, successfully, when there is nothing to do', async () => {
    expect(await runWithConcurrency(4, [])).toEqual([]);
  });
});

describe('effectiveConcurrency', () => {
  it("lets the machine's limit overrule what a plan asked for", () => {
    process.env.RUN_MAX_PARALLEL = '4';

    expect(effectiveConcurrency(16)).toBe(4);
    expect(effectiveConcurrency(2)).toBe(2);
  });

  it('defaults to one, which is what every plan did before this existed', () => {
    expect(effectiveConcurrency(null)).toBe(1);
    expect(effectiveConcurrency(undefined)).toBe(1);
    expect(effectiveConcurrency(0)).toBe(1);
    expect(effectiveConcurrency(-3)).toBe(1);
  });

  it('ignores a ceiling that is not a usable number', () => {
    process.env.RUN_MAX_PARALLEL = 'lots';
    expect(concurrencyCeiling()).toBe(16);

    process.env.RUN_MAX_PARALLEL = '0';
    expect(concurrencyCeiling()).toBe(16);
  });
});
