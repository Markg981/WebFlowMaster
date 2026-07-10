import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import { eq, asc } from 'drizzle-orm';
import { db } from '../../server/db';
import { users, projects, tests, apiTests } from '@shared/schema';
import { buildViewInventory, type UiElement } from './parse-views';
import { mapSteps, splitSteps, type MappedStep } from './map-steps';

const DEFAULT_XLSX = String.raw`C:\Users\marco.oliva\Downloads\DMO NCC Test Scripts.xlsx`;
const DEFAULT_VIEWS = String.raw`C:\Users\marco.oliva\source\repos\DMO_3\DMO.NetContent\Templates\Views`;
const BASE_URL = process.env.DMO_BASE_URL || 'http://localhost:7000';

// Excel step patterns that leave the NetContent pages -> the test is cross-module, skip.
const CROSS = /sub-?function|po management|configuration|recipe|plant config|operator console|sub_function|start the po|material group|batch/i;

// Known precondition dependencies derived from the code (getRequiredCheckStatus etc.):
// feature -> substring of the setup API url to look up among the imported apiTests.
const PRECONDITION_API: Record<string, string> = {
  'Tare Check': 'NetContentScale/SaveCheck',
};

const cell = (row: any[], i: number) => {
  const v = row[i];
  if (v == null) return '';
  return typeof v === 'object' ? String(v.result ?? v.text ?? '') : String(v);
};

interface DetectedElement {
  id: string;
  type: string;
  selector: string;
  text: string;
  tag: string;
  attributes: Record<string, string>;
}

function inventoryToDetected(elements: UiElement[]): DetectedElement[] {
  return elements.map((e, i) => ({
    id: `elem-${e.tag}-${i}`,
    type: e.role,
    selector: e.selector,
    text: e.label,
    tag: e.tag,
    attributes: {
      ...(e.name ? { name: e.name } : {}),
      ...(e.id ? { id: e.id } : {}),
      ...(e.ngModel ? { 'ng-model': e.ngModel } : {}),
      ...(e.ngClick ? { 'ng-click': e.ngClick } : {}),
    },
  }));
}

const ACTION_META: Record<string, { id: string; name: string }> = {
  click: { id: 'click', name: 'Click' },
  input: { id: 'input', name: 'Input' },
  select: { id: 'select', name: 'Select' },
  assertion: { id: 'assertTextContains', name: 'Assert Text Contains' },
};

// Convert a MappedStep into the app's saved TestStep shape the executor reads.
function toTestStep(m: MappedStep, detected: DetectedElement[]) {
  if (m.action === 'navigate') return null; // navigation is the test url, not a step
  const meta = ACTION_META[m.action];
  const selector = m.selector ?? (m.action === 'assertion' ? 'body' : undefined);
  const target = selector
    ? detected.find((d) => d.selector === selector) ?? { id: `elem-adhoc`, type: 'element', selector, text: m.label ?? '', tag: 'unknown', attributes: {} }
    : undefined;
  return {
    action: { id: meta.id, type: meta.id, name: meta.name, icon: '', description: m.rawStep },
    targetElement: target,
    value: m.value ?? null,
    _note: m.note, // review hint, ignored by the executor
  };
}

