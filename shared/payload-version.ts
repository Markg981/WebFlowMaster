/**
 * Versioned JSON payloads for jsonb columns.
 *
 * A payload written today has to be readable after its shape changes. The payload carries
 * `schemaVersion`; reading upgrades it one version at a time to the current shape, so old rows
 * never need rewriting. Rows written before a payload was versioned have no `schemaVersion`
 * and count as version 1.
 *
 * Only for object payloads: an array cannot carry a field. Columns holding arrays, and the rest
 * of the jsonb columns, change shape through a data migration instead (see jsonb-payloads.ts).
 */

type JsonObject = Record<string, unknown>;

/** A payload written by a newer build than this one. Reading it as the old shape would lose data. */
export class NewerPayloadError extends Error {
  constructor(
    readonly payload: string,
    readonly found: number,
    readonly current: number,
  ) {
    super(
      `${payload} has schemaVersion ${found}, newer than the ${current} this build reads; upgrade this instance.`,
    );
    this.name = 'NewerPayloadError';
  }
}

export interface VersionedPayload<T> {
  readonly name: string;
  readonly version: number;
  /**
   * The stored value upgraded to the current shape, or null when it is not a payload of this
   * kind. Throws NewerPayloadError for a payload from a newer build.
   */
  read(value: unknown): T | null;
  /** What to store: the value stamped with the current version. */
  write(value: T): T & { schemaVersion: number };
}

export function versionedPayload<T>(options: {
  /** For error messages: the column, as table.column. */
  name: string;
  version: number;
  /** upgrades[n] turns a version n payload into a version n + 1 one. */
  upgrades?: Record<number, (payload: JsonObject) => JsonObject>;
  /** Checks a current-version payload (without schemaVersion); null when it is not one. */
  validate(payload: JsonObject): T | null;
}): VersionedPayload<T> {
  const { name, version, upgrades = {}, validate } = options;
  if (!Number.isInteger(version) || version < 1) throw new Error(`${name}: version must be >= 1`);
  for (let from = 1; from < version; from++)
    if (!upgrades[from]) throw new Error(`${name}: missing upgrade from version ${from}`);

  return {
    name,
    version,
    read(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const { schemaVersion = 1, ...rest } = value as JsonObject;
      if (!Number.isInteger(schemaVersion) || (schemaVersion as number) < 1) return null;
      const found = schemaVersion as number;
      if (found > version) throw new NewerPayloadError(name, found, version);
      let payload: JsonObject = rest;
      for (let from = found; from < version; from++) payload = upgrades[from](payload);
      return validate(payload);
    },
    write(value) {
      return { ...value, schemaVersion: version };
    },
  };
}
