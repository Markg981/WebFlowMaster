import { v4 as uuidv4 } from 'uuid';
import type { MobileStep } from '@shared/mobile';
import type { MobileTest } from '@shared/schema';
import { parsePageSource, type InspectorNode } from '@shared/mobile-inspector';
import type { GridConfig } from './browser-grids';
import { AppiumSession, WebDriverError, type Fetch } from './appium-client';
import { mobileSessionRequest, redactGridSecret, runMobileStep } from './mobile-runner';

/**
 * The inspector: a device of a cloud grid, held open while somebody looks at the app's screens and
 * picks the elements a test's steps will name (shared/mobile-inspector.ts).
 *
 * A session costs grid minutes, so each person holds at most one — opening another closes the
 * first — and one left alone for INSPECTOR_IDLE_MS is closed here, before the grid's own idle
 * timeout would. Sessions live in this process: behind several servers the page keeps talking
 * to the one that opened its session (it answers 404 elsewhere, and the page says to reopen).
 */

export const INSPECTOR_IDLE_MS = Number(process.env.MOBILE_INSPECTOR_IDLE_MS) || 5 * 60_000;

export class InspectorError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface Held {
  id: string;
  organizationId: number;
  userId: number;
  platform: MobileTest['platform'];
  grid: GridConfig;
  session: AppiumSession;
  device: string;
  timer: ReturnType<typeof setTimeout>;
  /** One command at a time: a tap while the tree is being read would describe neither screen. */
  queue: Promise<unknown>;
}

export interface InspectorSnapshot {
  id: string;
  platform: MobileTest['platform'];
  /** The screen, base64 PNG; null when the grid would not take one. */
  screenshot: string | null;
  /** The window's size in the tree's coordinates, to lay the screenshot over it. */
  window: { width: number; height: number };
  tree: InspectorNode | null;
  /** What the grid opened, for the page to say: "Google Pixel 8 · Android 14". */
  device: string;
}

const held = new Map<string, Held>();

/** How the tests reach a stand-in hub, and how long a step looks for its element (a person is waiting). */
export const inspectorDeps: { fetch?: Fetch; elementTimeoutMs?: number } = {};

function describeDevice(test: Pick<MobileTest, 'deviceName' | 'osVersion' | 'platform'>, capabilities: Record<string, unknown>) {
  const version = String(capabilities.platformVersion ?? capabilities['appium:platformVersion'] ?? test.osVersion ?? '').trim();
  return [test.deviceName, `${test.platform === 'ios' ? 'iOS' : 'Android'}${version ? ` ${version}` : ''}`].join(' · ');
}

function touch(entry: Held) {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => void close(entry.id), INSPECTOR_IDLE_MS);
  entry.timer.unref?.();
}

async function close(id: string) {
  const entry = held.get(id);
  if (!entry) return;
  held.delete(id);
  clearTimeout(entry.timer);
  await entry.session.close();
}

async function snapshotOf(entry: Held): Promise<InspectorSnapshot> {
  const [screenshot, source, window] = await Promise.all([entry.session.screenshot(), entry.session.source(), entry.session.windowSize()]);
  return { id: entry.id, platform: entry.platform, screenshot, window, tree: parsePageSource(source), device: entry.device };
}

function explain(error: unknown, grid: GridConfig): InspectorError {
  if (error instanceof InspectorError) return error;
  const message = error instanceof WebDriverError ? `${grid.name}: ${error.message}` : String((error as Error)?.message ?? error);
  return new InspectorError(502, redactGridSecret(message, grid));
}

/** Opens a device with the app, closing the person's previous session. Takes as long as the grid does. */
export async function openInspector(
  owner: { organizationId: number; userId: number },
  grid: GridConfig,
  test: Pick<MobileTest, 'platform' | 'app' | 'deviceName' | 'osVersion' | 'name'>,
): Promise<InspectorSnapshot> {
  for (const entry of Array.from(held.values())) {
    if (entry.userId === owner.userId && entry.organizationId === owner.organizationId) await close(entry.id);
  }
  let session: AppiumSession | null = null;
  try {
    const request = mobileSessionRequest(grid, test, `WebFlowMaster · inspector`);
    session = await AppiumSession.open({ ...request, fetch: inspectorDeps.fetch });
    const entry: Held = {
      id: uuidv4(),
      ...owner,
      platform: test.platform,
      grid,
      session,
      device: describeDevice(test, session.capabilities),
      timer: setTimeout(() => undefined, 0),
      queue: Promise.resolve(),
    };
    held.set(entry.id, entry);
    touch(entry);
    return await snapshotOf(entry);
  } catch (error) {
    await session?.close();
    throw explain(error, grid);
  }
}

function own(id: string, owner: { organizationId: number; userId: number }): Held {
  const entry = held.get(id);
  // Somebody else's session is as absent as a closed one.
  if (!entry || entry.organizationId !== owner.organizationId || entry.userId !== owner.userId) {
    throw new InspectorError(404, 'The inspector session has ended. Open it again.');
  }
  return entry;
}

function serialized<T>(entry: Held, work: () => Promise<T>): Promise<T> {
  const next = entry.queue.then(work, work);
  entry.queue = next.catch(() => undefined);
  return next;
}

export async function inspectorSnapshot(id: string, owner: { organizationId: number; userId: number }): Promise<InspectorSnapshot> {
  const entry = own(id, owner);
  touch(entry);
  try {
    return await serialized(entry, () => snapshotOf(entry));
  } catch (error) {
    throw explain(error, entry.grid);
  }
}

export type InspectorAction = { kind: 'step'; step: MobileStep } | { kind: 'tapAt'; x: number; y: number };

/**
 * Does something on the device — a step as a test would, or a tap on a point of the screenshot —
 * and answers the screen after it. A step that fails says why, and the screen is still answered.
 */
export async function inspectorAct(
  id: string,
  owner: { organizationId: number; userId: number },
  action: InspectorAction,
): Promise<InspectorSnapshot & { error: string | null }> {
  const entry = own(id, owner);
  touch(entry);
  return serialized(entry, async () => {
    let failure: string | null = null;
    try {
      if (action.kind === 'tapAt') await entry.session.tapAt(action);
      // No environment here: a value with a {{variable}} is refused with the name, as in a run.
      else await runMobileStep({ session: entry.session, platform: entry.platform, vars: {}, elementTimeoutMs: inspectorDeps.elementTimeoutMs ?? 5_000 }, action.step);
    } catch (error) {
      failure = explain(error, entry.grid).message;
    }
    try {
      return { ...(await snapshotOf(entry)), error: failure };
    } catch (error) {
      throw explain(error, entry.grid);
    }
  });
}

export async function closeInspector(id: string, owner: { organizationId: number; userId: number }): Promise<void> {
  own(id, owner);
  await close(id);
}

/** For the tests, and for a server shutting down: every session closed. */
export async function closeAllInspectors(): Promise<void> {
  await Promise.all(Array.from(held.keys()).map((id) => close(id)));
}
