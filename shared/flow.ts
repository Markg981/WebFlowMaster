/**
 * The blocks a test's steps can form: conditions and loops.
 *
 * A test stays a flat list of steps. `if` … `else` … `endIf` and `repeat`/`repeatWhile` …
 * `endLoop` are steps like any other, which is what lets the builder, step groups, versions and
 * every stored sequence carry them without changing shape. What makes them blocks is only this
 * file: it pairs each opener with its end, and refuses a sequence whose blocks do not close —
 * before a browser is launched, rather than halfway through a run with an `else` it cannot place.
 */

export const IF_ACTION = "if";
export const ELSE_ACTION = "else";
export const END_IF_ACTION = "endIf";
export const REPEAT_ACTION = "repeat";
export const REPEAT_WHILE_ACTION = "repeatWhile";
export const END_LOOP_ACTION = "endLoop";

/** Steps that decide where the run goes next, rather than doing something to the page. */
export const FLOW_ACTION_IDS: ReadonlySet<string> = new Set([
  IF_ACTION,
  ELSE_ACTION,
  END_IF_ACTION,
  REPEAT_ACTION,
  REPEAT_WHILE_ACTION,
  END_LOOP_ACTION,
]);

/**
 * Whether a step leaves the page as it found it, so a screenshot of it shows only the step
 * before. Runners skip the settle-and-capture for these: a loop of fifty would otherwise add
 * a hundred identical pictures and a minute of waiting to the report.
 */
export function leavesPageAlone(actionId: string | undefined): boolean {
  return !!actionId && (FLOW_ACTION_IDS.has(actionId) || actionId === "setVariable");
}

/**
 * How many times a loop body may run before the run gives up.
 *
 * A `repeatWhile` whose condition never turns false is a test that never ends, and a scheduled
 * one holds a worker until someone notices. A number big enough for any real list and small
 * enough to fail within minutes.
 */
export const MAX_LOOP_ITERATIONS = 200;

/**
 * How deep in blocks each step sits, for the builder to indent by: the body of an `if` or a
 * loop is one level in, and the `else` and the end line up with the step that opened them.
 *
 * Tolerant where analyseFlow is strict, because the builder draws tests while they are being
 * written: an `if` whose `endIf` has not been added yet still indents what follows it, and a
 * stray end never goes below zero.
 */
export function flowDepths(steps: ReadonlyArray<{ action?: { id?: string } | null }>): number[] {
  let depth = 0;
  return steps.map((step) => {
    const id = step.action?.id;
    if (id === ELSE_ACTION) return Math.max(0, depth - 1);
    if (id === END_IF_ACTION || id === END_LOOP_ACTION) {
      depth = Math.max(0, depth - 1);
      return depth;
    }
    const at = depth;
    if (id === IF_ACTION || id === REPEAT_ACTION || id === REPEAT_WHILE_ACTION) depth++;
    return at;
  });
}

/** Where each block step's partners are, by index. */
export interface FlowBlocks {
  /** `if` → its `else`, when it has one. */
  elseOf: Map<number, number>;
  /** `if`, `else` → the `endIf`; `repeat`, `repeatWhile` → the `endLoop`. */
  endOf: Map<number, number>;
  /** `endLoop` → the loop step it closes. */
  startOf: Map<number, number>;
}

export type FlowAnalysis = { ok: true; blocks: FlowBlocks } | { ok: false; errors: string[] };

/**
 * Pairs every block step with its partners, or says which ones do not pair.
 *
 * Step numbers in the messages count from 1, as the builder shows them.
 */
export function analyseFlow(steps: ReadonlyArray<{ action?: { id?: string } | null }>): FlowAnalysis {
  const blocks: FlowBlocks = { elseOf: new Map(), endOf: new Map(), startOf: new Map() };
  const errors: string[] = [];
  const open: { index: number; kind: "if" | "loop"; hasElse: boolean }[] = [];

  steps.forEach((step, index) => {
    const id = step.action?.id;
    const n = index + 1;
    switch (id) {
      case IF_ACTION:
        open.push({ index, kind: "if", hasElse: false });
        break;
      case REPEAT_ACTION:
      case REPEAT_WHILE_ACTION:
        open.push({ index, kind: "loop", hasElse: false });
        break;
      case ELSE_ACTION: {
        const top = open.at(-1);
        if (!top || top.kind !== "if") errors.push(`Step ${n}: "else" without an open "if".`);
        else if (top.hasElse) errors.push(`Step ${n}: a second "else" for the "if" at step ${top.index + 1}.`);
        else {
          top.hasElse = true;
          blocks.elseOf.set(top.index, index);
        }
        break;
      }
      case END_IF_ACTION: {
        const top = open.at(-1);
        if (!top || top.kind !== "if") {
          errors.push(`Step ${n}: "endIf" without an open "if".`);
          break;
        }
        open.pop();
        blocks.endOf.set(top.index, index);
        const elseIndex = blocks.elseOf.get(top.index);
        if (elseIndex !== undefined) blocks.endOf.set(elseIndex, index);
        break;
      }
      case END_LOOP_ACTION: {
        const top = open.at(-1);
        if (!top || top.kind !== "loop") {
          errors.push(`Step ${n}: "endLoop" without an open loop.`);
          break;
        }
        open.pop();
        blocks.endOf.set(top.index, index);
        blocks.startOf.set(index, top.index);
        break;
      }
    }
  });

  for (const block of open) {
    errors.push(
      `Step ${block.index + 1}: this ${block.kind === "if" ? '"if" has no "endIf"' : 'loop has no "endLoop"'}.`,
    );
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, blocks };
}
