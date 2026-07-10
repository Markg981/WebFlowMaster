import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse, type HTMLElement } from 'node-html-parser';

export interface UiElement {
  tag: string; // button | input | select | textarea | a | ...
  role: 'button' | 'input' | 'checkbox' | 'select' | 'textarea' | 'link' | 'clickable';
  action: 'click' | 'input' | 'toggle' | 'select'; // how a test would drive it
  selector: string; // best-effort stable selector for the live app
  label: string; // human-readable text/placeholder to match against Excel steps
  name?: string;
  id?: string;
  ngModel?: string;
  ngClick?: string; // the AngularJS handler (maps to a controller function / API)
  viewPrivilege?: string;
}

export interface ViewInventory {
  view: string; // file basename
  elements: UiElement[];
  actions: string[]; // controller function names (the action vocabulary), if a .controller.js exists
}

const clean = (s: string | undefined | null): string =>
  (s ?? '').replace(/\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim();

// Best-effort stable selector, prioritising the attributes AngularJS apps expose.
function bestSelector(el: HTMLElement): string {
  const name = el.getAttribute('name');
  const id = el.getAttribute('id');
  const ngModel = el.getAttribute('ng-model');
  const testid = el.getAttribute('data-testid');
  if (testid) return `[data-testid="${testid}"]`;
  if (name) return `[name="${name}"]`;
  if (id) return `#${id}`;
  if (ngModel) return `[ng-model="${ngModel}"]`;
  const ngClick = el.getAttribute('ng-click');
  if (ngClick) return `${el.rawTagName}[ng-click="${ngClick}"]`;
  return el.rawTagName;
}

function classify(el: HTMLElement): { role: UiElement['role']; action: UiElement['action'] } {
  const tag = el.rawTagName?.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (tag === 'input' && (type === 'checkbox' || type === 'radio')) return { role: 'checkbox', action: 'toggle' };
  if (tag === 'input' || tag === 'textarea') return { role: tag === 'textarea' ? 'textarea' : 'input', action: 'input' };
  if (tag === 'select') return { role: 'select', action: 'select' };
  if (tag === 'button') return { role: 'button', action: 'click' };
  if (tag === 'a') return { role: 'link', action: 'click' };
  return { role: 'clickable', action: 'click' }; // any [ng-click] element
}

export function parseView(html: string, viewName: string): UiElement[] {
  const root = parse(html, { lowerCaseTagName: false, comment: false });
  const nodes = root.querySelectorAll('button, input, select, textarea, a, [ng-click]');
  const seen = new Set<HTMLElement>();
  const elements: UiElement[] = [];
  for (const el of nodes) {
    if (seen.has(el)) continue;
    seen.add(el);
    const { role, action } = classify(el);
    const label =
      clean(el.text) ||
      clean(el.getAttribute('placeholder')) ||
      clean(el.getAttribute('title')) ||
      clean(el.getAttribute('aria-label')) ||
      clean(el.getAttribute('name')) ||
      clean(el.getAttribute('id')) ||
      clean(el.getAttribute('ng-model')) ||
      '';
    elements.push({
      tag: el.rawTagName,
      role,
      action,
      selector: bestSelector(el),
      label,
      name: el.getAttribute('name') || undefined,
      id: el.getAttribute('id') || undefined,
      ngModel: el.getAttribute('ng-model') || undefined,
      ngClick: el.getAttribute('ng-click') || undefined,
      viewPrivilege: el.getAttribute('view-privilege') || undefined,
    });
  }
  return elements;
}

// Controller function names — the action vocabulary the ng-click handlers resolve to.
export function parseControllerActions(js: string): string[] {
  const names = new Set<string>();
  const re = /(?:\$scope\.([a-zA-Z0-9_]+)\s*=\s*function|function\s+([a-zA-Z0-9_]+)\s*\()/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(js)) !== null) names.add(m[1] || m[2]);
  return Array.from(names);
}

export function buildViewInventory(htmlPath: string): ViewInventory {
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const viewName = path.basename(htmlPath, '.html');
  const elements = parseView(html, viewName);
  const ctrlPath = htmlPath.replace(/\.html$/, '.controller.js');
  const actions = fs.existsSync(ctrlPath) ? parseControllerActions(fs.readFileSync(ctrlPath, 'utf-8')) : [];
  return { view: viewName, elements, actions };
}

// CLI: dump a single view's inventory summary.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: tsx scripts/netcontent-ui/parse-views.ts <view.html>');
    process.exit(1);
  }
  const inv = buildViewInventory(file);
  const byAction = inv.elements.reduce<Record<string, number>>((a, e) => ((a[e.action] = (a[e.action] || 0) + 1), a), {});
  console.log(`VIEW: ${inv.view}`);
  console.log(`elements: ${inv.elements.length}`, byAction);
  console.log(`controller actions: ${inv.actions.length}`);
  console.log('\n--- sample interactive elements ---');
  for (const e of inv.elements.filter((x) => x.label).slice(0, 25)) {
    console.log(`  [${e.action}] "${e.label.slice(0, 40)}" -> ${e.selector}${e.ngClick ? `  (ng-click: ${e.ngClick.slice(0, 50)})` : ''}`);
  }
}
