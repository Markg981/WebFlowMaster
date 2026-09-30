import { describe, it, expect } from 'vitest';
import { analyseFlow, MAX_LOOP_ITERATIONS } from '@shared/flow';
import { FlowCursor, LOOP_INDEX_VARIABLE } from './flow-cursor';

const steps = (...ids: string[]) => ids.map((id) => ({ action: { id } }));

/**
 * Walks a sequence the way a runner does, answering each condition from the list given, and
 * returns the indices it executed.
 */
function walk(ids: string[], answers: { condition?: boolean; iterations?: number }[] = []) {
  const sequence = steps(...ids);
  const analysis = analyseFlow(sequence);
  if (!analysis.ok) throw new Error(analysis.errors.join(' '));
  const vars: Record<string, string> = {};
  const cursor = new FlowCursor(sequence, analysis.blocks, vars);
  const visited: string[] = [];
  let guard = 0;
  while (!cursor.done && guard++ < 1000) {
    const id = ids[cursor.pc];
    visited.push(id.startsWith('step') ? `${id}@${vars[LOOP_INDEX_VARIABLE] ?? '-'}` : id);
    const outcome = ['if', 'repeatWhile', 'repeat'].includes(id) ? answers.shift() ?? {} : {};
    const error = cursor.advance(outcome);
    if (error) return { visited, error, vars };
  }
  return { visited, error: null, vars };
}

describe('analyseFlow', () => {
  it('accepts nested blocks', () => {
    expect(analyseFlow(steps('if', 'repeat', 'click', 'endLoop', 'else', 'click', 'endIf')).ok).toBe(true);
  });

  it('names every block that does not close, by step number', () => {
    const result = analyseFlow(steps('click', 'if', 'repeat', 'endIf', 'else', 'endLoop'));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toEqual([
      'Step 4: "endIf" without an open "if".',
      'Step 5: "else" without an open "if".',
      // Step 6 closes the repeat at step 3, which is still the innermost open block.
      'Step 2: this "if" has no "endIf".',
    ]);
  });

  it('refuses a second else', () => {
    const result = analyseFlow(steps('if', 'else', 'else', 'endIf'));
    expect(!result.ok && result.errors[0]).toContain('a second "else"');
  });
});

describe('FlowCursor', () => {
  it('runs the if branch and skips the else', () => {
    expect(walk(['if', 'stepA', 'else', 'stepB', 'endIf', 'stepC'], [{ condition: true }]).visited).toEqual([
      'if', 'stepA@-', 'else', 'stepC@-',
    ]);
  });

  it('runs the else branch when the condition is false, and nothing when there is no else', () => {
    expect(walk(['if', 'stepA', 'else', 'stepB', 'endIf'], [{ condition: false }]).visited).toEqual([
      'if', 'stepB@-', 'endIf',
    ]);
    expect(walk(['if', 'stepA', 'endIf', 'stepC'], [{ condition: false }]).visited).toEqual(['if', 'stepC@-']);
  });

  it('repeats a body the given number of times, counting in loopIndex, and nests', () => {
    const { visited, vars } = walk(
      ['repeat', 'step', 'repeat', 'inner', 'endLoop', 'endLoop', 'stepAfter'],
      [{ iterations: 2 }, { iterations: 2 }, { iterations: 2 }],
    );
    expect(visited).toEqual([
      'repeat', 'step@1', 'repeat', 'inner', 'endLoop', 'inner', 'endLoop', 'endLoop',
      'step@2', 'repeat', 'inner', 'endLoop', 'inner', 'endLoop', 'endLoop', 'stepAfter@-',
    ]);
    // No loop left open, so no index left behind for later steps to read by mistake.
    expect(vars[LOOP_INDEX_VARIABLE]).toBeUndefined();
  });

  it('skips a body repeated zero times', () => {
    expect(walk(['repeat', 'step', 'endLoop', 'stepAfter'], [{ iterations: 0 }]).visited).toEqual([
      'repeat', 'stepAfter@-',
    ]);
  });

  it('asks a repeatWhile its condition before every pass', () => {
    const { visited } = walk(
      ['repeatWhile', 'step', 'endLoop', 'stepAfter'],
      [{ condition: true }, { condition: true }, { condition: false }],
    );
    expect(visited).toEqual([
      'repeatWhile', 'step@1', 'endLoop', 'repeatWhile', 'step@2', 'endLoop', 'repeatWhile', 'stepAfter@-',
    ]);
  });

  it('stops a loop whose condition never turns false', () => {
    const answers = Array.from({ length: MAX_LOOP_ITERATIONS + 5 }, () => ({ condition: true }));
    const { error } = walk(['repeatWhile', 'step', 'endLoop'], answers);
    expect(error).toContain(`after ${MAX_LOOP_ITERATIONS} iterations`);
  });
});
