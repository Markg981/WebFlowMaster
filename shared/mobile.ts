import { z } from "zod";

/**
 * Tests of native mobile apps: an Android or iOS app on a real device of a cloud grid, driven
 * through Appium (server/mobile-runner.ts).
 *
 * A test of its own kind, not a web test with extra steps: a native screen has no CSS and no DOM,
 * and a step names an element the way the app's view tree knows it — its accessibility id, its
 * resource id, its text, or XPath through the tree. The locator syntax is written out here, once,
 * so the editor, the API and the runner read a step the same way.
 */

export const MOBILE_PLATFORMS = ["android", "ios"] as const;
export type MobilePlatform = (typeof MOBILE_PLATFORMS)[number];

export const MOBILE_PLATFORM_LABELS: Record<MobilePlatform, string> = { android: "Android", ios: "iOS" };

/** The grids that run apps. A Playwright server of one's own runs browsers only. */
export const MOBILE_GRID_PROVIDERS = ["browserstack", "lambdatest", "local_appium"] as const;

/** What a step does, and whether it names an element and takes a value. */
export const MOBILE_ACTIONS = {
  tap: { target: true, value: false },
  type: { target: true, value: true },
  clear: { target: true, value: false },
  waitFor: { target: true, value: false },
  assertVisible: { target: true, value: false },
  assertNotVisible: { target: true, value: false },
  /** The element's text contains the value. */
  assertText: { target: true, value: true },
  /** up, down, left or right: the direction the finger moves. */
  swipe: { target: false, value: true },
  back: { target: false, value: false },
  hideKeyboard: { target: false, value: false },
  /** Seconds. */
  wait: { target: false, value: true },
} as const;
export type MobileActionId = keyof typeof MOBILE_ACTIONS;
export const MOBILE_ACTION_IDS = Object.keys(MOBILE_ACTIONS) as MobileActionId[];

export const SWIPE_DIRECTIONS = ["up", "down", "left", "right"] as const;

export interface MobileStep {
  id: string;
  action: MobileActionId;
  target?: string;
  value?: string;
}

/** A locator as WebDriver takes it: a strategy and a value. */
export interface MobileLocator {
  using: "accessibility id" | "id" | "xpath" | "-android uiautomator" | "-ios predicate string" | "-ios class chain";
  value: string;
}

const xpathLiteral = (text: string) =>
  !text.includes("'") ? `'${text}'` : !text.includes('"') ? `"${text}"` : `concat('${text.split("'").join(`', "'", '`)}')`;

/**
 * How a step names an element:
 *
 * - `~login` — its accessibility id (content-desc on Android, accessibilityIdentifier on iOS): the
 *   one to ask developers for, since it survives redesigns and translations;
 * - `id=com.shop:id/login` — its resource id (Android) or name (iOS);
 * - `text=Sign in` — an element showing exactly that text;
 * - `//android.widget.Button[@text='OK']` — XPath through the view tree;
 * - `android=new UiSelector().text("OK")`, `ios=label == "OK"`, `chain=**` + `/XCUIElementTypeButton` —
 *   the platform's own engines, for what the others cannot say.
 *
 * Null when it is none of these.
 */
export function parseMobileLocator(raw: string, platform: MobilePlatform): MobileLocator | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.startsWith("~")) return text.length > 1 ? { using: "accessibility id", value: text.slice(1) } : null;
  if (text.startsWith("/") || text.startsWith("(")) return { using: "xpath", value: text };
  const prefixed = /^(id|text|android|ios|chain)=([\s\S]+)$/.exec(text);
  if (!prefixed) return null;
  const [, kind, value] = prefixed;
  switch (kind) {
    case "id":
      return { using: "id", value };
    case "text": {
      const literal = xpathLiteral(value);
      return {
        using: "xpath",
        value: platform === "android" ? `//*[@text=${literal}]` : `//*[@label=${literal} or @name=${literal} or @value=${literal}]`,
      };
    }
    case "android":
      return platform === "android" ? { using: "-android uiautomator", value } : null;
    case "ios":
      return platform === "ios" ? { using: "-ios predicate string", value } : null;
    case "chain":
      return platform === "ios" ? { using: "-ios class chain", value } : null;
    default:
      return null;
  }
}

/** What is wrong with a step, or null. */
export function mobileStepProblem(step: MobileStep, platform: MobilePlatform): string | null {
  const spec = MOBILE_ACTIONS[step.action];
  if (!spec) return `"${step.action}" is not a mobile action.`;
  if (spec.target) {
    if (!step.target?.trim()) return `${step.action} needs an element.`;
    if (!parseMobileLocator(step.target, platform)) {
      return `"${step.target}" is not a locator for ${MOBILE_PLATFORM_LABELS[platform]}: write ~accessibilityId, id=…, text=…, an XPath, or ${platform === "android" ? "android=…" : "ios=… or chain=…"}.`;
    }
  }
  if (spec.value && !(step.value ?? "").trim() && step.action !== "type") return `${step.action} needs a value.`;
  if (step.action === "swipe" && !SWIPE_DIRECTIONS.includes((step.value ?? "").trim().toLowerCase() as any)) {
    return `swipe takes up, down, left or right, not "${step.value}".`;
  }
  if (step.action === "wait") {
    const seconds = Number(step.value);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60) return "wait takes a number of seconds, up to 60.";
  }
  return null;
}

