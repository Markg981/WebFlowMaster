/**
 * A test run from the builder that can stop: at a breakpoint, one step at a time, or where a
 * step fails — and there be corrected and taken up again.
 *
 * The browser runs where every preview runs (server/browser-tasks.ts), usually the worker. The
 * builder does not talk to it: it sends commands and reads the session's state through a channel
 * both sides can reach (server/debug-session.ts), and this is the shape of both.
 */

export const DEBUG_COMMANDS = ["continue", "step", "pause", "skip", "retry", "stop", "breakpoints"] as const;
export type DebugCommandType = (typeof DEBUG_COMMANDS)[number];

/** A correction to the step the session is paused at, applied before it runs (again). */
export interface DebugStepPatch {
  selector?: string;
  value?: string;
}

export interface DebugCommand {
  type: DebugCommandType;
  /** For continue, step and retry: the correction to run the paused step with. */
  patch?: DebugStepPatch;
  /** For breakpoints: the step ids to stop before, replacing the ones set. */
  breakpoints?: string[];
}

export type DebugStatus = "starting" | "running" | "paused" | "finished" | "stopped" | "error";

/**
 * Why the session stopped where it is: a breakpoint on the step, the step before it run with
 * "Step", a "Pause" asked for while running, or the step having failed.
 */
export type PauseReason = "breakpoint" | "step" | "pause" | "failure";

export interface DebugPause {
  /** Position in the run's own sequence, after step groups are expanded. */
  pc: number;
  /** The builder's id for the step, when the step is one of the test's own. */
  stepId: string | null;
  /** The group call the step came from, when it is inside a step group. */
  calledFrom: string | null;
  name: string;
  actionId: string;
  reason: PauseReason;
  /** Why the step failed, when that is why the session stopped. */
  error: string | null;
  selector: string | null;
  value: string | null;
  /** Whether the step can be passed over: blocks (if, loop, their ends) cannot. */
  canSkip: boolean;
  /** The page as it is now, as a data: URL. */
  screenshot: string | null;
  url: string | null;
}

export interface DebugStepRecord {
  name: string;
  type: string;
  stepId: string | null;
  status: "passed" | "failed" | "skipped";
  detail: string;
  /** The step ran with a correction made while debugging. */
  corrected: boolean;
}

export interface DebugVariable {
  name: string;
  /** Null for a value that came from the environment: those are secrets, and stay out of view. */
  value: string | null;
}

export interface DebugState {
  id: string;
  status: DebugStatus;
  paused: DebugPause | null;
  steps: DebugStepRecord[];
  variables: DebugVariable[];
  breakpoints: string[];
  /** How the run ended, once it has. */
  outcome: { success: boolean; error: string | null; skipped: number } | null;
  updatedAt: string;
}

/** Statuses after which nothing more happens in a session. */
export const DEBUG_ENDED: ReadonlySet<DebugStatus> = new Set(["finished", "stopped", "error"]);

/** Which commands the session accepts in the state it is in. */
export function allowedCommands(state: Pick<DebugState, "status" | "paused">): DebugCommandType[] {
  if (DEBUG_ENDED.has(state.status)) return [];
  if (state.status !== "paused" || !state.paused) return ["pause", "stop", "breakpoints"];
  if (state.paused.reason === "failure") {
    return ["retry", ...(state.paused.canSkip ? (["skip"] as const) : []), "stop", "breakpoints"];
  }
  return ["continue", "step", ...(state.paused.canSkip ? (["skip"] as const) : []), "stop", "breakpoints"];
}

/** Longest a paused session waits for its next command before it closes its browser. */
export const DEBUG_IDLE_TIMEOUT_MS = 15 * 60_000;
