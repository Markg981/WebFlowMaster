import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { allowedCommands, type DebugState } from '@shared/debug-session';
import { applyPatch, debugChannel, memoryDebugChannel, DebugController } from './debug-session';
import { performBrowserTask } from './browser-tasks';
import { createTestOrganization, createTestUser } from './tests/factories';

/**
 * Debugging a test from the builder: stopping before a step, one step at a time, where a step
 * fails — and correcting it there and going on, in a real browser.
 */

describe('what a session accepts', () => {
  const paused = (reason: 'breakpoint' | 'failure', canSkip = true) =>
    ({ status: 'paused', paused: { reason, canSkip } }) as unknown as DebugState;

  it('depends on why it stopped', () => {
    expect(allowedCommands({ status: 'running', paused: null })).toEqual(['pause', 'stop', 'breakpoints']);
    expect(allowedCommands(paused('breakpoint'))).toEqual(['continue', 'step', 'skip', 'stop', 'breakpoints']);
    expect(allowedCommands(paused('failure'))).toEqual(['retry', 'skip', 'stop', 'breakpoints']);
    // An if, a loop or their ends cannot be passed over: the blocks would no longer close.
    expect(allowedCommands(paused('breakpoint', false))).not.toContain('skip');
    expect(allowedCommands({ status: 'finished', paused: null })).toEqual([]);
  });

  it('corrects a step without touching the original', () => {
    const step = { id: 's', targetElement: { selector: '#a', tag: 'button' }, value: 'x' };
    const { step: next, corrected } = applyPatch(step, { selector: ' #b ', value: 'y' });
    expect(corrected).toBe(true);
    expect(next).toMatchObject({ targetElement: { selector: '#b', tag: 'button' }, value: 'y' });
    expect(step.targetElement.selector).toBe('#a');
    expect(applyPatch(step, { selector: '#a', value: 'x' }).corrected).toBe(false);
    expect(applyPatch(step, undefined).corrected).toBe(false);
  });

  it('waits for a command, and gives up when none comes', async () => {
    const channel = memoryDebugChannel();
    await channel.open('c', { userId: 1, organizationId: 1, createdAt: '' });
    expect(await channel.next('c', 20)).toBeNull();
    setTimeout(() => void channel.send('c', { type: 'continue' }), 10);
    expect(await channel.next('c', 1000)).toEqual({ type: 'continue' });
    await channel.send('c', { type: 'pause' });
    await channel.send('c', { type: 'stop' });
    expect(await channel.drain('c')).toEqual([{ type: 'pause' }, { type: 'stop' }]);
  });

  it('closes a session left paused', async () => {
    const channel = memoryDebugChannel();
    await channel.open('idle', { userId: 1, organizationId: 1, createdAt: '' });
    const controller = new DebugController('idle', channel, { breakpoints: ['s1'], environmentKeys: [], idleTimeoutMs: 30 });
    const decision = await controller.beforeStep({ pc: 0, step: { id: 's1', action: { id: 'click' } }, screenshot: async () => null, url: () => null });
    expect(decision).toMatchObject({ kind: 'stop' });
  });

  it('shows the values made during the run, and only the names of the environment', async () => {
    const channel = memoryDebugChannel();
    await channel.open('v', { userId: 1, organizationId: 1, createdAt: '' });
    const controller = new DebugController('v', channel, { breakpoints: [], environmentKeys: ['password'] });
    controller.watch({ password: 'hunter2', orderId: 'A-17' });
    await controller.record({ name: 'x', type: 'click', stepId: 'x', status: 'passed', detail: '', corrected: false });
    expect((await channel.read('v'))?.variables).toEqual([
      { name: 'password', value: null },
      { name: 'orderId', value: 'A-17' },
    ]);
  });
});

