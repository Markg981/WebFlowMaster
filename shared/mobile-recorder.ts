import type { MobilePlatform } from "./mobile";
import { suggestLocators, type InspectorNode } from "./mobile-inspector";

/**
 * The recorder's rules: what a touch on the inspector's screenshot becomes as a step. A tap names the
 * element under the finger with its sturdiest locator; a drag becomes a swipe in its direction; a text
 * field asks for what to type; a password field's value is flagged so it can become a {{variable}}.
 */

export interface RecordedTarget {
  locator: string;
  /** Only a position in the tree names it: the step breaks as soon as the screen's layout changes. */
  fragile: boolean;
}

/** The locator a recorded step uses for this node: the first suggestion, unique ones come first. */
export function recordTarget(root: InspectorNode, node: InspectorNode, platform: MobilePlatform): RecordedTarget | null {
  const best = suggestLocators(root, node, platform)[0];
  if (!best) return null;
  return { locator: best.locator, fragile: !best.unique || (best.kind === "xpath" && best.locator.startsWith("/") && !best.locator.startsWith("//")) };
}

export type SwipeDirection = "up" | "down" | "left" | "right";

/**
 * The direction a finger moved from one point to another, or null when it hardly moved — a tap.
 * The threshold is a share of the screen's width, so it means the same on every device.
 */
export function dragDirection(
  from: { x: number; y: number },
  to: { x: number; y: number },
  window: { width: number; height: number },
): SwipeDirection | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < Math.max(window.width, 1) * 0.05) return null;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? "up" : "down";
  return dx < 0 ? "left" : "right";
}

const TEXT_FIELD = /^(android\.widget\.(EditText|AutoCompleteTextView|MultiAutoCompleteTextView)|XCUIElementType(TextField|SecureTextField|SearchField|TextView))$/;

/** Whether one types into this node. */
export function isTextField(node: InspectorNode): boolean {
  return TEXT_FIELD.test(node.type);
}

/** Whether what is typed into it is a secret: Android's password flag, iOS's secure field. */
export function isSecretField(node: InspectorNode): boolean {
  return node.attributes.password === "true" || node.type === "XCUIElementTypeSecureTextField";
}

/** The text an assertText step would check now: Android's text; iOS's value, else its label. */
export function currentText(node: InspectorNode, platform: MobilePlatform): string {
  if (platform === "android") return node.attributes.text ?? "";
  return node.attributes.value || node.attributes.label || "";
}
