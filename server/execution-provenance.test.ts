import { describe, expect, it } from 'vitest';
import type { TestPlan } from '@shared/schema';
import { buildExecutionSnapshot } from './execution-snapshot';
import { buildExecutionProvenance, inputFingerprint, reproducibilitySummary } from './execution-provenance';
import { renderReportHtml } from './report-html';
import { buildAllureResults } from './allure-export';
import { buildJUnitXml } from './junit';
import type { ReportModel } from './report-model';

function frozen() {
  const snapshot = buildExecutionSnapshot({ id: 'plan', name: 'Queued plan' } as TestPlan, []);
  snapshot.definitions = { version: 1, ui: [], api: [] };
  snapshot.datasets = { version: 1, variables: { 'data.private.value': 'sensitive-value' }, tests: [] };
  snapshot.mobileDefinitions = [];
  snapshot.provenance = buildExecutionProvenance(snapshot);
  return snapshot;
}
describe('input provenance', () => {
  it('canonicalizes JSON ordering, dates and undefined without treating array order as interchangeable', () => {
    expect(inputFingerprint({ b: 2, a: 1, absent: undefined })).toBe(inputFingerprint({ a: 1, b: 2 }));
    expect(inputFingerprint({ when: new Date('2026-10-06T20:00:00Z') })).toBe(inputFingerprint({ when: '2026-10-06T20:00:00.000Z' }));
    expect(inputFingerprint([1, 2])).not.toBe(inputFingerprint([2, 1]));
  });
  it('verifies persisted JSON, excludes replay lineage from the fingerprint, and does not expose values', () => {
    const snapshot = frozen();
    snapshot.replayOf = { executionId: 'source', requestedAt: new Date().toISOString() };
    const summary = reproducibilitySummary(JSON.parse(JSON.stringify(snapshot)));
    expect(summary.available).toBe(true);
    expect(summary.provenance?.inputFingerprint).toBe(snapshot.provenance?.inputFingerprint);
    expect(summary.replayOf?.executionId).toBe('source');
    expect(JSON.stringify(summary)).not.toContain('sensitive-value');
  });
  it('rejects changed dataset inputs, missing selected definitions and unsupported legacy snapshots', () => {
    const snapshot = frozen();
    snapshot.datasets!.variables['data.private.value'] = 'changed';
    expect(reproducibilitySummary(snapshot).available).toBe(false);
    const missing = frozen();
    missing.selectedTests = [{ testType: 'ui', testId: 42, apiTestId: null }];
    missing.provenance = buildExecutionProvenance(missing);
    expect(reproducibilitySummary(missing).available).toBe(false);
    expect(reproducibilitySummary({}).available).toBe(false);
  });
  it('includes safe provenance in HTML/PDF source, Allure attachments and JUnit properties', () => {
    const summary = reproducibilitySummary(frozen());
    const model = { planName: 'Queued plan', executionId: 'run', planId: 'plan', status: 'completed', trigger: 'manual', maxAttempts: 1,
      counts: { total: 0, passed: 0, failed: 0, errors: 0, skipped: 0, quarantinedFailures: 0, flaky: 0 }, results: [], reproducibility: summary } as unknown as ReportModel;
    const html = renderReportHtml(model);
    expect(html).toContain(summary.provenance!.inputFingerprint);
    expect(html).not.toContain('sensitive-value');
    const allure = buildAllureResults(model);
    expect(JSON.parse(allure.find(file => file.name === 'execution-provenance.json')!.data.toString())).toEqual(summary);
    expect(buildJUnitXml({ planName: 'Queued plan', executionId: 'run', results: [{ testName: 'UI', status: 'Passed' }], properties: { provenance: JSON.stringify(summary) } })).toContain(summary.provenance!.inputFingerprint);
  });
});
