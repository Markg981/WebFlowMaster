import { z } from "zod";
import { ACCESSIBILITY_IMPACTS } from "./accessibility";

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
  // Bringing a control TO a state, rather than performing an operation on it.
  //
  // A test's setup steps describe a starting point: "this function is enabled". `click`
  // cannot express that, because a click on a checkbox is a toggle — it means "enabled" only
  // if the box happened to be off. Run the same test twice, or run it against an environment
  // where someone has already configured the thing, and the setup undoes itself: the second
  // run turns the function back off and then fails on a screen that never appeared.
  //
  // `ensureState` reads the control first and clicks only when the state differs, so a
  // precondition that is already satisfied costs nothing and changes nothing.
  "ensureState",
  // Runs axe-core on the page as it is at this point of the flow, and fails on violations at or
  // above a severity (the value; "serious" when empty). See shared/accessibility.ts.
  "assertAccessible",
  // Interactions a click and a typed value cannot stand in for. Without them a test could reach
  // a search box and never submit it, open a context menu only by accident, and not get past
  // an upload field, a confirm() or a link that opens in a new tab at all.
  //
  // A key, or a combination such as "Control+A", on the step's element or on whatever has focus.
  "pressKey",
  "doubleClick",
  "rightClick",
  // The element is what is dragged; the value is the selector of where it is dropped.
  "dragAndDrop",
  // The value is the file to hand the page: "name.ext", or "name.ext|content" for its contents.
  "uploadFile",
  // Says how to answer the NEXT alert, confirm or prompt, so it goes before the step that opens
  // one: "accept", "dismiss", or "accept:text" to type into a prompt.
  "handleDialog",
  // Moves the rest of the test to another tab: the newest one, the Nth (from 1), or the first
  // whose address or title contains the value.
  "switchTab",
  "closeTab",
  // Reads the element's text, or a field's value, into the variable the value names, so a later
  // step can use it as {{name}} — an order number read off one screen and searched for on another.
  "storeText",
  // "name=value" for the page's current address.
  "setCookie",
  "clearCookies",
  // "key=value" in the current origin's localStorage.
  "setLocalStorage",
  // Runs the value as JavaScript in the page. Fails when it throws or returns exactly false,
  // so it can check what no other step can express.
  "executeScript",
  // "name=value": a variable for the steps after this one. With a generator such as
  // {{$randomEmail}} it is how a test makes up a value once and uses it twice.
  "setVariable",
  // Waits for the email the application sent to an address — "address", "address|subject" or
  // "address|subject|pattern" — in the environment's test inbox (Mailpit), and puts what it holds
  // in {{email.otp}}, {{email.link}}, {{email.subject}}, {{email.from}} and {{email.text}}.
  // See server/email-inbox.ts.
  "waitForEmail",
  // A SQL statement against the environment's database (db.url, or db.<name>.url with
  // "@name SELECT…"), with the first row in {{db.value}} and {{db.<column>}}. See
  // server/database-step.ts.
  "queryDatabase",
  // Fails the test unless a comparison of values holds, as an `if` without an element reads
  // one: "{{db.value}} == 1", "{{total}} > 0", "{{email.subject}} contains Welcome".
  "assertCondition",
  // Blocks — see shared/flow.ts, which pairs them. `if` and `repeatWhile` take a condition:
  // with an element, a state it is in now (visible, hidden, checked, contains:text…); without
  // one, a comparison of values ("{{status}} == Paid").
  "if",
  "else",
  "endIf",
  // The value is how many times; {{loopIndex}} counts from 1 inside the body.
  "repeat",
  "repeatWhile",
  "endLoop",
] as const;
export type AdhocActionId = (typeof ADHOC_ACTION_IDS)[number];

/**
 * The step that calls a step group.
 *
 * Deliberately NOT one of ADHOC_ACTION_IDS. Those are the things the step executor knows how
 * to do to a page, and the exhaustive record in server/step-executor.ts is what stops an
 * action existing with no implementation. This one is not done to a page at all: the runner
 * replaces it with the group’s own steps before the executor sees a thing.
 */
