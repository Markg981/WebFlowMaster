/**
 * Running a list of jobs a few at a time.
 *
 * A plan's tests have always run strictly one after another, and since browsers became a
 * matrix they run once per browser as well: forty tests on three browsers is a hundred and
 * twenty browser sessions end to end. That is a nightly job, not a pipeline step.
 *
 * Deliberately not `Promise.all` over everything: each job here starts a real browser, and an
 * unbounded fan-out does not run a suite faster, it runs the machine out of memory and then
 * reports the tests that were evicted as failures of the application under test.
 */

/**
 * Runs `tasks` with at most `limit` in flight, and settles every one of them.
 *
 * Results come back in the order the tasks were given, whatever order they finished in, so a
 * caller can still say "this is test three's result". Rejections are returned rather than
 * thrown: a run whose fourth test threw has still genuinely run the other nineteen, and
 * abandoning their results would turn one broken test into a lost run.
 */
export async function runWithConcurrency<T>(
  limit: number,
  tasks: Array<() => Promise<T>>,
): Promise<PromiseSettledResult<T>[]> {
  const ceiling = Math.max(1, Math.floor(limit));
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;

  async function worker(): Promise<void> {
    // `next++` is atomic here only because JavaScript is single-threaded between awaits:
    // the read and the increment happen in one synchronous step, so two workers can never
    // take the same index.
    while (next < tasks.length) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  // No more workers than there is work: a limit of eight over two tasks should start two.
  const workers = Array.from({ length: Math.min(ceiling, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * How many jobs this installation will allow at once, whatever a plan asks for.
 *
 * The plan's number is a statement about the suite; this is a statement about the machine,
 * and the machine wins. An operator who has sized a container for four browsers should not
 * have that decided by whoever edits a test plan.
 */
export function concurrencyCeiling(): number {
  const configured = Number(process.env.RUN_MAX_PARALLEL);
  if (!Number.isFinite(configured) || configured < 1) return 16;
  return Math.floor(configured);
}

/** What a plan asked for, bounded by what this installation allows. */
export function effectiveConcurrency(requested: number | null | undefined): number {
  const asked = Number.isFinite(requested) && (requested as number) > 0 ? Math.floor(requested as number) : 1;
  return Math.max(1, Math.min(asked, concurrencyCeiling()));
}
