import {
  ELSE_ACTION,
  END_LOOP_ACTION,
  IF_ACTION,
  MAX_LOOP_ITERATIONS,
  REPEAT_ACTION,
  REPEAT_WHILE_ACTION,
  type FlowBlocks,
} from '@shared/flow';

/** The variable a loop body reads its iteration from, counting from 1. */
export const LOOP_INDEX_VARIABLE = 'loopIndex';

interface OpenLoop {
  start: number;
  /** Set for `repeat`; a `repeatWhile` has no count, its condition decides. */
  total?: number;
  index: number;
}

/**
 * Which step a run executes next.
 *
 * Both runners used to walk the steps with a `for`, which is all a flat list needs and exactly
 * what a condition or a loop cannot live with. This keeps the walking in one place, away from
 * the browser: a runner asks for `pc`, runs that step, and hands back what it reported.
 */
export class FlowCursor {
  pc = 0;
  private readonly loops: OpenLoop[] = [];

  constructor(
    private readonly steps: ReadonlyArray<{ action?: { id?: string } | null }>,
    private readonly blocks: FlowBlocks,
    /** Where {{loopIndex}} is kept. The run's own copy, never a shared one. */
    private readonly vars?: Record<string, string>,
  ) {}

  get done(): boolean {
    return this.pc >= this.steps.length;
  }

  /**
   * Which pass of which loops the current step is in — "iter_2", or "iter_2_1" nested — or
   * null outside any loop.
   *
   * A visual baseline is keyed by the step's position, and a loop meets the same position once
   * per pass: the third row of a list compared against a picture of the first is a difference
   * the application did not make. This is the rest of the key.
   */
  iterationKey(): string | null {
    return this.loops.length === 0 ? null : `iter_${this.loops.map((loop) => loop.index).join('_')}`;
  }

  /**
   * Moves past the step at `pc`, given what it reported. Returns the reason the run cannot go
   * on — a loop that did not end — or null.
   */
  advance(outcome: { condition?: boolean; iterations?: number }): string | null {
    const at = this.pc;
    const id = this.steps[at]?.action?.id;
    const end = this.blocks.endOf.get(at);

    switch (id) {
      case IF_ACTION: {
        this.pc = outcome.condition ? at + 1 : (this.blocks.elseOf.get(at) ?? end!) + 1;
        return null;
      }
      case ELSE_ACTION: {
        // Only reached by running the branch above it to its end.
        this.pc = end! + 1;
        return null;
      }
      case REPEAT_ACTION: {
        const total = outcome.iterations ?? 0;
        if (total <= 0) {
          this.pc = end! + 1;
          return null;
        }
        this.loops.push({ start: at, total, index: 1 });
        this.setIndex(1);
        this.pc = at + 1;
        return null;
      }
      case REPEAT_WHILE_ACTION: {
        const top = this.loops.at(-1);
        const running = top?.start === at ? top : undefined;
        if (!outcome.condition) {
          if (running) this.leaveLoop();
          this.pc = end! + 1;
          return null;
        }
        if (running) {
          running.index++;
          if (running.index > MAX_LOOP_ITERATIONS) {
            return `The loop at step ${at + 1} was still going after ${MAX_LOOP_ITERATIONS} iterations; its condition never turned false.`;
          }
          this.setIndex(running.index);
        } else {
          this.loops.push({ start: at, index: 1 });
          this.setIndex(1);
        }
        this.pc = at + 1;
        return null;
      }
      case END_LOOP_ACTION: {
        const loop = this.loops.at(-1)!;
        if (loop.total === undefined) {
          // Back to the repeatWhile, which asks its condition again.
          this.pc = loop.start;
          return null;
        }
        if (loop.index >= loop.total) {
          this.leaveLoop();
          this.pc = at + 1;
          return null;
        }
        loop.index++;
        this.setIndex(loop.index);
        this.pc = loop.start + 1;
        return null;
      }
      default:
        this.pc = at + 1;
        return null;
    }
  }

  /** Leaving a nested loop, the body around it counts its own iterations again. */
  private leaveLoop() {
    this.loops.pop();
    const outer = this.loops.at(-1);
    if (outer) this.setIndex(outer.index);
    else if (this.vars) delete this.vars[LOOP_INDEX_VARIABLE];
  }

  private setIndex(index: number) {
    if (this.vars) this.vars[LOOP_INDEX_VARIABLE] = String(index);
  }
}
