import { describe, it, expect } from 'vitest';
import { buildJUnitXml, escapeXml, verdictFor, type JUnitResultRow } from './junit';

/**
 * The run in the one format every CI already reads. A pipeline could previously learn only
 * that something failed, never which test or why — that stayed behind a login.
 */

const row = (overrides: Partial<JUnitResultRow> = {}): JUnitResultRow => ({
  testName: 'Login works',
  status: 'Passed',
  browser: 'chromium',
  durationMs: 1234,
  module: 'Auth',
  component: 'Login',
  ...overrides,
});

describe('verdictFor', () => {
  it('keeps failure and error apart, which is the distinction CI dashboards draw', () => {
    expect(verdictFor('Passed')).toBe('passed');
    expect(verdictFor('Failed')).toBe('failure');
    expect(verdictFor('Error')).toBe('error');
    expect(verdictFor('Skipped')).toBe('skipped');
    expect(verdictFor('something new')).toBe('error');
  });
});

describe('escapeXml', () => {
  it('escapes the five characters that would end the document early', () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe('a &amp; b &lt; c &gt; d &quot; e &apos; f');
  });

  it('removes control characters, which XML cannot carry at all', () => {
    expect(escapeXml('before\u0000\u0008after')).toBe('beforeafter');
  });

  it('survives null and undefined', () => {
    expect(escapeXml(null)).toBe('');
    expect(escapeXml(undefined)).toBe('');
  });
});

describe('buildJUnitXml', () => {
  it('counts the run, and groups the results by browser', () => {
    const xml = buildJUnitXml({
      planName: 'Nightly',
      executionId: 'exec-1',
      results: [
        row({ testName: 'A', browser: 'chromium', status: 'Passed' }),
        row({ testName: 'B', browser: 'chromium', status: 'Failed', reasonForFailure: 'Element not found' }),
        row({ testName: 'A', browser: 'firefox', status: 'Passed' }),
        row({ testName: 'B', browser: 'firefox', status: 'Error', reasonForFailure: 'Precondition failed' }),
      ],
    });

    expect(xml).toContain('<testsuites name="Nightly" tests="4" failures="1" errors="1" skipped="0"');
    expect(xml).toContain('<testsuite name="chromium" tests="2" failures="1" errors="0"');
    expect(xml).toContain('<testsuite name="firefox" tests="2" failures="0" errors="1"');
    expect(xml).toContain('<failure message="Element not found"');
    expect(xml).toContain('<error message="Precondition failed"');
  });

  it('reports durations in seconds, as JUnit counts them', () => {
    const xml = buildJUnitXml({ planName: 'P', executionId: 'e', results: [row({ durationMs: 1500 })] });

    expect(xml).toContain('time="1.500"');
  });

  it("files a test under the plan's own taxonomy, which is what CI groups by", () => {
    const xml = buildJUnitXml({ planName: 'P', executionId: 'e', results: [row()] });

    expect(xml).toContain('classname="Auth.Login"');
  });

  it('still produces a valid classname for a test with no module or component', () => {
    const xml = buildJUnitXml({
      planName: 'P',
      executionId: 'e',
      results: [row({ module: null, component: null })],
    });

    expect(xml).toContain('classname="webflowmaster"');
  });

  it('puts a run with no browser recorded in one suite, rather than inventing a name', () => {
    const xml = buildJUnitXml({ planName: 'P', executionId: 'e', results: [row({ browser: null })] });

    expect(xml).toContain('<testsuite name="default"');
  });

  it('escapes a test name and a failure message that would otherwise break the file', () => {
    const xml = buildJUnitXml({
      planName: 'Plan & Co',
      executionId: 'e',
      results: [
        row({
          testName: 'Search for <script> & "quotes"',
          status: 'Failed',
          reasonForFailure: 'Expected <b>1</b> & got 2',
        }),
      ],
    });

    expect(xml).toContain('name="Search for &lt;script&gt; &amp; &quot;quotes&quot;"');
    expect(xml).toContain('Expected &lt;b&gt;1&lt;/b&gt; &amp; got 2');
    expect(xml).not.toMatch(/<script>/);
  });

  it('marks a skipped test as skipped rather than as a pass', () => {
    const xml = buildJUnitXml({ planName: 'P', executionId: 'e', results: [row({ status: 'Skipped' })] });

    expect(xml).toContain('<skipped />');
    expect(xml).toContain('skipped="1"');
  });

  it('always says something in a failure, even when the run recorded no reason', () => {
    const xml = buildJUnitXml({
      planName: 'P',
      executionId: 'e',
      results: [row({ status: 'Failed', reasonForFailure: null })],
    });

    expect(xml).toContain('message="Test failed"');
  });

  it('produces a well-formed document for a run with no results at all', () => {
    const xml = buildJUnitXml({ planName: 'Empty', executionId: 'e', results: [] });

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('tests="0"');
    expect(xml.trim().endsWith('</testsuites>')).toBe(true);
  });

  it('opens and closes every element it writes', () => {
    const xml = buildJUnitXml({
      planName: 'P',
      executionId: 'e',
      results: [row({ status: 'Failed', reasonForFailure: 'boom' }), row({ status: 'Passed' })],
    });

    expect((xml.match(/<testsuite /g) ?? []).length).toBe((xml.match(/<\/testsuite>/g) ?? []).length);
    expect((xml.match(/<testcase /g) ?? []).length).toBe(
      (xml.match(/<\/testcase>/g) ?? []).length + (xml.match(/\/>/g) ?? []).length,
    );
  });
});
