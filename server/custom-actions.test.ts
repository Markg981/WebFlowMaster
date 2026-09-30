import { describe, it, expect } from 'vitest';
import { argumentsHint, checkArguments, customActionIdOf, parseArguments } from '@shared/custom-actions';
import { AdhocTestStepSchema } from '@shared/schema';
import { expandCustomActions, type LoadedCustomAction } from './custom-actions';

const action: LoadedCustomAction = {
  id: 'a1',
  name: 'Open order',
  parameters: [
    { name: 'code', required: true },
    { name: 'qty', required: false },
  ],
  script: 'return args.code;',
};

const call = (value: string, id = 'a1') => ({ action: { id: `customAction:${id}`, name: 'Open order' }, value });

describe('arguments', () => {
  it('reads name=value pairs, keeping escaped semicolons and placeholders', () => {
    expect(parseArguments('code=4711; qty = 2')).toEqual({ args: { code: '4711', qty: '2' } });
    expect(parseArguments('code=a\\;b')).toEqual({ args: { code: 'a;b' } });
    expect(parseArguments('code={{orderNo}}')).toEqual({ args: { code: '{{orderNo}}' } });
    expect(parseArguments('')).toEqual({ args: {} });
    expect(parseArguments('just text')).toHaveProperty('error');
  });

  it('names missing and unknown arguments', () => {
    expect(checkArguments(action.parameters, { qty: '1' })).toBe('Missing argument(s): code.');
    expect(checkArguments(action.parameters, { code: '1', colour: 'red' })).toBe('Unknown argument(s): colour.');
    expect(checkArguments(action.parameters, { code: '1' })).toBeNull();
    expect(argumentsHint(action.parameters)).toBe('code=…; qty=… (optional)');
  });

  it('recognises a call and accepts it as a step', () => {
    expect(customActionIdOf('customAction:a1')).toBe('a1');
    expect(customActionIdOf('click')).toBeNull();
    const step = { id: 's1', action: { id: 'customAction:a1', type: 'custom', name: 'Open order', icon: 'Puzzle', description: '' }, value: 'code=1' };
    expect(AdhocTestStepSchema.safeParse(step).success).toBe(true);
    expect(AdhocTestStepSchema.safeParse({ ...step, action: { ...step.action, id: 'customAction:../x' } }).success).toBe(false);
  });
});

describe('expandCustomActions', () => {
  it('turns a call into a script step with its arguments, named after the action', () => {
    const { steps, errors } = expandCustomActions([call('code=4711')], [action]);
    expect(errors).toEqual([]);
    expect(steps[0]).toMatchObject({ action: { id: 'executeScript', name: 'Open order' }, value: 'return args.code;', args: { code: '4711' } });
  });

  it('refuses an action that no longer exists, and arguments that do not fit, rather than skipping them', () => {
    expect(expandCustomActions([call('code=1', 'gone')], [action]).errors[0]).toContain('no longer exists');
    expect(expandCustomActions([call('qty=1')], [action]).errors[0]).toContain('Missing argument(s): code.');
    expect(expandCustomActions([call('code')], [action]).errors[0]).toContain('is not name=value');
  });

  it('leaves every other step alone', () => {
    const click = { action: { id: 'click' }, value: '' };
    expect(expandCustomActions([click], []).steps).toEqual([click]);
  });
});

describe('running a custom action', () => {
  it('hands the script its arguments, resolved and serialised, and its element', async () => {
    const { chromium } = await import('playwright');
    const { executeStep } = await import('./step-executor');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent('<button id="b" data-code="4711">Order</button>');

    const run = (value: string, args: Record<string, string>, selector?: string) =>
      executeStep(
        { page, vars: { who: `O'Brien "the" tester` } },
        { action: { id: 'executeScript', name: 'Check' }, value, args, targetElement: selector ? { selector } : null },
      );

    // A value with both kinds of quote arrives intact instead of breaking the script.
    expect((await run('return args.name === `O\'Brien "the" tester`;', { name: '{{who}}' })).status).toBe('passed');
    expect((await run('return element.dataset.code === args.code;', { code: '4711' }, '#b')).status).toBe('passed');
    expect((await run('if (element !== null) throw new Error("x"); return true;', {}, 'text=Order')).status).toBe('passed');
    const failedStep = await run('return false;', {});
    expect(failedStep).toMatchObject({ status: 'failed', error: 'The script returned false.' });
    expect((await run('return true;', { code: '{{missing}}' })).error).toContain('Argument code');

    await browser.close();
  }, 60_000);
});
