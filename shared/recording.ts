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
  // Conditional waits. DMO pushes UI updates over SignalR, so a fixed `wait` is a guess
  // about timing — and the AI healing pass then gets asked to cover for the guess.
  "waitForElement",
  "waitForText",
  "waitForNetworkIdle",
  // Angular Material renders a mat-select as a div plus a CDK overlay, which selectOption
  // cannot drive. This opens the trigger and clicks the option by its text.
  "selectByText",
  // Asserting the STATE of a control, not its presence. Checking that a function is
  // enabled or a box is ticked had to be smuggled into the selector — matching only
  // elements that also carry aria-checked="true" — which reads as a lookup and fails
  // like one: the step says the element was not found, when what happened is that it was
  // found and was off.
  "assertState",
] as const;
export type AdhocActionId = (typeof ADHOC_ACTION_IDS)[number];

/** Action kinds the in-page recorder can emit. */
export const RECORDED_ACTION_TYPES = [
  "click",
  // Recorded only when hovering something is what revealed what happens next — see the
  // pending-hover logic in server/recorder-script.ts. DMO's navigation is a flyout that
  // opens on hover and closes when the pointer leaves, so a recording that captured only
  // clicks was missing the step that made the menu exist: replay found nothing to click and
  // timed out on the first action, whatever the selector said.
  "hover",
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
  hover: "hover",
  input: "input",
  select: "select",
  navigate: "navigate",
  keypress: null,
  assert: "assert",
  assertTextContains: "assertTextContains",
  assertElementCount: "assertElementCount",
};

/**
 * What each action needs before it can do anything.
 *
 * One table, because the answer was written down twice and the copies drifted. The builder
 * node decided which fields to draw from its own hard-coded lists, and those lists predate
 * the conditional waits and the Material dropdown: `waitForElement`, `waitForText` and
 * `selectByText` were offered in the palette and then rendered with no element to drop onto
 * and no value to type. They could be dragged in and never completed — which matters most
 * for exactly the applications they exist for, since an explicit wait is what makes a test
 * against an asynchronous screen reliable.
 *
 * `value` is whether the step takes one at all; `valueRequired` is whether it must have one.
 * `waitForElement` is the case that needs both: it accepts "visible" or "hidden", and means
 * "visible" when left empty.
 *
 * Keyed by AdhocActionId, so an action added without an entry here fails to compile.
 */
export const ACTION_REQUIREMENTS: Record<
  AdhocActionId,
  { target: boolean; value: boolean; valueRequired: boolean }
> = {
  click: { target: true, value: false, valueRequired: false },
  input: { target: true, value: true, valueRequired: true },
  wait: { target: false, value: true, valueRequired: true },
  scroll: { target: false, value: false, valueRequired: false },
  assert: { target: true, value: false, valueRequired: false },
  hover: { target: true, value: false, valueRequired: false },
  select: { target: true, value: true, valueRequired: true },
  navigate: { target: false, value: true, valueRequired: true },
  assertTextContains: { target: true, value: true, valueRequired: true },
  assertElementCount: { target: true, value: true, valueRequired: true },
  waitForElement: { target: true, value: true, valueRequired: false },
  waitForText: { target: true, value: true, valueRequired: true },
  waitForNetworkIdle: { target: false, value: false, valueRequired: false },
  selectByText: { target: true, value: true, valueRequired: true },
  assertState: { target: true, value: true, valueRequired: true },
};

/**
 * States `assertState` can check, and what each one means.
 *
 * Deliberately a closed list rather than free text: a typo in a value that the runner then
 * treats as "unknown, so false" is a test that fails for a reason nobody can see. The
 * builder offers these, and the runner refuses anything else by name.
 */
export const ASSERTABLE_STATES = [
  "checked",
  "unchecked",
  "enabled",
  "disabled",
  "editable",
  "readonly",
] as const;
export type AssertableState = (typeof ASSERTABLE_STATES)[number];

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
  waitForElement: {
    name: "dashboardPageNew.actions.waitForElement.name",
    description: "dashboardPageNew.actions.waitForElement.description",
    icon: "Eye",
  },
  waitForText: {
    name: "dashboardPageNew.actions.waitForText.name",
    description: "dashboardPageNew.actions.waitForText.description",
    icon: "Type",
  },
  waitForNetworkIdle: {
    name: "dashboardPageNew.actions.waitForNetworkIdle.name",
    description: "dashboardPageNew.actions.waitForNetworkIdle.description",
    icon: "Activity",
  },
  selectByText: {
    name: "dashboardPageNew.actions.selectByText.name",
    description: "dashboardPageNew.actions.selectByText.description",
    icon: "List",
  },
  assertState: {
    name: "dashboardPageNew.actions.assertState.name",
    description: "dashboardPageNew.actions.assertState.description",
    icon: "ToggleRight",
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
