/** Compose process startup does not mean BullMQ has registered its worker yet. */
export async function waitForWorker(queue, { timeoutMs = 60_000, pollMs = 250 } = {}) {
  let stopped = false;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('No live worker registered within the readiness deadline')), timeoutMs);
  });
  const ready = (async () => {
    while (!stopped) {
      if ((await queue.getWorkers()).length) return;
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
  })();
  try { await Promise.race([ready, deadline]); }
  finally { stopped = true; clearTimeout(timer); }
}
