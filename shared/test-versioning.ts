export type VersionedTestType = 'ui' | 'api' | 'mobile';
export const API_SNAPSHOT_FIELDS = [
  'name',
  'method',
  'url',
  'queryParams',
  'requestHeaders',
  'requestBody',
  'assertions',
  'extractions',
  'performance',
  'authType',
  'authParams',
  'bodyType',
  'bodyRawContentType',
  'bodyFormData',
  'bodyUrlEncoded',
  'bodyGraphqlQuery',
  'bodyGraphqlVariables',
  'protoDefinition',
  'module',
  'featureArea',
  'scenario',
  'component',
  'priority',
  'severity',
] as const;
export const MOBILE_SNAPSHOT_FIELDS = [
  'name',
  'platform',
  'app',
  'deviceName',
  'osVersion',
  'gridId',
  'steps',
] as const;
/** Only definition fields may be restored or overlaid onto a run. */
export function typedSnapshotOf(
  type: 'api' | 'mobile',
  test: Record<string, unknown>,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const key of type === 'api' ? API_SNAPSHOT_FIELDS : MOBILE_SNAPSHOT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(test, key)) snapshot[key] = test[key];
  }
  return snapshot;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function describeTypedChange(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>,
): string {
  if (!previous) return 'Created baseline version.';
  const changed = [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter(
    (key) => JSON.stringify(canonical(previous[key])) !== JSON.stringify(canonical(next[key])),
  );
  return changed.length ? `Changed ${changed.join(', ')}.` : '';
}