export const mobileStepSchema = z.object({
  id: z.string().min(1).max(64),
  action: z.enum(MOBILE_ACTION_IDS as [MobileActionId, ...MobileActionId[]]),
  target: z.string().max(2000).optional(),
  value: z.string().max(5000).optional(),
});

/** A file on the agent's machine, for a local Appium: /home/qa/shop.apk, C:\\apps\\shop.apk, ~/shop.ipa. */
export function isLocalAppPath(app: string): boolean {
  return /^(\/|~\/|[A-Za-z]:[\\/])\S/.test(app) && /\.(apk|aab|ipa|app|zip)$/i.test(app);
}

export const mobileTestSchema = z
  .object({
    name: z.string().trim().min(1, "A name is required.").max(200),
    platform: z.enum(MOBILE_PLATFORMS),
    app: z
      .string()
      .trim()
      .min(1, "Which app: bs://… or lt://… from an upload, or its address.")
      .max(1000)
      .refine(
        (app) => /^(bs|lt):\/\/\S+$/.test(app) || /^https?:\/\/\S+$/.test(app) || isLocalAppPath(app),
        "The app is bs://…, lt://…, an http(s):// address the grid downloads it from, or — for a local Appium — its path on the agent's machine.",
      ),
    deviceName: z.string().trim().min(1, "Which device, as the grid names it: Google Pixel 8, iPhone 15.").max(120),
    osVersion: z.string().trim().max(20).optional().nullable(),
    /** The project it belongs to; in a restricted one, only its members see it (migration 0057). */
    projectId: z.number().int().positive().optional().nullable(),
    /** The grid it runs on in a plan: a BrowserStack or LambdaTest one of the organization. */
    gridId: z.string().trim().max(100).optional().nullable(),
    steps: z.array(mobileStepSchema).max(200),
  })
  .superRefine((test, ctx) => {
    test.steps.forEach((step, index) => {
      const problem = mobileStepProblem(step, test.platform);
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["steps", index], message: `Step ${index + 1}: ${problem}` });
    });
  });

export type MobileTestInput = z.infer<typeof mobileTestSchema>;

export type MobileRunStatus = "queued" | "running" | "passed" | "failed" | "error";

export interface MobileStepResult {
  index: number;
  action: MobileActionId;
  target?: string;
  status: "passed" | "failed" | "skipped";
  error?: string;
  detail?: string;
  durationMs: number;
}

/**
 * A mobile test's result in a plan's report (report_test_case_results.detailed_log): the device it
 * ran on, the grid's page for the session and the steps. `mobile: true` tells it from a web test's
 * step list and a manual test's log.
 */
export interface MobileResultLog {
  mobile: true;
  device: string;
  platform: "android" | "ios";
  sessionUrl: string | null;
  steps: MobileStepResult[];
}

export function isMobileResultLog(value: unknown): value is MobileResultLog {
  return !!value && typeof value === "object" && (value as { mobile?: unknown }).mobile === true && Array.isArray((value as { steps?: unknown }).steps);
}

/**
 * A mobile test's steps as the report's step list reads them: name, type, element, outcome. The steps
 * never reached are left out, as a web test's are: the failed one says why the rest did not run.
 */
export function mobileLogSteps(log: MobileResultLog) {
  return log.steps
    .filter((step) => step.status !== "skipped")
    .map((step) => ({
      name: `${step.index + 1}. ${step.action}${step.target ? ` ${step.target}` : ""}`,
      type: step.action,
      selector: step.target ?? null,
      status: step.status,
      error: step.error,
      details: step.detail ?? "",
      durationMs: step.durationMs,
    }));
}

/** A parsed detailed_log as a step list: a mobile test's log becomes one; anything else is as it was. */
export function stepListOf(parsed: unknown): unknown {
  return isMobileResultLog(parsed) ? mobileLogSteps(parsed) : parsed;
}

/** The grid's page for a mobile result's session, read from its detailed_log; null for any other result. */
export function mobileSessionUrl(detailedLog: string | null | undefined): string | null {
  if (!detailedLog) return null;
  try {
    const parsed: unknown = JSON.parse(detailedLog);
    return isMobileResultLog(parsed) && typeof parsed.sessionUrl === "string" ? parsed.sessionUrl : null;
  } catch {
    return null;
  }
}
