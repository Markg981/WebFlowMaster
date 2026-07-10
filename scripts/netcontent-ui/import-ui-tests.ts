import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import { and, eq, asc } from 'drizzle-orm';
import { db } from '../../server/db';
import { users, projects, tests, apiTests } from '@shared/schema';
import { buildViewInventory, type UiElement } from './parse-views';
import { mapSteps, splitSteps, type MappedStep } from './map-steps';

const DEFAULT_XLSX = String.raw`C:\Users\marco.oliva\Downloads\DMO NCC Test Scripts.xlsx`;
const DEFAULT_VIEWS = String.raw`C:\Users\marco.oliva\source\repos\DMO_3\DMO.NetContent\Templates\Views`;
const BASE_URL = process.env.DMO_BASE_URL || 'http://localhost:7000';
const PROJECT_NAME = 'NetContent UI';

// Steps that leave the NetContent pages -> cross-module, not automatable here.
const CROSS = /sub-?function|po management|configuration|recipe|plant config|operator console|sub_function|start the po|material group|batch/i;

// Precondition dependencies derived from the code (getRequiredCheckStatus etc.):
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

function toTestStep(m: MappedStep, detected: DetectedElement[]) {
  if (m.action === 'navigate') return null; // navigation is the test url, not a step
  const meta = ACTION_META[m.action];
  const selector = m.selector ?? (m.action === 'assertion' ? 'body' : undefined);
  const target = selector
    ? detected.find((d) => d.selector === selector) ?? { id: 'elem-adhoc', type: 'element', selector, text: m.label ?? '', tag: 'unknown', attributes: {} }
    : undefined;
  return {
    action: { id: meta.id, type: meta.id, name: meta.name, icon: '', description: m.rawStep },
    targetElement: target,
    value: m.value ?? null,
    _note: m.note,
  };
}

// Keyword -> view file(s), derived from NCCViewContainer.controller.js getView(viewId).
// Robust against the Excel's freeform "Feature Highlight" values.
const VIEW_RULES: { test: RegExp; views: string[] }[] = [
  { test: /tray\s*weight/i, views: ['TareCheck/TrayWeightCapture.html'] },
  { test: /tare/i, views: ['TareCheck/TareCheckSimple.html', 'TareCheck/TareCheckAdvance.html', 'TareCheck/TareCheckAdhoc.html', 'TareCheck/TareCheckTareRange.html'] },
  { test: /cw\s*25|cw25|cwmod|cw\s*mod/i, views: ['CheckweigherCheck.html'] },
  { test: /monitoring.*checkweigher|ncm\s*cw|cw\s*monitoring/i, views: ['CheckweigherMonitoring.html'] },
  { test: /monitoring.*static\s*scale|ncm\s*sc|ncmsc/i, views: ['NetContentMonitoringSC.html'] },
  { test: /static\s*scale/i, views: ['StaticScaleCheck.html'] },
  { test: /qstat/i, views: ['QStat/NetContentQstat.html'] },
  { test: /release/i, views: ['NetContentRelease.html'] },
  { test: /snc/i, views: ['NetContentSncCalculation.html'] },
  { test: /rejection/i, views: ['RejectionReliabilityCheck.html'] },
  { test: /filler|component\s*weighing/i, views: ['FillerAssessmentTest.html'] },
];

function featureViews(viewsDir: string, feature: string): string[] {
  const rule = VIEW_RULES.find((r) => r.test.test(feature));
  if (!rule) return [];
  return rule.views.map((v) => path.join(viewsDir, ...v.split('/'))).filter((p) => fs.existsSync(p));
}