describe('a debug session in a browser', () => {
  let server: http.Server;
  let baseUrl: string;
  let organizationId: number;
  let userId: number;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(`<!doctype html><title>t</title><h1 id="t">Hello</h1><button id="b" onclick="document.getElementById('t').textContent='Clicked'">Go</button>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    organizationId = await createTestOrganization('Debug Org');
    userId = await createTestUser(organizationId, 'debug-user');
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const step = (id: string, actionId: string, selector: string, value = '') => ({
    id,
    action: { id: actionId, type: actionId, name: `${actionId} ${id}`, icon: 'x', description: 'x' },
    targetElement: { id: selector, type: 'element', selector, text: '', tag: 'div', attributes: {} },
    value,
  });

  async function start(id: string, breakpoints: string[], sequence: unknown[], extra: { dataset?: Array<Record<string, string>>; datasetRow?: number } = {}) {
    const channel = await debugChannel();
    await channel.open(id, { userId, organizationId, createdAt: new Date().toISOString() });
    const done = performBrowserTask({
      task: { kind: 'debug-sequence', sessionId: id, breakpoints, datasetRow: extra.datasetRow, payload: { name: 'debug', url: baseUrl, elements: [], sequence, dataset: extra.dataset } as never },
      userId,
      organizationId,
    });
    const until = async (check: (state: DebugState) => boolean) => {
      const deadline = Date.now() + 30_000;
      for (;;) {
        const state = await channel.read(id);
        if (state && check(state)) return state;
        if (Date.now() > deadline) throw new Error(`Timed out; last state: ${JSON.stringify({ ...state, paused: state?.paused && { ...state.paused, screenshot: '…' } })}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    return { channel, done, until };
  }

  it('stops where a step fails, takes a correction, stops at a breakpoint, steps, and finishes', async () => {
    const { channel, done, until } = await start('run-1', ['s2'], [
      step('s1', 'assertTextContains', '#t', 'Helo'),
      step('s2', 'click', '#b'),
      step('s3', 'assertTextContains', '#t', 'Clicked'),
    ]);

    const failed = await until((s) => s.paused?.reason === 'failure');
    expect(failed.paused).toMatchObject({ stepId: 's1', value: 'Helo', selector: '#t', canSkip: true, url: `${baseUrl}/` });
    expect(failed.paused?.error).toBeTruthy();
    expect(failed.paused?.screenshot).toMatch(/^data:image\/jpeg;base64,/);
    await channel.send('run-1', { type: 'retry', patch: { value: 'Hello' } });

    const atBreakpoint = await until((s) => s.paused?.reason === 'breakpoint');
    expect(atBreakpoint.paused?.stepId).toBe('s2');
    expect(atBreakpoint.steps).toEqual([expect.objectContaining({ stepId: 's1', status: 'passed', corrected: true })]);
    await channel.send('run-1', { type: 'step' });

    const stepped = await until((s) => s.paused?.reason === 'step');
    expect(stepped.paused?.stepId).toBe('s3');
    await channel.send('run-1', { type: 'continue' });

    const ended = await until((s) => s.status === 'finished');
    expect(ended.outcome).toEqual({ success: true, error: null, skipped: 0 });
    expect(ended.steps.map((s) => [s.stepId, s.status])).toEqual([['s1', 'passed'], ['s2', 'passed'], ['s3', 'passed']]);
    await done;
  }, 90_000);

  it('passes over a failed step when told to, and does not call the run a pass', async () => {
    const { channel, done, until } = await start('run-2', [], [
      step('s1', 'assertTextContains', '#t', 'Nope'),
      step('s2', 'assertTextContains', '#t', 'Hello'),
    ]);

    await until((s) => s.paused?.reason === 'failure');
    await channel.send('run-2', { type: 'skip' });

    const ended = await until((s) => s.status === 'finished');
    expect(ended.outcome).toMatchObject({ success: false, skipped: 1 });
    expect(ended.steps.map((s) => s.status)).toEqual(['skipped', 'passed']);
    await done;
  }, 90_000);

  it('stops for good when told to', async () => {
    const { channel, done, until } = await start('run-3', ['s1'], [step('s1', 'click', '#b'), step('s2', 'click', '#b')]);

    await until((s) => s.paused?.reason === 'breakpoint');
    await channel.send('run-3', { type: 'stop' });

    const ended = await until((s) => s.status === 'stopped');
    expect(ended.steps).toEqual([]);
    expect(ended.outcome?.success).toBe(false);
    await done;
  }, 90_000);

  it('runs with the dataset row asked for', async () => {
    const { done, until } = await start('run-4', [], [step('s1', 'assertTextContains', '#t', '{{expected}}')], {
      dataset: [{ expected: 'Nope' }, { expected: 'Hello' }],
      datasetRow: 1,
    });
    const ended = await until((s) => s.status === 'finished');
    expect(ended.outcome).toMatchObject({ success: true });
    expect(ended.variables).toContainEqual({ name: 'expected', value: 'Hello' });
    await done;
  }, 90_000);
});
