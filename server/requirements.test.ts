import { describe, it, expect } from 'vitest';
import {
  computeCoverage,
  coverageState,
  coverageSummary,
  kindFromTrackerType,
  outcomeOf,
  type CoverageTest,
} from '@shared/requirements';
import { matrixCsv, type RequirementRow } from './requirements';

/** What a requirement's coverage is, from the outcomes of the tests that cover it. */

const test = (type: 'ui' | 'api', id: number, outcome: CoverageTest['outcome'], name = `${type}${id}`): CoverageTest => ({
  type,
  id,
  name,
  outcome,
  lastRun: outcome === 'notRun' ? null : { executionId: `run-${id}`, planId: 'p1', planName: 'Nightly', at: '2026-09-30T02:00:00.000Z' },
});

describe('one test, one run', () => {
  it('fails when any browser failed, and waits for a manual verdict', () => {
    expect(outcomeOf(['Passed', 'Failed'])).toBe('failed');
    expect(outcomeOf(['Passed', 'Error'])).toBe('failed');
    expect(outcomeOf(['Pending'])).toBe('pending');
    expect(outcomeOf(['Passed', 'Skipped'])).toBe('passed');
    expect(outcomeOf(['Skipped'])).toBe('skipped');
    expect(outcomeOf([])).toBe('notRun');
  });
});

describe('a requirement', () => {
  it('is uncovered, failing, passing or not run', () => {
    expect(coverageState([])).toBe('uncovered');
    expect(coverageState(['passed', 'failed', 'notRun'])).toBe('failing');
    expect(coverageState(['passed', 'passed'])).toBe('passing');
    expect(coverageState(['passed', 'pending'])).toBe('notRun');
    expect(coverageState(['skipped'])).toBe('notRun');
  });

  it('takes its kind from the tracker', () => {
    expect(kindFromTrackerType('Epic')).toBe('epic');
    expect(kindFromTrackerType('Feature')).toBe('epic');
    expect(kindFromTrackerType('Story')).toBe('story');
    expect(kindFromTrackerType('User Story')).toBe('story');
    expect(kindFromTrackerType('Product Backlog Item')).toBe('story');
    expect(kindFromTrackerType('Requirement')).toBe('requirement');
    expect(kindFromTrackerType('Task')).toBe('requirement');
  });
});

describe('an epic', () => {
  const visible = new Map([
    ['ui:1', test('ui', 1, 'passed', 'Login')],
    ['ui:2', test('ui', 2, 'failed', 'Checkout')],
    ['api:1', test('api', 1, 'passed', 'Orders API')],
  ]);
  const nodes = [
    { id: 10, parentId: null }, // epic
    { id: 11, parentId: 10 }, // story: login
    { id: 12, parentId: 10 }, // story: checkout
    { id: 13, parentId: 11 }, // sub-story
    { id: 14, parentId: null }, // nothing linked
  ];
  const links = [
    { requirementId: 11, type: 'ui' as const, testId: 1 },
    { requirementId: 12, type: 'ui' as const, testId: 2 },
    { requirementId: 13, type: 'api' as const, testId: 1 },
    { requirementId: 13, type: 'ui' as const, testId: 1 }, // the same test through two stories
    { requirementId: 12, type: 'ui' as const, testId: 99 }, // a test the requester cannot see
  ];

  it('counts its stories\' tests, each once, and the hidden ones apart', () => {
    const coverage = computeCoverage(nodes, links, visible);
    expect(coverage.get(10)).toMatchObject({ state: 'failing', passed: 2, failed: 1, notRun: 0, hidden: 1 });
    expect(coverage.get(10)!.tests.map((t) => t.name)).toEqual(['Checkout', 'Login', 'Orders API']);
    expect(coverage.get(11)).toMatchObject({ state: 'passing', passed: 2 });
    expect(coverage.get(12)).toMatchObject({ state: 'failing', hidden: 1 });
    expect(coverage.get(14)).toMatchObject({ state: 'uncovered', tests: [] });
    expect(coverageSummary(Array.from(coverage.values()))).toEqual({ total: 5, passing: 2, failing: 2, notRun: 0, uncovered: 1, coveredPercent: 80 });
  });

  it('stops at a loop in the parent chain', () => {
    const coverage = computeCoverage([{ id: 1, parentId: 2 }, { id: 2, parentId: 1 }], [{ requirementId: 1, type: 'ui', testId: 1 }], visible);
    expect(coverage.get(2)!.tests).toHaveLength(1);
  });
});

describe('the traceability matrix', () => {
  it('has a line per covering test, a line for an uncovered requirement, and no formulas', () => {
    const base = { description: null, trackerId: null, url: null, externalType: null, syncedAt: null, createdBy: null, organizationId: 1, createdAt: new Date(), updatedAt: new Date() };
    const rows = [
      {
        ...base, id: 1, key: 'SHOP-1', title: 'Checkout, "one page"', kind: 'epic', parentId: null, externalStatus: 'In Progress', directTests: 0,
        coverage: { state: 'failing', tests: [test('ui', 2, 'failed', 'Checkout'), test('api', 1, 'passed', '=HYPERLINK("x")')], passed: 1, failed: 1, notRun: 0, hidden: 0 },
      },
      {
        ...base, id: 2, key: 'SHOP-2', title: 'Refunds', kind: 'story', parentId: 1, externalStatus: null, directTests: 0,
        coverage: { state: 'uncovered', tests: [], passed: 0, failed: 0, notRun: 0, hidden: 2 },
      },
    ] as RequirementRow[];
    const lines = matrixCsv(rows).trim().split('\r\n');
    expect(lines[0]).toBe('Requirement,Title,Kind,Parent,Tracker status,Coverage,Test,Test type,Last outcome,Last run,Plan,Run id,Hidden tests');
    expect(lines[1]).toBe('SHOP-1,"Checkout, ""one page""",epic,,In Progress,failing,Checkout,web,failed,2026-09-30T02:00:00.000Z,Nightly,run-2,0');
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")",api,passed`);
    expect(lines[3]).toBe('SHOP-2,Refunds,story,SHOP-1,,uncovered,,,,,,,2');
  });
});
