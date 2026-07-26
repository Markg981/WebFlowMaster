import { z } from "zod";

/**
 * Single source of truth for the record → replay pipeline.
 *
 * The in-page recorder emits `RecordedAction`s, the server buffers them, and the client
 * turns them into builder steps with `mapRecordedActionToStep`. Everything on that path
 * imports from this file: previously the client redeclared its own `BackendRecordedAction`
 * and its own action-id list, which is exactly how the `actions`/`sequence` field mismatch
 * and the silently-dropped `navigate` steps crept in.
 */

/** Action ids understood by the replay engine (`executeAdhocSequence`). */
export const ADHOC_ACTION_IDS = [
  "click",
  "input",
  "wait",
  "scroll",
  "assert",
  "hover",
  "select",
  "navigate",
  "assertTextContains",
  "assertElementCount",
] as const;
export type AdhocActionId = (typeof ADHOC_ACTION_IDS)[number];

/** Action kinds the in-page recorder can emit. */
export const RECORDED_ACTION_TYPES = [
  "click",
  "input",
  "select",
  "navigate",
  "keypress",
  "assert",
  "assertTextContains",
  "assertElementCount",
] as const;
export type RecordedActionType = (typeof RECORDED_ACTION_TYPES)[number];

export const RecordedActionSchema = z.object({
  type: z.enum(RECORDED_ACTION_TYPES),
  selector: z.string().nullable().optional(),
  value: z.string().nullable().optional(),
  timestamp: z.number(),
  /** URL at the time of the action. */
  url: z.string().optional(),
  /** For keypress events. */
  key: z.string().optional(),
  targetTag: z.string().optional(),
  targetId: z.string().optional(),
  targetClass: z.string().optional(),
  targetText: z.string().nullable().optional(),
  /** True when the recorder redacted `value` because it came from a secret field. */
  masked: z.boolean().optional(),
  /** Marks the synthetic bookkeeping actions the service itself pushes. */
  meta: z.enum(["session-started", "session-stopped"]).optional(),
});
export type RecordedAction = z.infer<typeof RecordedActionSchema>;

/** Wire shape of every recording endpoint. Named `sequence` on both sides — do not rename. */
export interface RecordingSequenceResponse {
  success: boolean;
  sequence?: RecordedAction[];
  error?: string;
  /** Set when the browser window was closed by the user, so the client can stop polling. */
  sessionEnded?: boolean;
}

/**
 * Recorded type → replay action id. `keypress` has no replay counterpart (the resulting
 * value is already captured by the following `input`), so it maps to null and is dropped
 * on purpose rather than by accident.
 */
export const RECORDED_TYPE_TO_ACTION_ID: Record<
  RecordedActionType,
  AdhocActionId | null
> = {
  click: "click",
  input: "input",
  select: "select",
  navigate: "navigate",
  keypress: null,
  assert: "assert",
  assertTextContains: "assertTextContains",
  assertElementCount: "assertElementCount",
};

/** i18n keys for the builder node label/description of each replay action. */
export const ACTION_I18N: Record<
  AdhocActionId,
  { name: string; description: string; icon: string }
> = {
  click: {
    name: "dashboardPageNew.actions.click.name",
    description: "dashboardPageNew.actions.click.description",
    icon: "mouse-pointer",
  },
  input: {
    name: "dashboardPageNew.actions.input.name",
    description: "dashboardPageNew.actions.input.description",
    icon: "keyboard",
  },
  wait: {
    name: "dashboardPageNew.actions.wait.name",
    description: "dashboardPageNew.actions.wait.description",
    icon: "clock",
  },
  scroll: {
    name: "dashboardPageNew.actions.scroll.name",
    description: "dashboardPageNew.actions.scroll.description",
    icon: "scroll",
  },
  hover: {
    name: "dashboardPageNew.actions.hover.name",
    description: "dashboardPageNew.actions.hover.description",
    icon: "hand",
  },
  select: {
    name: "dashboardPageNew.actions.select.name",
    description: "dashboardPageNew.actions.select.description",
    icon: "chevron-down",
  },
  navigate: {
    name: "dashboardPageNew.actions.navigate.name",
    description: "dashboardPageNew.actions.navigate.description",
    icon: "globe",
  },
  assert: {
    name: "dashboardPageNew.actions.assert.name",
    description: "dashboardPageNew.actions.assert.description",
    icon: "CheckSquare",
  },
  assertTextContains: {
    name: "dashboardPageNew.actions.assertTextContains.name",
    description: "dashboardPageNew.actions.assertTextContains.description",
    icon: "CheckSquare",
  },
  assertElementCount: {
    name: "dashboardPageNew.actions.assertElementCount.name",
    description: "dashboardPageNew.actions.assertElementCount.description",
    icon: "ListChecks",
  },
};

/** The step shape the visual builder works with (mirrors client `TestStep`). */
export interface MappedTestStep {
  id: string;
  action: {
    id: AdhocActionId;
    type: AdhocActionId;
    name: string;
    icon: string;
    description: string;
  };
  targetElement?: {
    id: string;
    type: string;
    selector: string;
    text: string;
    tag: string;
    attributes: Record<string, string>;
  };
  value?: string;
}

/**
 * Turn one recorded action into a builder step, or null when the action has no replayable
 * counterpart (`keypress`, and the synthetic session start/stop bookkeeping entries).
 *
 * `index` participates in the step id so ids are stable for a given buffer position — the
 * polling loop diffs sequences by value, and ids built from Date.now()/Math.random() made
 * every poll look like a change, re-rendering and restarting the interval forever.
 */
export function mapRecordedActionToStep(
  recorded: RecordedAction,
  index: number,
): MappedTestStep | null {
  if (recorded.meta) return null;

  const actionId = RECORDED_TYPE_TO_ACTION_ID[recorded.type];
  if (!actionId) return null;

  const meta = ACTION_I18N[actionId];
  const step: MappedTestStep = {
    id: `recorded-step-${index}`,
    action: {
      id: actionId,
      type: actionId,
      name: meta.name,
      icon: meta.icon,
      description: meta.description,
    },
    value: recorded.value ?? "",
  };

  if (recorded.selector) {
    step.targetElement = {
      id: `recorded-elem-${index}`,
      selector: recorded.selector,
      type: recorded.targetTag || "element",
      text: recorded.targetText || recorded.selector,
      tag: recorded.targetTag || "unknown",
      attributes: {},
    };
  }

  // A navigate step replays as `page.goto(value)`, so the URL has to live in `value`.
  if (actionId === "navigate") {
    step.value = recorded.url ?? recorded.value ?? "";
  }

  // The recorder never sends the contents of a password-like field. An empty value would
  // fail step validation with a misleading message, so the step gets a named variable
  // placeholder instead: the user points it at a secret/env var before replaying.
  if (recorded.masked) {
    step.value = `{{${secretPlaceholderName(recorded, index)}}}`;
  }

  return step;
}

/** Stable, per-field variable name for a redacted input, e.g. `secret_loginPassword`. */
export function secretPlaceholderName(
  recorded: RecordedAction,
  index: number,
): string {
  const hint = (recorded.targetId || "").replace(/\W/g, "");
  return `secret_${hint || index}`;
}

/** Map a whole recorded buffer, dropping the non-replayable entries. */
export function mapRecordedSequence(
  sequence: RecordedAction[],
): MappedTestStep[] {
  return sequence
    .map((action, index) => mapRecordedActionToStep(action, index))
    .filter((step): step is MappedTestStep => step !== null);
}
