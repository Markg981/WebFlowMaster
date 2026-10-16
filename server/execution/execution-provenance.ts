import { createHash } from 'node:crypto';
import {
  SUPPORTED_EXECUTION_PROTOCOLS,
  type ExecutionProvenance,
  type ReproducibilitySummary,
} from '@shared/execution-provenance';
import { readExecutionSnapshot, type ExecutionSnapshot } from './execution-snapshot';
import type { FrozenTestDefinitions } from './execution-definitions';
import { readBundle, type FrozenDependencies } from '../authoring/executable-definition';

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sorted(entry)]),
    );
  return value;
}

export function inputFingerprint(value: unknown): string {
  // Normalize Date, undefined and JSONB's key ordering before hashing.
  return createHash('sha256')
    .update(JSON.stringify(sorted(JSON.parse(JSON.stringify(value)))))
    .digest('hex');
}

export function buildExecutionProvenance(snapshot: ExecutionSnapshot): ExecutionProvenance {
  const { provenance: _provenance, replayOf: _replay, capturedAt: _captured, ...inputs } = snapshot;
  return {
    version: 1,
    capturedAt: snapshot.capturedAt,
    inputFingerprint: inputFingerprint(inputs),
    datasetsFingerprint: inputFingerprint(snapshot.datasets ?? null),
    datasets: (snapshot.datasets?.tests ?? []).map((row) => ({
      testId: row.testId,
      rowCount: Array.isArray(row.dataset) ? row.dataset.length : 0,
      fingerprint: inputFingerprint(row.dataset),
      ...(row.source ? { source: row.source } : {}),
      unavailable: !!row.error,
    })),
    definitions: [
      ...(snapshot.definitions?.ui ?? []).map((row) => ({
        type: 'ui' as const,
        id: row.id,
        name: row.definition.name,
        version: row.version,
        source: row.source,
        fingerprint: inputFingerprint(row.definition),
        // Only when frozen: a run queued before R1 keeps the provenance it was fingerprinted with.
        ...(row.dependencies ? { dependencies: dependencySummary(row.dependencies) } : {}),
      })),
      ...(snapshot.definitions?.api ?? []).map((row) => ({
        type: 'api' as const,
        id: row.id,
        name: row.definition.name,
        version: row.version,
        source: row.source,
        fingerprint: inputFingerprint(row.definition),
      })),
      ...(snapshot.mobileDefinitions ?? []).map((row) => ({
        type: 'mobile' as const,
        id: row.id,
        name: row.definition.name,
        version: row.version ?? null,
        source:
          row.version && row.definition.publishedVersion === row.version
            ? ('published' as const)
            : ('working' as const),
        fingerprint: inputFingerprint(row.definition),
      })),
    ],
    liveDependencies: [
      'environment variables and secrets',
      'grids, agents and browser binaries',
      'BDD execution profiles',
      'quarantine and review policy',
      'notification and issue integrations',
      'external application state',
    ],
  };
}

/** Counts and a fingerprint: report readers never see a group's steps or an action's script. */
function dependencySummary(frozen: FrozenDependencies) {
  if ('error' in frozen)
    return {
      origin: 'unusable' as const,
      fingerprint: null,
      groups: 0,
      elements: 0,
      customActions: 0,
      missing: 0,
    };
  const { bundle } = frozen;
  return {
    origin: frozen.origin,
    fingerprint: bundle.fingerprint,
    groups: bundle.groups.length,
    elements: bundle.elements.length,
    customActions: bundle.customActions.length,
    missing:
      bundle.missing.groups.length +
      bundle.missing.elements.length +
      bundle.missing.customActions.length,
  };
}

/**
 * Whether every UI definition of a format-2 run carries usable or explicitly unusable
 * dependencies. A bundle edited after enqueue no longer matches its own fingerprint.
 */
function dependenciesIntact(definitions: FrozenTestDefinitions): boolean {
  if (definitions.version === 1) return true;
  return definitions.ui.every((row) => {
    const frozen = row.dependencies;
    if (!frozen) return false;
    if ('error' in frozen) return typeof frozen.error === 'string';
    return readBundle(frozen.bundle).kind === 'ok';
  });
}

/** No definitions, dataset values or credentials are exposed to report readers. */
export function reproducibilitySummary(value: unknown): ReproducibilitySummary {
  const snapshot = readExecutionSnapshot(value);
  if (
    snapshot?.definitions &&
    !(SUPPORTED_EXECUTION_PROTOCOLS.definitions as readonly number[]).includes(
      snapshot.definitions.version,
    )
  )
    return {
      available: false,
      reason: `The queued definitions use format ${JSON.stringify(snapshot.definitions.version)}, which this server does not support.`,
    };
  if (
    !snapshot?.definitions ||
    !snapshot.datasets ||
    !snapshot.mobileDefinitions ||
    !snapshot.provenance
  )
    return { available: false, reason: 'This historical run does not retain all queued inputs.' };
  if (!dependenciesIntact(snapshot.definitions))
    return { available: false, reason: 'The queued test dependencies are incomplete or altered.' };
  try {
    const expected = buildExecutionProvenance(snapshot);
    const retained = snapshot.provenance;
    if (inputFingerprint(expected) !== inputFingerprint(retained))
      return { available: false, reason: 'The retained input fingerprints do not match.' };
    const ids = (type: 'ui' | 'api' | 'mobile') =>
      new Set(expected.definitions.filter((row) => row.type === type).map((row) => row.id));
    const ui = ids('ui'),
      api = ids('api'),
      mobile = ids('mobile');
    if (
      snapshot.selectedTests.some((ref) =>
        ref.testType === 'ui'
          ? !ui.has(ref.testId!)
          : ref.testType === 'api'
            ? !api.has(ref.apiTestId!)
            : !mobile.has(ref.mobileTestId!),
      )
    )
      return { available: false, reason: 'A selected test definition was unavailable at enqueue.' };
    return {
      available: true,
      provenance: expected,
      ...(snapshot.replayOf ? { replayOf: snapshot.replayOf } : {}),
    };
  } catch {
    return { available: false, reason: 'The retained configuration is invalid.' };
  }
}

/** Execution JSON APIs must never serialize the private runner snapshot. */
export function publicExecution<T extends { configurationSnapshot: unknown }>(row: T) {
  const { configurationSnapshot, ...metadata } = row;
  return { ...metadata, reproducibility: reproducibilitySummary(configurationSnapshot) };
}
