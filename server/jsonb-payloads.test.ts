import { describe, expect, it } from 'vitest';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';
import { JSONB_PAYLOADS } from '@shared/jsonb-payloads';
import { NewerPayloadError, versionedPayload } from '@shared/payload-version';
import { failureAnalysisPayload, readFailureAnalysis } from '@shared/failure-analysis';

function jsonbColumns(): string[] {
  const columns: string[] = [];
  for (const value of Object.values(schema)) {
    if (!(value instanceof PgTable)) continue;
    const config = getTableConfig(value);
    for (const column of config.columns)
      if (column.columnType === 'PgJsonb') columns.push(`${config.name}.${column.name}`);
  }
  return columns.sort();
}

describe('jsonb payload catalog', () => {
  it('names a strategy for every jsonb column, and only for existing ones', () => {
    // A failure here means a jsonb column was added or removed: choose its strategy in
    // shared/jsonb-payloads.ts (the comment there says what each one commits you to).
    expect(Object.keys(JSONB_PAYLOADS).sort()).toEqual(jsonbColumns());
  });
});

describe('versionedPayload', () => {
  type V2 = { title: string; tags: string[] };
  const payload = versionedPayload<V2>({
    name: 'things.payload',
    version: 2,
    upgrades: { 1: ({ name, ...rest }) => ({ ...rest, title: name, tags: [] }) },
    validate: (value) => (typeof value.title === 'string' ? (value as V2) : null),
  });

  it('reads a payload written before versioning as version 1 and upgrades it', () => {
    expect(payload.read({ name: 'old' })).toEqual({ title: 'old', tags: [] });
    expect(payload.read({ schemaVersion: 1, name: 'old' })).toEqual({ title: 'old', tags: [] });
  });

  it('stamps the current version on write and reads it back unchanged', () => {
    const stored = payload.write({ title: 'new', tags: ['a'] });
    expect(stored).toEqual({ title: 'new', tags: ['a'], schemaVersion: 2 });
    expect(payload.read(JSON.parse(JSON.stringify(stored)))).toEqual({ title: 'new', tags: ['a'] });
  });

  it('refuses a payload from a newer build instead of misreading it', () => {
    expect(() => payload.read({ schemaVersion: 3, title: 'x' })).toThrow(NewerPayloadError);
  });

  it('returns null for what is not a payload', () => {
    for (const value of [null, undefined, 'x', 1, [], { schemaVersion: 0 }, { schemaVersion: 'x' }])
      expect(payload.read(value)).toBeNull();
  });

  it('refuses a definition with a gap in its upgrades', () => {
    expect(() =>
      versionedPayload({
        name: 't.c',
        version: 3,
        upgrades: { 1: (v) => v },
        validate: () => null,
      }),
    ).toThrow(/missing upgrade from version 2/);
  });
});

describe('failure analysis payload', () => {
  const analysis = {
    category: 'locator' as const,
    confidence: 'high' as const,
    summary: 'The button moved.',
    explanation: 'e',
    suggestion: 's',
    failedStep: 2,
    proposedSelector: null,
    sawScreenshot: true,
    language: 'en' as const,
    model: 'm',
    byUsername: 'u',
    at: '2026-10-11T00:00:00.000Z',
  };

  it('reads analyses stored before versioning and after', () => {
    expect(readFailureAnalysis(analysis)).toEqual(analysis);
    expect(readFailureAnalysis(failureAnalysisPayload.write(analysis))).toEqual(analysis);
  });

  it('treats an analysis from a newer instance as none', () => {
    expect(readFailureAnalysis({ ...analysis, schemaVersion: 99 })).toBeNull();
  });
});
