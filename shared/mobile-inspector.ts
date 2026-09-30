import type { MobilePlatform } from "./mobile";

/**
 * The inspector's model of a screen: Appium's page source — the app's view tree as XML, Android's
 * UiAutomator hierarchy or iOS's XCUITest one — read into nodes with their bounds, and the ways a
 * step could name each node (shared/mobile.ts parseMobileLocator), best first, with whether each
 * finds only that node on this screen.
 */

export interface InspectorBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InspectorNode {
  /** Its path in the tree, "0.2.1": stable for one snapshot, not across them. */
  id: string;
  /** The element's class: android.widget.Button, XCUIElementTypeButton. */
  type: string;
  attributes: Record<string, string>;
  bounds: InspectorBounds | null;
  children: InspectorNode[];
}

export type LocatorKind = "accessibility" | "id" | "text" | "xpath";

export interface LocatorSuggestion {
  kind: LocatorKind;
  locator: string;
  /** Whether it finds this node and no other on this screen. */
  unique: boolean;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return ENTITIES[entity];
  });
}

/** Android writes bounds as "[x1,y1][x2,y2]"; iOS as x, y, width and height attributes. */
function boundsOf(attributes: Record<string, string>): InspectorBounds | null {
  const android = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(attributes.bounds ?? "");
  if (android) {
    const [x1, y1, x2, y2] = android.slice(1).map(Number);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }
  if (["x", "y", "width", "height"].every((k) => attributes[k] !== undefined && attributes[k] !== "")) {
    const [x, y, width, height] = ["x", "y", "width", "height"].map((k) => Number(attributes[k]));
    if ([x, y, width, height].every(Number.isFinite)) return { x, y, width, height };
  }
  return null;
}

/**
 * Reads a page source. Only what page sources contain — elements with attributes, a declaration,
 * comments — not XML in general. Null when there is no element at all.
 */
export function parsePageSource(xml: string): InspectorNode | null {
  const tag = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const attribute = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const root: InspectorNode = { id: "", type: "#document", attributes: {}, bounds: null, children: [] };
  const stack: InspectorNode[] = [root];
  for (let match = tag.exec(xml); match; match = tag.exec(xml)) {
    const [, closing, name, attrs, selfClosing] = match;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (!name) continue;
    const attributes: Record<string, string> = {};
    for (let a = attribute.exec(attrs ?? ""); a; a = attribute.exec(attrs ?? "")) attributes[a[1]] = decode(a[2] ?? a[3] ?? "");
    attribute.lastIndex = 0;
    const parent = stack[stack.length - 1];
    const node: InspectorNode = {
      id: parent === root ? String(parent.children.length) : `${parent.id}.${parent.children.length}`,
      // Older UiAutomator dumps name every element "node" and keep the class in an attribute.
      type: name === "node" && attributes.class ? attributes.class : name,
      attributes,
      bounds: boundsOf(attributes),
      children: [],
    };
    parent.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root.children[0] ?? null;
}

export function flatten(root: InspectorNode): InspectorNode[] {
  const all: InspectorNode[] = [];
  const walk = (node: InspectorNode) => {
    all.push(node);
    node.children.forEach(walk);
  };
  walk(root);
  return all;
}

export function findNode(root: InspectorNode, id: string): InspectorNode | null {
  return flatten(root).find((node) => node.id === id) ?? null;
}

const area = (b: InspectorBounds) => b.width * b.height;

/**
 * The element under a point of the screen, in the tree's coordinates: the smallest one containing
 * it, since a tap reaches the innermost view. Elements of no size (hidden, off screen) are skipped.
 */
export function nodeAt(root: InspectorNode, x: number, y: number): InspectorNode | null {
  let best: InspectorNode | null = null;
  for (const node of flatten(root)) {
    const b = node.bounds;
    if (!b || b.width <= 0 || b.height <= 0) continue;
    if (x < b.x || y < b.y || x >= b.x + b.width || y >= b.y + b.height) continue;
    if (!best || area(b) <= area(best.bounds!)) best = node;
  }
  return best;
}

/** The attributes each kind of locator reads, per platform. */
function accessibilityOf(node: InspectorNode, platform: MobilePlatform) {
  return platform === "android" ? node.attributes["content-desc"] : node.attributes.name;
}
function idOf(node: InspectorNode, platform: MobilePlatform) {
  return platform === "android" ? node.attributes["resource-id"] : undefined;
}
function textOf(node: InspectorNode, platform: MobilePlatform) {
  return platform === "android" ? node.attributes.text : node.attributes.label;
}
/** What text=… matches (shared/mobile.ts): Android's text; iOS's label, name or value. */
function matchesText(node: InspectorNode, platform: MobilePlatform, text: string) {
  if (platform === "android") return node.attributes.text === text;
  return node.attributes.label === text || node.attributes.name === text || node.attributes.value === text;
}

const quoteXPath = (value: string) =>
  !value.includes('"') ? `"${value}"` : !value.includes("'") ? `'${value}'` : `concat("${value.split('"').join(`", '"', "`)}")`;

/** The node's position from the root, by type and index among same-type siblings: always unique. */
function absoluteXPath(root: InspectorNode, target: InspectorNode): string {
  const path: string[] = [];
  const walk = (node: InspectorNode, trail: string[]): boolean => {
    if (node === target) {
      path.push(...trail);
      return true;
    }
    const counts = new Map<string, number>();
    for (const child of node.children) {
      const n = (counts.get(child.type) ?? 0) + 1;
      counts.set(child.type, n);
      if (walk(child, [...trail, `${child.type}[${n}]`])) return true;
    }
    return false;
  };
  walk(root, [root.type]);
  return `/${path.join("/")}`;
}

/** The ways a step can name this node, sturdiest first. */
export function suggestLocators(root: InspectorNode, node: InspectorNode, platform: MobilePlatform): LocatorSuggestion[] {
  const all = flatten(root);
  const count = (matches: (other: InspectorNode) => boolean) => all.filter(matches).length;
  const suggestions: LocatorSuggestion[] = [];

  const accessibility = accessibilityOf(node, platform);
  if (accessibility) {
    suggestions.push({ kind: "accessibility", locator: `~${accessibility}`, unique: count((o) => accessibilityOf(o, platform) === accessibility) === 1 });
  }
  const id = idOf(node, platform);
  if (id) suggestions.push({ kind: "id", locator: `id=${id}`, unique: count((o) => idOf(o, platform) === id) === 1 });
  const text = textOf(node, platform);
  if (text) suggestions.push({ kind: "text", locator: `text=${text}`, unique: count((o) => matchesText(o, platform, text)) === 1 });

  // An XPath on the type and the most telling attribute, when there is one; else the position.
  const attribute = platform === "android" ? (["resource-id", "content-desc", "text"] as const) : (["name", "label"] as const);
  const named = attribute.find((a) => node.attributes[a]);
  if (named) {
    const value = node.attributes[named];
    const unique = count((o) => o.type === node.type && o.attributes[named] === value) === 1;
    suggestions.push({ kind: "xpath", locator: `//${node.type}[@${named}=${quoteXPath(value)}]`, unique });
  }
  if (!suggestions.some((s) => s.unique)) suggestions.push({ kind: "xpath", locator: absoluteXPath(root, node), unique: true });

  // Unique ones first, keeping the order of sturdiness within each group.
  return [...suggestions.filter((s) => s.unique), ...suggestions.filter((s) => !s.unique)];
}
