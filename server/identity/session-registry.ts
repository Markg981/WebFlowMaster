import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { SessionData, Store } from 'express-session';
import { sessionRedis } from '../platform/redis';

/**
 * Which sessions a person has open (audit R-5). The session store is keyed by session id only, so
 * a small index per user (a Redis set, or a Map when the store is the in-memory development one)
 * lists the ids; each session carries its own created / last-seen / device facts in `meta`.
 * No database table: sessions are not organization data, so row-level security does not apply.
 */

declare module 'express-session' {
  interface SessionData {
    meta?: { createdAt: number; lastSeenAt: number; userAgent: string; ip: string };
  }
}

const INDEX_TTL_SECONDS = 8 * 24 * 60 * 60;
const TOUCH_EVERY_MS = 5 * 60 * 1000;
const memoryIndex = new Map<number, Set<string>>();

const indexKey = (userId: number) => `wfm:usess:${userId}`;
const redisIndex = () => sessionRedis.isReady;

async function indexAdd(userId: number, sid: string): Promise<void> {
  if (redisIndex()) {
    await sessionRedis.sAdd(indexKey(userId), sid);
    await sessionRedis.expire(indexKey(userId), INDEX_TTL_SECONDS);
    return;
  }
  const set = memoryIndex.get(userId) ?? new Set<string>();
  set.add(sid);
  memoryIndex.set(userId, set);
}

async function indexRemove(userId: number, sid: string): Promise<void> {
  if (redisIndex()) await sessionRedis.sRem(indexKey(userId), sid);
  else memoryIndex.get(userId)?.delete(sid);
}

async function indexMembers(userId: number): Promise<string[]> {
  if (redisIndex()) return sessionRedis.sMembers(indexKey(userId));
  return [...(memoryIndex.get(userId) ?? [])];
}

/** The public handle of a session: the real id is the credential and never leaves the server. */
export const sessionHandle = (sid: string) =>
  createHash('sha256').update(sid).digest('hex').slice(0, 24);

/** Data-protection: an IPv4 address loses its last octet, an IPv6 one all but its first 48 bits. */
export function anonymiseIp(ip: string | undefined): string {
  if (!ip) return '';
  const v4 = ip.replace(/^::ffff:/i, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return v4.replace(/\.\d{1,3}$/, '.0');
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}::`;
  return '';
}

/** Records the device facts of a signed-in session and keeps its last-seen time roughly current. */
export function trackSession(req: Request, _res: Response, next: NextFunction) {
  const user = req.user;
  if (!user || !req.session || !req.sessionID) return next();
  const now = Date.now();
  const meta = req.session.meta;
  if (!meta) {
    req.session.meta = {
      createdAt: now,
      lastSeenAt: now,
      userAgent: String(req.get('user-agent') ?? '').slice(0, 200),
      ip: anonymiseIp(req.ip),
    };
    // Saved before it is indexed, so a listing never finds an id whose session is not stored yet.
    req.session.save((saveError) => {
      if (saveError) return next(saveError);
      indexAdd(user.id, req.sessionID).then(() => next(), next);
    });
    return;
  }
  if (now - meta.lastSeenAt > TOUCH_EVERY_MS) meta.lastSeenAt = now;
  next();
}

export interface SessionSummary {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string;
  ip: string;
}

const get = (store: Store, sid: string) =>
  new Promise<SessionData | null>((resolve, reject) =>
    store.get(sid, (e, s) => (e ? reject(e) : resolve(s ?? null))),
  );
const destroy = (store: Store, sid: string) =>
  new Promise<void>((resolve, reject) => store.destroy(sid, (e) => (e ? reject(e) : resolve())));

/** The user's live sessions; ids whose session expired or belongs to someone else are dropped. */
async function liveSessions(store: Store, userId: number) {
  const live: { sid: string; data: SessionData }[] = [];
  for (const sid of await indexMembers(userId)) {
    const data = await get(store, sid);
    const owner = (data as { passport?: { user?: { id?: number } } } | null)?.passport?.user?.id;
    if (data && owner === userId) live.push({ sid, data });
    else await indexRemove(userId, sid);
  }
  return live;
}

export async function listSessions(
  store: Store,
  userId: number,
  currentSid: string,
): Promise<SessionSummary[]> {
  const live = await liveSessions(store, userId);
  return live
    .map(({ sid, data }) => ({
      id: sessionHandle(sid),
      current: sid === currentSid,
      createdAt: new Date(data.meta?.createdAt ?? 0).toISOString(),
      lastSeenAt: new Date(data.meta?.lastSeenAt ?? 0).toISOString(),
      userAgent: data.meta?.userAgent ?? '',
      ip: data.meta?.ip ?? '',
    }))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

/** Ends one of the user's sessions by handle; false when it is not theirs (or the current one). */
export async function revokeSession(
  store: Store,
  userId: number,
  currentSid: string,
  handle: string,
): Promise<boolean> {
  const hit = (await liveSessions(store, userId)).find(
    ({ sid }) => sid !== currentSid && sessionHandle(sid) === handle,
  );
  if (!hit) return false;
  await destroy(store, hit.sid);
  await indexRemove(userId, hit.sid);
  return true;
}

/** Ends every session of the user except the current one; returns how many. */
export async function revokeOtherSessions(
  store: Store,
  userId: number,
  currentSid: string,
): Promise<number> {
  const others = (await liveSessions(store, userId)).filter(({ sid }) => sid !== currentSid);
  for (const { sid } of others) {
    await destroy(store, sid);
    await indexRemove(userId, sid);
  }
  return others.length;
}