function featureViews(viewsDir: string, feature: string): string[] {
  const key = feature.toLowerCase().replace(/[^a-z0-9]/g, '');
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.html')) {
        const norm = full.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (norm.includes(key)) out.push(full);
      }
    }
  };
  walk(viewsDir);
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const feature = (args.find((a) => !a.startsWith('--')) || 'Tare Check').trim();
  const xlsx = process.env.NETCONTENT_XLSX || DEFAULT_XLSX;
  const viewsDir = process.env.NETCONTENT_VIEWS_DIR || DEFAULT_VIEWS;

  // 1. Inventory for the feature's views -> detected elements.
  const viewFiles = featureViews(viewsDir, feature);
  if (viewFiles.length === 0) {
    console.error(`No view templates matched feature "${feature}" in ${viewsDir}`);
    process.exit(1);
  }
  const elements: UiElement[] = [];
  for (const f of viewFiles) elements.push(...buildViewInventory(f).elements);
  const detected = inventoryToDetected(elements);
  console.log(`Feature "${feature}": ${viewFiles.length} view(s), ${elements.length} elements.`);

  // 2. Read the confined test cases for this feature.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsx);
  const ws = wb.getWorksheet('Test Cases')!;
  const cases: { id: string; steps: string; expected: string; precond: string; priority: string }[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r).values as any[];
    const id = cell(row, 1).trim();
    if (!id || cell(row, 6).trim().toLowerCase() !== feature.toLowerCase()) continue;
    const steps = cell(row, 12);
    if (CROSS.test(cell(row, 10) + ' ' + steps)) continue; // skip cross-module
    cases.push({ id, steps, expected: cell(row, 14), precond: cell(row, 10), priority: cell(row, 2) || 'Medium' });
  }
  console.log(`Confined test cases for "${feature}": ${cases.length}`);

  // 3. Resolve owner/project + precondition API (once).
  const userId = (await db.select({ id: users.id }).from(users).orderBy(asc(users.id)).limit(1))[0]?.id;
  if (!userId) throw new Error('No users in DB.');
  const precApiUrl = PRECONDITION_API[feature];
  let precondition: any[] | null = null;
  if (precApiUrl) {
    const all = await db.select().from(apiTests);
    const setup = all.find((t) => t.url.includes(precApiUrl));
    if (setup) {
      precondition = [{
        id: `pc-${setup.id}`, name: setup.name, method: setup.method, url: setup.url,
        queryParams: Array.isArray(setup.queryParams) ? setup.queryParams : null,
        requestHeaders: null, requestBody: null, sourceApiTestId: setup.id,
      }];
    }
  }

  // 4. Build the records.
  const records = cases.map((c) => {
    const mapped = mapSteps(c.steps, elements);
    const sequence = mapped.map((m) => toTestStep(m, detected)).filter(Boolean);
    // expected outcome -> one containsText assertion against the page.
    for (const line of splitSteps(c.expected).slice(0, 1)) {
      sequence.push(toTestStep({ action: 'assertion', assertType: 'containsText', value: line.slice(0, 80), rawStep: line, note: 'assertion from Expected Outcome' }, detected)!);
    }
    const unmatched = mapped.filter((m) => m.note?.startsWith('unmatched')).length;
    return {
      userId,
      projectId: null as number | null,
      name: `${c.id} — ${feature}`,
      url: BASE_URL,
      sequence,
      elements: detected,
      preconditions: precondition,
      status: unmatched > 0 ? 'draft-review' : 'draft',
      module: feature,
      featureArea: 'NetContent',
      priority: (['Critical', 'High', 'Medium', 'Low'].includes(c.priority) ? c.priority : 'Medium'),
    };
  });

  const totalUnmatched = records.reduce((n, r) => n + r.sequence.filter((s: any) => s?._note?.startsWith('unmatched')).length, 0);
  console.log(`Generated ${records.length} draft tests. Steps needing review (unmatched): ${totalUnmatched}. Preconditions: ${precondition ? precondition[0].name : 'none'}.`);

  if (dryRun) {
    const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui-tests.preview.json');
    fs.writeFileSync(outPath, JSON.stringify(records.slice(0, 3), null, 2), 'utf-8');
    console.log(`--dry-run: wrote preview of first 3 to ${outPath}. No DB writes.`);
    // print the first test's sequence compactly
    const first = records[0];
    if (first) {
      console.log(`\nExample: ${first.name}  (url=${first.url})`);
      first.sequence.forEach((s: any, i: number) => console.log(`  ${i + 1}. [${s.action.id}] ${s.targetElement?.selector ?? '(no target)'}${s.value ? ` = "${s.value}"` : ''}${s._note ? `   <${s._note}>` : ''}`));
    }
    process.exit(0);
  }

  // 5. Find-or-create the project and insert (strip the _note helper).
  const projName = 'NetContent UI';
  const existing = await db.select({ id: projects.id }).from(projects).where(eq(projects.name, projName)).limit(1);
  const projectId = existing[0]?.id ?? (await db.insert(projects).values({ name: projName, userId }).returning({ id: projects.id }))[0].id;
  let created = 0;
  for (const r of records) {
    const seq = r.sequence.map((s: any) => ({ action: s.action, targetElement: s.targetElement, value: s.value }));
    await db.insert(tests).values({ ...r, projectId, sequence: seq } as any);
    created++;
  }
  console.log(`Inserted ${created} UI tests into project "${projName}" (id=${projectId}).`);
  process.exit(0);
}

main().catch((e) => {
  console.error('UI import failed:', e);
  process.exit(1);
});
