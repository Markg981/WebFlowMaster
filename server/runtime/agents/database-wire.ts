/**
 * The values of a database session as they cross the relay between the agent and the server.
 *
 * The drivers answer with dates, binary columns and 64-bit integers, which JSON would turn into
 * strings or refuse. Each is sent tagged and rebuilt on the other side, so a fixture's output and
 * {{db.value}} read the same whether the query ran on the server or on an agent
 * (server/runtime/database-step.ts cellText).
 */

const TAG = '$wfm';

type Tagged = { [TAG]: 'date' | 'bytes' | 'bigint' | 'object'; v: unknown };

export function encodeDatabaseValue(value: unknown): unknown {
  if (typeof value === 'bigint') return { [TAG]: 'bigint', v: value.toString() };
  if (value instanceof Date)
    return { [TAG]: 'date', v: Number.isNaN(value.getTime()) ? null : value.toISOString() };
  if (value instanceof Uint8Array)
    return { [TAG]: 'bytes', v: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map(encodeDatabaseValue);
  if (value && typeof value === 'object') {
    const plain = Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, encodeDatabaseValue(v)]),
    );
    // A JSON column that happens to have the tag as a key stays what it was.
    return TAG in plain ? { [TAG]: 'object', v: plain } : plain;
  }
  return value;
}

export function decodeDatabaseValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeDatabaseValue);
  if (!value || typeof value !== 'object') return value;
  const tagged = value as Tagged;
  if (TAG in tagged && Object.keys(tagged).length === 2 && 'v' in tagged) {
    switch (tagged[TAG]) {
      case 'bigint':
        return BigInt(String(tagged.v));
      case 'date':
        return tagged.v === null ? new Date(Number.NaN) : new Date(String(tagged.v));
      case 'bytes':
        return Buffer.from(String(tagged.v), 'base64');
      case 'object':
        return Object.fromEntries(
          Object.entries(tagged.v as Record<string, unknown>).map(([key, v]) => [
            key,
            decodeDatabaseValue(v),
          ]),
        );
    }
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [key, decodeDatabaseValue(v)]),
  );
}