interface Row { id: string; steps: string; expected: string; precond: string; priority: string; feature: string }

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlyFeature = args.find((a) => !a.startsWith('--'));
  const xlsx = process.env.NETCONTENT_XLSX || DEFAULT_XLSX;
  const viewsDir = process.env.NETCONTENT_VIEWS_DIR || DEFAULT_VIEWS;

  // Read all confined test cases, grouped by feature.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsx);
  const ws = wb.getWorksheet('Test Cases')!;
  const byFeature = new Map<string, Row[]>();
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r).values as any[];
    const id = cell(row, 1).trim();
    if (!id) continue;
    const feature = cell(row, 6).trim();
    if (!feature) continue;
    if (onlyFeature && feature.toLowerCase() !== onlyFeature.toLowerCase()) continue;
    const steps = cell(row, 12);
    if (CROSS.test(cell(row, 10) + ' ' + steps)) continue; // confined only
    if (!byFeature.has(feature)) byFeature.set(feature, []);
    byFeature.get(feature)!.push({ id, steps, expected: cell(row, 14), precond: cell(row, 10), priority: cell(row, 2) || 'Medium', feature });
  }

  const userId = (await db.select({ id: users.id }).from(users).orderBy(asc(users.id)).limit(1))[0]?.id;
  if (!userId) throw new Error('No users in DB.');
  const allApiTests = await db.select().from(apiTests);

  let projectId: number | null = null;
  if (!dryRun) {
    const existing = await db.select({ id: projects.id }).from(projects).where(eq(projects.name, PROJECT_NAME)).limit(1);
    projectId = existing[0]?.id ?? (await db.insert(projects).values({ name: PROJECT_NAME, userId }).returning({ id: projects.id }))[0].id;
  }

  let grandTotal = 0;
  console.log(`Confined features: ${byFeature.size}. Project: "${PROJECT_NAME}"${dryRun ? ' (dry-run)' : ` (id=${projectId})`}\n`);

  for (const [feature, rows] of Array.from(byFeature.entries()).sort((a, b) => b[1].length - a[1].length)) {
    // Only import features backed by a real NetContent view (skip freeform/no-view rows).
    const viewFiles = featureViews(viewsDir, feature);
    if (viewFiles.length === 0) continue;
    const elements: UiElement[] = [];
    for (const f of viewFiles) elements.push(...buildViewInventory(f).elements);
    const detected = inventoryToDetected(elements);

    // Precondition (once per feature).
    let precondition: any[] | null = null;
    const precApiUrl = PRECONDITION_API[feature];
    if (precApiUrl) {
      const setup = allApiTests.find((t) => t.url.includes(precApiUrl));
      if (setup) {
        precondition = [{
          id: `pc-${setup.id}`, name: setup.name, method: setup.method, url: setup.url,
          queryParams: Array.isArray(setup.queryParams) ? setup.queryParams : null,
          requestHeaders: null, requestBody: null, sourceApiTestId: setup.id,
        }];
      }
    }

    let unmatchedSteps = 0;
    const records = rows.map((c) => {
      const mapped = mapSteps(c.steps, elements);
      unmatchedSteps += mapped.filter((m) => m.note?.startsWith('unmatched')).length;
      const sequence = mapped.map((m) => toTestStep(m, detected)).filter(Boolean);
      for (const line of splitSteps(c.expected).slice(0, 1)) {
        sequence.push(toTestStep({ action: 'assertion', assertType: 'containsText', value: line.slice(0, 80), rawStep: line, note: 'assertion from Expected Outcome' }, detected)!);
      }
      const hasUnmatched = mapped.some((m) => m.note?.startsWith('unmatched'));
      return {
        userId,
        name: `${c.id} — ${feature}`,
        url: BASE_URL,
        sequence,
        elements: detected,
        preconditions: precondition,
        status: elements.length === 0 || hasUnmatched ? 'draft-review' : 'draft',
        module: feature,
        featureArea: 'NetContent',
        priority: ['Critical', 'High', 'Medium', 'Low'].includes(c.priority) ? c.priority : 'Medium',
      };
    });

    console.log(
      `  ${String(records.length).padStart(3)} tests  ${feature}` +
        `  (views=${viewFiles.length}, elements=${elements.length}, unmatched-steps=${unmatchedSteps}${precondition ? ', precond=' + precondition[0].name : ''})`,
    );
    grandTotal += records.length;

    if (dryRun) continue;

    // Idempotent: replace this feature's tests in the project.
    await db.delete(tests).where(and(eq(tests.projectId, projectId!), eq(tests.module, feature)));
    for (const rec of records) {
      const seq = rec.sequence.map((s: any) => ({ action: s.action, targetElement: s.targetElement, value: s.value }));
      await db.insert(tests).values({ ...rec, projectId, sequence: seq } as any);
    }
  }

  console.log(`\n${dryRun ? 'Would import' : 'Imported'} ${grandTotal} confined draft UI tests across ${byFeature.size} features.`);
  if (dryRun) {
    const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui-tests.preview.json');
    fs.writeFileSync(outPath, JSON.stringify({ features: Array.from(byFeature.keys()), total: grandTotal }, null, 2), 'utf-8');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('UI import failed:', e);
  process.exit(1);
});