export const STEP_GROUP_ACTION_ID = "callGroup";

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
 * Recorded type → replay action id, or null for a type that is dropped on purpose.
 *
 * `keypress` used to be one of those, on the reasoning that the value it produced was already
 * in the following `input`. The recorder only reports Enter, though, and what Enter produces
 * is not a value but a submission: a search box filled in and submitted with Enter replayed
 * as a search box filled in, and the next step waited for results that were never asked for.
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
  keypress: "pressKey",
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
  {
    target: boolean;
    value: boolean;
    valueRequired: boolean;
    /** Takes an element without needing one: the builder offers the slot, empty is fine. */
    optionalTarget?: boolean;
  }
> = {
  click: { target: true, value: false, valueRequired: false },
  input: { target: true, value: true, valueRequired: true },
  wait: { target: false, value: true, valueRequired: true },
  scroll: { target: false, value: false, valueRequired: false, optionalTarget: true },
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
  ensureState: { target: true, value: true, valueRequired: true },
  assertAccessible: { target: false, value: true, valueRequired: false },
  // No element required: after typing, the key usually goes to the field that has focus. A
  // recorded Enter keeps the field it was pressed in, and the runner uses it when it is there.
  pressKey: { target: false, value: true, valueRequired: true, optionalTarget: true },
  doubleClick: { target: true, value: false, valueRequired: false },
  rightClick: { target: true, value: false, valueRequired: false },
  dragAndDrop: { target: true, value: true, valueRequired: true },
  uploadFile: { target: true, value: true, valueRequired: true },
  // Empty means "accept".
  handleDialog: { target: false, value: true, valueRequired: false },
  // Empty means the newest tab.
  switchTab: { target: false, value: true, valueRequired: false },
  closeTab: { target: false, value: false, valueRequired: false },
  storeText: { target: true, value: true, valueRequired: true },
  setCookie: { target: false, value: true, valueRequired: true },
  clearCookies: { target: false, value: false, valueRequired: false },
  setLocalStorage: { target: false, value: true, valueRequired: true },
  executeScript: { target: false, value: true, valueRequired: true },
  setVariable: { target: false, value: true, valueRequired: true },
  waitForEmail: { target: false, value: true, valueRequired: true },
  queryDatabase: { target: false, value: true, valueRequired: true },
  assertCondition: { target: false, value: true, valueRequired: true },
  if: { target: false, value: true, valueRequired: true, optionalTarget: true },
  else: { target: false, value: false, valueRequired: false },
  endIf: { target: false, value: false, valueRequired: false },
  repeat: { target: false, value: true, valueRequired: true },
  repeatWhile: { target: false, value: true, valueRequired: true, optionalTarget: true },
  endLoop: { target: false, value: false, valueRequired: false },
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

/**
 * States a test can put a control INTO, as opposed to states it can only read.
 *
 * Deliberately a subset of ASSERTABLE_STATES. Whether a field is enabled, disabled,
 * editable or read-only is the application's decision, derived from permissions and from
 * the state of the record; a test that "sets" one of those is describing something it
 * cannot do, and the runner says so by name rather than clicking and hoping.
 */
export const SETTABLE_STATES = ["checked", "unchecked"] as const;
export type SettableState = (typeof SETTABLE_STATES)[number];

/**
 * Actions whose value is one of a fixed set, so the builder can offer it instead of asking.
 *
 * The runner has always refused an unrecognised state by name, and the comment above
 * claimed the builder offered the list — it did not. The field was free text, so the only
 * thing standing between "Checked " with a trailing space and a step that fails at run time
 * for a reason nobody can see was the author typing it exactly right. One table, read by
 * both sides, is what makes that claim true.
 */
export const ACTION_VALUE_OPTIONS: Partial<Record<AdhocActionId, readonly string[]>> = {
  assertState: ASSERTABLE_STATES,
  ensureState: SETTABLE_STATES,
  // `waitForElement` has taken these two since it was added, also as free text.
  waitForElement: ["visible", "hidden"],
  // The least severe violation that fails the step.
  assertAccessible: ACCESSIBILITY_IMPACTS,
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
  ensureState: {
    name: "dashboardPageNew.actions.ensureState.name",
    description: "dashboardPageNew.actions.ensureState.description",
    icon: "CheckCheck",
  },
  assertAccessible: {
    name: "dashboardPageNew.actions.assertAccessible.name",
    description: "dashboardPageNew.actions.assertAccessible.description",
    icon: "Accessibility",
  },
  pressKey: {
    name: "dashboardPageNew.actions.pressKey.name",
    description: "dashboardPageNew.actions.pressKey.description",
    icon: "CornerDownLeft",
  },
  doubleClick: {
    name: "dashboardPageNew.actions.doubleClick.name",
    description: "dashboardPageNew.actions.doubleClick.description",
    icon: "MousePointerClick",
  },
  rightClick: {
    name: "dashboardPageNew.actions.rightClick.name",
    description: "dashboardPageNew.actions.rightClick.description",
    icon: "MousePointer2",
  },
  dragAndDrop: {
    name: "dashboardPageNew.actions.dragAndDrop.name",
    description: "dashboardPageNew.actions.dragAndDrop.description",
    icon: "Move",
  },
  uploadFile: {
    name: "dashboardPageNew.actions.uploadFile.name",
    description: "dashboardPageNew.actions.uploadFile.description",
    icon: "Upload",
  },
  handleDialog: {
    name: "dashboardPageNew.actions.handleDialog.name",
    description: "dashboardPageNew.actions.handleDialog.description",
    icon: "MessageSquare",
  },
  switchTab: {
    name: "dashboardPageNew.actions.switchTab.name",
    description: "dashboardPageNew.actions.switchTab.description",
    icon: "AppWindow",
  },
  closeTab: {
    name: "dashboardPageNew.actions.closeTab.name",
    description: "dashboardPageNew.actions.closeTab.description",
    icon: "X",
  },
  storeText: {
    name: "dashboardPageNew.actions.storeText.name",
    description: "dashboardPageNew.actions.storeText.description",
    icon: "Variable",
  },
  setCookie: {
    name: "dashboardPageNew.actions.setCookie.name",
    description: "dashboardPageNew.actions.setCookie.description",
    icon: "Cookie",
  },
  clearCookies: {
    name: "dashboardPageNew.actions.clearCookies.name",
    description: "dashboardPageNew.actions.clearCookies.description",
    icon: "Eraser",
  },
  setLocalStorage: {
    name: "dashboardPageNew.actions.setLocalStorage.name",
    description: "dashboardPageNew.actions.setLocalStorage.description",
    icon: "Database",
  },
  executeScript: {
    name: "dashboardPageNew.actions.executeScript.name",
    description: "dashboardPageNew.actions.executeScript.description",
    icon: "Code",
  },
  setVariable: {
    name: "dashboardPageNew.actions.setVariable.name",
    description: "dashboardPageNew.actions.setVariable.description",
    icon: "Variable",
  },
  waitForEmail: {
    name: "dashboardPageNew.actions.waitForEmail.name",
    description: "dashboardPageNew.actions.waitForEmail.description",
    icon: "Mail",
  },
  queryDatabase: {
    name: "dashboardPageNew.actions.queryDatabase.name",
    description: "dashboardPageNew.actions.queryDatabase.description",
    icon: "Database",
  },
  assertCondition: {
    name: "dashboardPageNew.actions.assertCondition.name",
    description: "dashboardPageNew.actions.assertCondition.description",
    icon: "CheckCheck",
  },
  if: {
    name: "dashboardPageNew.actions.if.name",
    description: "dashboardPageNew.actions.if.description",
    icon: "GitBranch",
  },
  else: {
    name: "dashboardPageNew.actions.else.name",
    description: "dashboardPageNew.actions.else.description",
    icon: "GitBranch",
  },
  endIf: {
    name: "dashboardPageNew.actions.endIf.name",
    description: "dashboardPageNew.actions.endIf.description",
    icon: "GitMerge",
  },
  repeat: {
    name: "dashboardPageNew.actions.repeat.name",
    description: "dashboardPageNew.actions.repeat.description",
    icon: "Repeat",
  },
  repeatWhile: {
    name: "dashboardPageNew.actions.repeatWhile.name",
    description: "dashboardPageNew.actions.repeatWhile.description",
    icon: "Repeat",
  },
  endLoop: {
    name: "dashboardPageNew.actions.endLoop.name",
    description: "dashboardPageNew.actions.endLoop.description",
    icon: "CornerLeftUp",
  },
};

/**
 * i18n keys for what goes in the value field, for the actions whose value has a shape.
 *
 * The builder's field says only "value", which is enough for a URL or a text to type and not
 * enough for "name.ext|content" or "accept:text": a format nobody can see is a format people
 * learn by having the step fail.
 */
export const ACTION_VALUE_HINTS: Partial<Record<AdhocActionId, string>> = {
  pressKey: "dashboardPageNew.actions.pressKey.valueHint",
  dragAndDrop: "dashboardPageNew.actions.dragAndDrop.valueHint",
  uploadFile: "dashboardPageNew.actions.uploadFile.valueHint",
  handleDialog: "dashboardPageNew.actions.handleDialog.valueHint",
  switchTab: "dashboardPageNew.actions.switchTab.valueHint",
  storeText: "dashboardPageNew.actions.storeText.valueHint",
  setCookie: "dashboardPageNew.actions.setCookie.valueHint",
  setLocalStorage: "dashboardPageNew.actions.setLocalStorage.valueHint",
  executeScript: "dashboardPageNew.actions.executeScript.valueHint",
  setVariable: "dashboardPageNew.actions.setVariable.valueHint",
  waitForEmail: "dashboardPageNew.actions.waitForEmail.valueHint",
  queryDatabase: "dashboardPageNew.actions.queryDatabase.valueHint",
  assertCondition: "dashboardPageNew.actions.assertCondition.valueHint",
  if: "dashboardPageNew.actions.if.valueHint",
  repeat: "dashboardPageNew.actions.repeat.valueHint",
  repeatWhile: "dashboardPageNew.actions.repeatWhile.valueHint",
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

  // The key is what a pressKey step presses.
  if (actionId === "pressKey") {
    step.value = recorded.key ?? recorded.value ?? "Enter";
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

/**
 * The buffer in the order the actions happened, rather than the order the page reported them.
 *
 * Enter in a text field fires `keydown` before the field's `change`, so the recorder hears
 * "Enter, then the value" for what the user did as "the value, then Enter". Replayed as heard,
 * the form is submitted empty and filled in afterwards. A keypress immediately followed by the
 * value of the same field is put back behind it.
 */
export function inActionOrder(sequence: RecordedAction[]): RecordedAction[] {
  const ordered = [...sequence];
  for (let i = 0; i < ordered.length - 1; i++) {
    const key = ordered[i];
    const value = ordered[i + 1];
    if (
      key.type === "keypress" &&
      (value.type === "input" || value.type === "select") &&
      !!key.selector &&
      key.selector === value.selector
    ) {
      ordered[i] = value;
      ordered[i + 1] = key;
      i++;
    }
  }
  return ordered;
}

/** Map a whole recorded buffer, dropping the non-replayable entries. */
export function mapRecordedSequence(
  sequence: RecordedAction[],
): MappedTestStep[] {
  return inActionOrder(sequence)
    .map((action, index) => mapRecordedActionToStep(action, index))
    .filter((step): step is MappedTestStep => step !== null);
}
