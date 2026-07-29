import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clientLogger, setLogLevel, flushNow, __resetForTests } from './logger';

const postedBatches = () =>
  vi.mocked(globalThis.fetch).mock.calls
    .filter(([url]) => String(url) === '/api/client-logs')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

beforeEach(() => {
  __resetForTests();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 202 })));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('clientLogger', () => {
  it('flushes an error immediately', async () => {
    clientLogger.error('mutation failed', { key: 'startRecording' });
    await flushNow();

    const [batch] = postedBatches();
    expect(batch.entries).toHaveLength(1);
    expect(batch.entries[0]).toMatchObject({ level: 'error', message: 'mutation failed' });
    expect(batch.sessionId).toBeTruthy();
  });

  it('buffers below the level threshold instead of sending', async () => {
    setLogLevel('warn');
    clientLogger.debug('noisy');
    clientLogger.info('also noisy');
    await flushNow();

    expect(postedBatches()).toHaveLength(0);
  });

  it('flushes on the timer', async () => {
    vi.useFakeTimers();
    __resetForTests();
    clientLogger.info('navigation');

    await vi.advanceTimersByTimeAsync(3100);

    expect(postedBatches()[0].entries[0].message).toBe('navigation');
  });

  it('flushes once the batch size is reached', async () => {
    for (let i = 0; i < 25; i++) clientLogger.info(`entry ${i}`);
    await flushNow();

    const total = postedBatches().reduce((sum, b) => sum + b.entries.length, 0);
    expect(total).toBe(25);
  });

  /**
   * The cap only bites when the buffer cannot drain — with a working transport a flush
   * fires every 25 entries and it never grows. Removing `fetch` makes `flushNow` return
   * early, which is the closest deterministic stand-in for an unreachable server.
   */
  it('drops the oldest past the buffer cap and reports the count', async () => {
    setLogLevel('debug');
    vi.stubGlobal('fetch', undefined);

    for (let i = 0; i < 250; i++) clientLogger.debug(`entry ${i}`);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 202 })));
    await flushNow();

    const [batch] = postedBatches();
    expect(batch.entries).toHaveLength(200);
    expect(batch.dropped).toBe(50);
    // The oldest were discarded, not the newest.
    expect(batch.entries[0].message).toBe('entry 50');
    expect(batch.entries[199].message).toBe('entry 249');
  });

  /**
   * The single most important property of this module: a logger that logs its own
   * transport failures through itself is an infinite loop. Retries must be bounded.
   */
  it('never recurses when the transport keeps failing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));

    clientLogger.error('first failure');
    await flushNow();
    await flushNow();
    await flushNow();
    await flushNow();

    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('sends the buffer with sendBeacon on page dismissal', () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });

    clientLogger.info('about to leave');
    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).toHaveBeenCalledWith('/api/client-logs', expect.anything());
  });

  it('never throws out of a log call', () => {
    vi.stubGlobal('fetch', undefined);
    expect(() => clientLogger.info('still fine')).not.toThrow();
  });
});
