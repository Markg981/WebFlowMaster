/**
 * Custom actions: steps an organization writes for itself, in JavaScript that runs in the page.
 *
 * The add-on model this product offers, and deliberately the narrow one. A custom action has
 * exactly the powers of a `Run JavaScript` step — the page under test, in the browser's
 * sandbox — and none on the runner. Runners are shared by every organization on the
 * installation, so code one organization wrote cannot run where another's data is. What an
 * action adds over pasting the script into each test is a name, parameters, and one place to
 * fix it.
 *
 * A test holds a reference, `customAction:<id>`, and the runner replaces it with the action's
 * current script when the test runs, the way it expands a step group: editing the action
 * changes every test that uses it on its next run.
 */

export const CUSTOM_ACTION_PREFIX = "customAction:";

/** The step id for a call to the action with this id. */
export function customActionStepId(actionId: string): string {
  return `${CUSTOM_ACTION_PREFIX}${actionId}`;
}

/** The action a step calls, or null when the step is not a custom action. */
export function customActionIdOf(stepActionId: string | undefined | null): string | null {
  if (!stepActionId || !stepActionId.startsWith(CUSTOM_ACTION_PREFIX)) return null;
  const id = stepActionId.slice(CUSTOM_ACTION_PREFIX.length);
  return id === "" ? null : id;
}

/** What the id of a call looks like, for the step schema. */
export const CUSTOM_ACTION_STEP_ID_PATTERN = /^customAction:[A-Za-z0-9_-]+$/;

/** A parameter name: what the script reads as `args.<name>`, so a JavaScript identifier. */
export const PARAMETER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface CustomActionParameter {
  name: string;
  /** Says what to put in it, in the builder's hint. */
  description?: string | null;
  required: boolean;
}

/**
 * The arguments of a call: "name=value; other=value".
 *
 * One line, because the builder's value field is one line, like every other step's. A value
 * that needs a semicolon writes it as `\;`. Values keep their `{{placeholders}}`: they are
 * resolved when the step runs, not here.
 */
export function parseArguments(value: string | null | undefined): { args: Record<string, string> } | { error: string } {
  const args: Record<string, string> = {};
  const text = (value ?? "").trim();
  if (text === "") return { args };
  const parts = text.split(/(?<!\\);/).map((part) => part.replace(/\\;/g, ";").trim()).filter(Boolean);
  for (const part of parts) {
    const at = part.indexOf("=");
    const name = at === -1 ? "" : part.slice(0, at).trim();
    if (!PARAMETER_NAME_PATTERN.test(name)) {
      return { error: `"${part}" is not name=value. Separate arguments with ; — for example code=4711; qty=2.` };
    }
    args[name] = part.slice(at + 1).trim();
  }
  return { args };
}

/** The hint the builder shows in the value field: "code=…; qty=…". */
export function argumentsHint(parameters: CustomActionParameter[]): string {
  return parameters.map((p) => `${p.name}=…${p.required ? "" : " (optional)"}`).join("; ");
}

/** Which required parameters a call leaves out, and which it names that the action does not have. */
export function checkArguments(
  parameters: CustomActionParameter[],
  args: Record<string, string>,
): string | null {
  const missing = parameters.filter((p) => p.required && (args[p.name] ?? "") === "").map((p) => p.name);
  if (missing.length > 0) return `Missing argument(s): ${missing.join(", ")}.`;
  const known = new Set(parameters.map((p) => p.name));
  const unknown = Object.keys(args).filter((name) => !known.has(name));
  if (unknown.length > 0) return `Unknown argument(s): ${unknown.join(", ")}.`;
  return null;
}
