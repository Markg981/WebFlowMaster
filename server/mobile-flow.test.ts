import { describe, it, expect, vi } from 'vitest';
import { executeMobileFlow } from './mobile-flow';
import type { AppiumSession } from './appium-client';
import type { MobileExecutionStep } from '@shared/mobile';

const session = () =>
  ({
    find: vi.fn(async () => null),
    displayed: vi.fn(async () => true),
    text: vi.fn(async () => 'Welcome'),
  }) as unknown as AppiumSession;
const execute = (steps: MobileExecutionStep[], s = session(), vars = {}) => {
  const primitive = vi.fn(
    async (_step: MobileExecutionStep): Promise<string | undefined> => undefined,
  );
  return {
    primitive,
    result: executeMobileFlow({ steps, platform: 'android', vars, session: s, primitive }),
  };
};
describe('native flow traversal', () => {
  it('chooses else and marks the other branch skipped', async () => {
    const { primitive, result } = execute([
      { id: 'i', action: 'if', value: 'false' },
      { id: 'no', action: 'back' },
      { id: 'el', action: 'else' },
      { id: 'yes', action: 'back' },
      { id: 'end', action: 'endIf' },
    ]);
    const out = await result;
    expect(out.failure).toBeNull();
    expect(primitive.mock.calls[0][0].id).toBe('yes');
    expect(out.results.find((row) => row.stepId === 'no')).toMatchObject({
      status: 'skipped',
      skipReason: 'branch',
    });
  });
  it('repeats with distinct iteration provenance and restores nested indices', async () => {
    const vars: Record<string, string> = {};
    const seen: string[] = [];
    const steps: MobileExecutionStep[] = [
      { id: 'r', action: 'repeat', value: '2' },
      { id: 'inner', action: 'repeat', value: '2' },
      { id: 'b', action: 'back' },
      { id: 'e', action: 'endLoop' },
      { id: 'outer', action: 'back' },
      { id: 'end', action: 'endLoop' },
    ];
    const out = await executeMobileFlow({
      steps,
      platform: 'android',
      vars,
      session: session(),
      primitive: async () => {
        seen.push(vars.loopIndex);
        return undefined;
      },
    });
    expect(out.failure).toBeNull();
    expect(seen).toEqual(['1', '2', '1', '1', '2', '2']);
    expect(vars.loopIndex).toBeUndefined();
    expect(out.results.filter((row) => row.stepId === 'b').map((row) => row.iterationKey)).toEqual([
      'iter_1_1',
      'iter_1_2',
      'iter_2_1',
      'iter_2_2',
    ]);
  });
  it('propagates transport errors instead of choosing false', async () => {
    const s = session();
    vi.mocked(s.find).mockRejectedValue(new Error('offline'));
    const { result } = execute(
      [
        { id: 'i', action: 'if', target: '~banner', value: 'visible' },
        { id: 'e', action: 'endIf' },
      ],
      s,
    );
    expect((await result).failure).toBe('offline');
  });
  it('bounds endless conditional loops and rejects unresolved counts', async () => {
    const endless = execute([
      { id: 'r', action: 'repeatWhile', value: 'true' },
      { id: 'e', action: 'endLoop' },
    ]);
    expect((await endless.result).failure).toMatch(/200/);
    const missing = execute([
      { id: 'r', action: 'repeat', value: '{{count}}' },
      { id: 'e', action: 'endLoop' },
    ]);
    expect((await missing.result).failure).toMatch(/Unresolved/);
  });
  it('bounds total visits in nested fixed loops and fails false assertions', async () => {
    const nested = execute([
      { id: 'outer', action: 'repeat', value: '200' },
      { id: 'inner', action: 'repeat', value: '200' },
      { id: 'body', action: 'back' },
      { id: 'end-inner', action: 'endLoop' },
      { id: 'end-outer', action: 'endLoop' },
    ]);
    expect((await nested.result).failure).toMatch(/10000/);
    const assertion = execute([
      { id: 'a', action: 'assertCondition', value: 'false' },
      { id: 'b', action: 'back' },
    ]);
    const result = await assertion.result;
    expect(result.failure).toMatch(/assertion/);
    expect(result.results[1]).toMatchObject({ status: 'skipped', skipReason: 'failure' });
  });
});
