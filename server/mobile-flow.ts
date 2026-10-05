import { analyseFlow, FLOW_ACTION_IDS, MAX_LOOP_ITERATIONS } from '@shared/flow';
import { mobileFlowSteps, mobileStepsProblems, parseMobileLocator, type MobileExecutionStep, type MobilePlatform, type MobileStepResult } from '@shared/mobile';
import type { AppiumSession } from './appium-client';
import { FlowCursor } from './flow-cursor';
import { compareValues } from './value-comparison';
import { findUnresolvedVariables } from './variables';
import { substituteVariables } from './outbound-http';

interface Context {
  steps: MobileExecutionStep[];
  platform: MobilePlatform;
  vars: Record<string, string>;
  session: AppiumSession;
  primitive: (step: MobileExecutionStep) => Promise<string | undefined>;
  onStep?: (steps: MobileStepResult[]) => Promise<void>;
}
export function validateMobileExecution(steps: MobileExecutionStep[], platform: MobilePlatform) {
  if (steps.length > 2000) throw new Error('Expanded mobile steps exceed 2000.');
  const problems = mobileStepsProblems(steps, platform);
  if (steps.some(step => step.action === 'callGroup')) problems.push('Unresolved mobile group call.');
  if (problems.length) throw new Error(problems.join(' '));
}

export async function executeMobileFlow(ctx: Context): Promise<{ results: MobileStepResult[]; failure: string | null }> {
  validateMobileExecution(ctx.steps, ctx.platform);
  const analysis = analyseFlow(mobileFlowSteps(ctx.steps));
  if (!analysis.ok) throw new Error(analysis.errors.join(' '));
  const cursor = new FlowCursor(mobileFlowSteps(ctx.steps), analysis.blocks, ctx.vars);
  const results: MobileStepResult[] = [];
  let failure: string | null = null;
  let visits = 0;
  const resolve = (raw?: string) => {
    const missing = findUnresolvedVariables(raw ?? '', ctx.vars);
    if (missing.length) throw new Error(`Unresolved variable(s) ${missing.join(', ')}.`);
    return substituteVariables(raw ?? '', ctx.vars);
  };
  const condition = async (step: MobileExecutionStep) => {
    const value = resolve(step.value).trim();
    if (!step.target?.trim()) {
      const result = compareValues(value);
      if ('error' in result) throw new Error(result.error);
      return result.value;
    }
    const locator = parseMobileLocator(resolve(step.target), ctx.platform);
    if (!locator) throw new Error('Invalid native condition locator.');
    const element = await ctx.session.find(locator);
    if (value === 'hidden') return !element || !await ctx.session.displayed(element);
    if (!element) return false;
    if (value === 'visible') return ctx.session.displayed(element);
    const text = await ctx.session.text(element);
    if (value.startsWith('contains:')) return text.includes(value.slice(9));
    if (value.startsWith('text:')) return text === value.slice(5);
    throw new Error('Invalid native element condition.');
  };
  const identity = (index: number) => {
    const step = ctx.steps[index];
    return { index, action: step.action, target: step.target, stepId: step.id,
      sourceIndex: step.sourceIndex ?? index, groupId: step.groupId, groupName: step.groupName,
      iterationKey: cursor.iterationKey() };
  };
  const skip = (from: number, to: number, skipReason: 'branch' | 'failure') => {
    for (let i = from; i < to; i++) results.push({ ...identity(i), status: 'skipped', skipReason, durationMs: 0 });
  };
  while (!cursor.done) {
    const at = cursor.pc;
    const step = ctx.steps[at];
    const started = Date.now();
    const row = identity(at);
    try {
      if (++visits > 10_000) throw new Error('Mobile execution exceeded 10000 step visits.');
      const outcome: { condition?: boolean; iterations?: number } = {};
      let detail: string | undefined;
      if (step.action === 'if' || step.action === 'repeatWhile' || step.action === 'assertCondition') {
        outcome.condition = await condition(step);
        detail = `Condition: ${outcome.condition}`;
        if (step.action === 'assertCondition' && !outcome.condition) throw new Error('Mobile condition assertion failed.');
      } else if (step.action === 'repeat') {
        outcome.iterations = Number(resolve(step.value));
        if (!Number.isInteger(outcome.iterations) || outcome.iterations < 1 || outcome.iterations > MAX_LOOP_ITERATIONS) throw new Error(`repeat takes an integer from 1 to ${MAX_LOOP_ITERATIONS}.`);
      } else if (!FLOW_ACTION_IDS.has(step.action)) detail = await ctx.primitive(step);
      const error = cursor.advance(outcome);
      if (error) throw new Error(error);
      results.push({ ...row, status: 'passed', detail, durationMs: Date.now() - started });
      if (cursor.pc > at + 1) skip(at + 1, cursor.pc, 'branch');
    } catch (error) {
      failure = String((error as Error).message ?? error);
      results.push({ ...row, status: 'failed', error: failure, durationMs: Date.now() - started });
      skip(at + 1, ctx.steps.length, 'failure');
    }
    await ctx.onStep?.(results);
    if (failure) break;
  }
  return { results, failure };
}
