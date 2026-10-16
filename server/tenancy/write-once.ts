/**
 * Evidence of an attempt at a unit of a run's manifest (shared/execution-identity.ts): written once.
 *
 * The report links to it as soon as its attempt is recorded, so a second write under the same key —
 * a publish that arrives late, from a worker that lost its claim and kept going — would change what
 * a link already handed out opens. Such a write is dropped, and the first file stays. Keys outside
 * the units space (a run from before the manifest, a visual baseline) keep last-write-wins.
 */
const WRITE_ONCE_KEY = /^results\/[^/]+\/[^/]+\/units\/u_[0-9a-f]{24}\/attempt_\d+\//;

export const isWriteOnceKey = (key: string): boolean =>
  WRITE_ONCE_KEY.test(key.replace(/\\/g, '/'));
