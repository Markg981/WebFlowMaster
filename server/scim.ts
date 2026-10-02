import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import {
  AUDIT_ACTIONS,
  auditLog,
  organizationSso,
  scimGroupMembers,
  scimGroups,
  scimUsers,
  ssoDomains,
  users,
  type AuditAction,
} from '@shared/schema';
import { roleFromGroups, type RoleMapping } from '@shared/sso-roles';
import { privilegedDb } from './db';
import { hashesMatch } from './api-keys';
import { sqlState } from './db-errors';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';
import { transferMemberContent } from './member-removal';
import type { AuditActor } from './audit';

/**
 * Provisioning with SCIM 2.0 (RFC 7643, RFC 7644): the organization's identity provider creates,
 * changes, deactivates and removes accounts, and pushes its groups, as they change there — not at
 * the person's next sign-in, which is all single sign-on alone can do (server/sso.ts).
 *
 * The provider authenticates with a bearer token an owner issues under Settings → Single sign-on;
 * the token names the organization. What it may do:
 *
 * - Users. A user is a person of the organization, its SCIM id the account's id and its userName
 *   the username, which must be an address in the organization's single sign-on domains: the
 *   account signs in through the provider, which links it by that address on the first sign-in.
 *   An account is created with the default role of single sign-on; `active: false` disables it —
 *   it can no longer sign in, its sessions end at their next request and its API keys stop
 *   working — and `active: true` gives it back as it was. Deleting removes the member as an owner
 *   would, handing what they made to the longest-standing owner. Members who were already here are
 *   listed too, so a provider matching by userName adopts them instead of creating duplicates.
 * - Groups. The provider's groups and who is in them. A person's role follows the role mappings
 *   of single sign-on (shared/sso-roles.ts) over their groups' names and external ids (Entra ID's
 *   object ids) as soon as a membership changes, exactly as it would at sign-in: the highest
 *   mapped role; nothing mapped, the role stays.
 *
 * The organization's last active owner is never deactivated, demoted or removed this way: a
 * provider misconfigured must not lock everyone out.
 *
 * Everything runs on the privileged handle, like server/sso.ts, and names the organization in
 * every statement; removing a member is the one exception, run as the organization like the owner's
 * own removal (server/routes/organization.routes.ts), since it hands the member's rows on.
 * Audit entries name the actor "SCIM".
 */

/** Where the API is mounted (server/routes/scim.routes.ts). */
export const SCIM_BASE_PATH = '/api/scim/v2';
export const SCIM_TOKEN_PREFIX = 'wfmscim';
/** Enough of the token to recognise it in the settings, far too little to use. */
const VISIBLE_PREFIX_LENGTH = 16;
/** `last used` is for "is the provider still talking to us?", not to the second. */
const LAST_USED_WRITE_INTERVAL_MS = 60_000;
const SCIM_ACTOR = 'SCIM';

export const SCHEMAS = {
  user: 'urn:ietf:params:scim:schemas:core:2.0:User',
  group: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  list: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  patch: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  error: 'urn:ietf:params:scim:api:messages:2.0:Error',
} as const;

/** The most resources one page lists. */
export const MAX_PAGE = 200;

export type ScimType = 'invalidFilter' | 'invalidValue' | 'invalidPath' | 'invalidSyntax' | 'uniqueness' | 'mutability' | 'noTarget';

/** An answer in SCIM's own error format (RFC 7644 §3.12). */
export class ScimError extends Error {
  constructor(readonly status: number, readonly detail: string, readonly scimType?: ScimType) {
    super(detail);
  }
}

/** What every operation needs: whose provider is calling, how to reach this API, from where. */
export interface ScimContext {
  organizationId: number;
  /** `https://…/api/scim/v2`, for meta.location. */
  baseUrl: string;
  ipAddress: string | null;
}

type Tx = Parameters<Parameters<typeof privilegedDb.transaction>[0]>[0];
type Role = 'viewer' | 'editor' | 'owner';

async function audit(
  tx: Pick<Tx, 'insert'>,
  context: ScimContext,
  action: AuditAction,
  targetType: string,
  targetId: string | number,
  metadata?: Record<string, unknown>,
) {
  await tx.insert(auditLog).values({
    organizationId: context.organizationId,
    actorUserId: null,
    actorUsername: SCIM_ACTOR,
    ipAddress: context.ipAddress,
    action,
    targetType,
    targetId: String(targetId),
    metadata: metadata ?? null,
  });
}

async function ownerAudit(tx: Tx, organizationId: number, actor: AuditActor, action: AuditAction, metadata?: Record<string, unknown>) {
  await tx.insert(auditLog).values({
    organizationId,
    actorUserId: actor.id,
    actorUsername: actor.username,
    apiKeyId: actor.apiKeyId ?? null,
    ipAddress: actor.ipAddress ?? null,
    action,
    targetType: 'organization',
    targetId: String(organizationId),
    metadata: metadata ?? null,
  });
}

// ─── The token ──────────────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface ScimTokenStatus {
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/**
 * A new token for the organization's provider, replacing the one it had. Returned once; only its
 * hash is kept. Null when single sign-on is not set up: provisioning creates accounts that sign in
 * through it.
 */
export async function issueScimToken(organizationId: number, actor: AuditActor): Promise<{ token: string; status: ScimTokenStatus } | null> {
  const token = `${SCIM_TOKEN_PREFIX}_${randomBytes(32).toString('base64url')}`;
  const status: ScimTokenStatus = { prefix: token.slice(0, VISIBLE_PREFIX_LENGTH), createdAt: new Date(), lastUsedAt: null };
  const issued = await privilegedDb.transaction(async (tx) => {
    const [row] = await tx
      .update(organizationSso)
      .set({ scimTokenHash: hashToken(token), scimTokenPrefix: status.prefix, scimTokenCreatedAt: status.createdAt, scimTokenLastUsedAt: null })
      .where(eq(organizationSso.organizationId, organizationId))
      // No argument: the builder's overloads collapse across the two drivers' union (see organization.routes.ts).
      .returning();
    if (!row) return false;
    await ownerAudit(tx, organizationId, actor, AUDIT_ACTIONS.SCIM_TOKEN_ISSUED, { prefix: status.prefix });
    return true;
  });
  return issued ? { token, status } : null;
}

/** Ends provisioning: the provider's next request is refused. False when there was no token. */
export async function revokeScimToken(organizationId: number, actor: AuditActor): Promise<boolean> {
  return privilegedDb.transaction(async (tx) => {
    const [row] = await tx
      .select({ prefix: organizationSso.scimTokenPrefix })
      .from(organizationSso)
      .where(eq(organizationSso.organizationId, organizationId));
    if (!row?.prefix) return false;
    await tx
      .update(organizationSso)
      .set({ scimTokenHash: null, scimTokenPrefix: null, scimTokenCreatedAt: null, scimTokenLastUsedAt: null })
      .where(eq(organizationSso.organizationId, organizationId));
    await ownerAudit(tx, organizationId, actor, AUDIT_ACTIONS.SCIM_TOKEN_REVOKED, { prefix: row.prefix });
    return true;
  });
}

/** The token a request carries: `Authorization: Bearer wfmscim_…`, nothing else. */
export function scimTokenFromHeader(authorization: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization?.trim() ?? '');
  return match && match[1].startsWith(`${SCIM_TOKEN_PREFIX}_`) ? match[1] : null;
}

const recentlyUsed = new Map<number, number>();

/** The organization whose provider holds this token, or null. */
export async function organizationForScimToken(token: string): Promise<number | null> {
  const hashed = hashToken(token);
  const [row] = await privilegedDb
    .select({ organizationId: organizationSso.organizationId, hash: organizationSso.scimTokenHash })
    .from(organizationSso)
    .where(eq(organizationSso.scimTokenHash, hashed))
    .limit(1);
  if (!row?.hash || !hashesMatch(row.hash, hashed)) return null;
  const now = Date.now();
  const last = recentlyUsed.get(row.organizationId);
  if (last === undefined || now - last >= LAST_USED_WRITE_INTERVAL_MS) {
    recentlyUsed.set(row.organizationId, now);
    await privilegedDb.update(organizationSso).set({ scimTokenLastUsedAt: new Date(now) }).where(eq(organizationSso.organizationId, row.organizationId));
  }
  return row.organizationId;
}

/** Test seam: the throttle is process-wide state. */
export function resetScimUsageThrottle(): void {
  recentlyUsed.clear();
}

// ─── Filters and paging ─────────────────────────────────────────────────────────

/**
 * The filters providers send: one attribute, `eq`, one quoted value (RFC 7644 §3.4.2.2). Entra ID
 * and Okta ask `userName eq "…"`, `externalId eq "…"` and `displayName eq "…"`, and nothing more
 * elaborate; anything else is refused as an invalid filter rather than answered wrongly.
 */
export function parseFilter(filter: string | undefined, attributes: readonly string[]): { attribute: string; value: string } | null {
  if (filter === undefined || filter.trim() === '') return null;
  const match = /^\s*([A-Za-z][\w.:-]*)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
  const attribute = match ? attributes.find((a) => a.toLowerCase() === match[1].toLowerCase()) : undefined;
  if (!match || !attribute) {
    throw new ScimError(400, `Only "<attribute> eq \\"value\\"" is supported, on ${attributes.join(', ')}.`, 'invalidFilter');
  }
  return { attribute, value: match[2].replace(/\\(.)/g, '$1') };
}

export function paging(query: { startIndex?: unknown; count?: unknown }): { startIndex: number; count: number } {
  const startIndex = Math.max(1, Number.parseInt(String(query.startIndex ?? '1'), 10) || 1);
  const asked = Number.parseInt(String(query.count ?? MAX_PAGE), 10);
  const count = Math.min(MAX_PAGE, Math.max(0, Number.isNaN(asked) ? MAX_PAGE : asked));
  return { startIndex, count };
}

function listResponse(resources: unknown[], total: number, startIndex: number) {
  return { schemas: [SCHEMAS.list], totalResults: total, startIndex, itemsPerPage: resources.length, Resources: resources };
}

/** `true`, `"True"`: Entra ID sends booleans as strings in PATCH. */
function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && /^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase() === 'true';
  return undefined;
}

function asOptionalString(value: unknown, name: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new ScimError(400, `${name} must be a string.`, 'invalidValue');
  return value.trim() === '' ? null : value.trim().slice(0, 500);
}

interface PatchOperation {
  op: 'add' | 'replace' | 'remove';
  path?: string;
  value?: unknown;
}

/** The operations of a PatchOp body, with `op` in lower case ("Replace" is Entra ID's spelling). */
export function patchOperations(body: unknown): PatchOperation[] {
  const operations = (body as { Operations?: unknown })?.Operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new ScimError(400, 'A PATCH carries Operations: a list of add, replace or remove.', 'invalidSyntax');
  }
  return operations.map((raw) => {
    const op = typeof raw?.op === 'string' ? raw.op.toLowerCase() : '';
    if (op !== 'add' && op !== 'replace' && op !== 'remove') throw new ScimError(400, `Unknown operation "${raw?.op}".`, 'invalidSyntax');
    const path = typeof raw.path === 'string' && raw.path.trim() !== '' ? raw.path.trim() : undefined;
    return { op, path, value: raw.value };
  });
}

// ─── Users ──────────────────────────────────────────────────────────────────────

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const userColumns = {
  id: users.id,
  username: users.username,
  role: users.role,
  disabledAt: users.disabledAt,
  createdAt: users.createdAt,
  externalId: scimUsers.externalId,
  updatedAt: scimUsers.updatedAt,
};
type UserRow = { id: number; username: string; role: string; disabledAt: Date | null; createdAt: Date; externalId: string | null; updatedAt: Date | null };

function personOf(organizationId: number): SQL {
  return and(eq(users.organizationId, organizationId), eq(users.kind, 'person'))!;
}

async function groupsOfUsers(organizationId: number, userIds: number[]): Promise<Map<number, Array<{ value: string; display: string }>>> {
  const map = new Map<number, Array<{ value: string; display: string }>>();
  if (userIds.length === 0) return map;
  const rows = await privilegedDb
    .select({ userId: scimGroupMembers.userId, id: scimGroups.id, displayName: scimGroups.displayName })
    .from(scimGroupMembers)
    .innerJoin(scimGroups, eq(scimGroups.id, scimGroupMembers.groupId))
    .where(and(eq(scimGroups.organizationId, organizationId), inArray(scimGroupMembers.userId, userIds)))
    .orderBy(asc(scimGroups.displayName));
  for (const row of rows) {
    const list = map.get(row.userId) ?? [];
    list.push({ value: row.id, display: row.displayName });
    map.set(row.userId, list);
  }
  return map;
}

function toScimUser(context: ScimContext, row: UserRow, groups: Array<{ value: string; display: string }>) {
  return {
    schemas: [SCHEMAS.user],
    id: String(row.id),
    ...(row.externalId ? { externalId: row.externalId } : {}),
    userName: row.username,
    active: row.disabledAt === null,
    emails: EMAIL.test(row.username) ? [{ value: row.username, type: 'work', primary: true }] : [],
    // Read-only here: memberships are changed through the groups.
    groups: groups.map((g) => ({ ...g, $ref: `${context.baseUrl}/Groups/${g.value}` })),
    // Not a SCIM attribute of its own: what the mappings made of the groups, for whoever reads it.
    'urn:ietf:params:scim:schemas:extension:webflowmaster:2.0:User': { role: row.role },
    meta: {
      resourceType: 'User',
      created: row.createdAt.toISOString(),
      lastModified: (row.updatedAt ?? row.createdAt).toISOString(),
      location: `${context.baseUrl}/Users/${row.id}`,
    },
  };
}

function userId(id: string): number {
  const n = Number(id);
  if (!/^\d{1,10}$/.test(id) || !Number.isSafeInteger(n)) throw new ScimError(404, `No user ${id}.`);
  return n;
}

async function readUser(context: ScimContext, id: number) {
  const [row] = await privilegedDb
    .select(userColumns)
    .from(users)
    .leftJoin(scimUsers, eq(scimUsers.userId, users.id))
    .where(and(eq(users.id, id), personOf(context.organizationId)));
  if (!row) throw new ScimError(404, `No user ${id}.`);
  return toScimUser(context, row, (await groupsOfUsers(context.organizationId, [id])).get(id) ?? []);
}

export async function getUser(context: ScimContext, id: string) {
  return readUser(context, userId(id));
}

export async function listUsers(context: ScimContext, query: { filter?: string; startIndex?: unknown; count?: unknown }) {
  const filter = parseFilter(query.filter, ['userName', 'externalId', 'id', 'emails.value', 'emails']);
  const { startIndex, count } = paging(query);
  const conditions = [personOf(context.organizationId)];
  if (filter) {
    if (filter.attribute === 'externalId') conditions.push(eq(scimUsers.externalId, filter.value));
    else if (filter.attribute === 'id') conditions.push(/^\d{1,10}$/.test(filter.value) ? eq(users.id, Number(filter.value)) : sql`false`);
    // userName and the address are one value here, compared without case like the sign-in does.
    else conditions.push(sql`lower(${users.username}) = ${filter.value.trim().toLowerCase()}`);
  }
  const where = and(...conditions);
  const [{ total }] = await privilegedDb
    .select({ total: sql<number>`count(*)::int` })
    .from(users)
    .leftJoin(scimUsers, eq(scimUsers.userId, users.id))
    .where(where);
  const rows = count === 0
    ? []
    : await privilegedDb
        .select(userColumns)
        .from(users)
        .leftJoin(scimUsers, eq(scimUsers.userId, users.id))
        .where(where)
        .orderBy(asc(users.id))
        .offset(startIndex - 1)
        .limit(count);
  const groups = await groupsOfUsers(context.organizationId, rows.map((r) => r.id));
  return listResponse(rows.map((r) => toScimUser(context, r, groups.get(r.id) ?? [])), total, startIndex);
}

interface UserChanges {
  userName?: string;
  active?: boolean;
  /** null clears it. */
  externalId?: string | null;
}

/** The attributes of a User body this API keeps; everything else (name, title, phone…) is accepted and ignored. */
function userChangesFrom(body: Record<string, unknown>): UserChanges {
  const changes: UserChanges = {};
  for (const [key, value] of Object.entries(body ?? {})) {
    switch (key.toLowerCase()) {
      case 'username':
        if (typeof value !== 'string') throw new ScimError(400, 'userName must be a string.', 'invalidValue');
        changes.userName = value;
        break;
      case 'active': {
        const active = asBoolean(value);
        if (active === undefined) throw new ScimError(400, 'active must be true or false.', 'invalidValue');
        changes.active = active;
        break;
      }
      case 'externalid':
        changes.externalId = asOptionalString(value, 'externalId');
        break;
    }
  }
  return changes;
}

/** A userName this organization can provision: an address in one of its single sign-on domains. */
async function checkedUserName(tx: Tx, organizationId: number, userName: string): Promise<string> {
  const address = userName.trim().toLowerCase();
  if (!EMAIL.test(address) || address.length > 320) {
    throw new ScimError(400, 'userName must be the person\'s e-mail address: they sign in through the identity provider with it.', 'invalidValue');
  }
  const domains = await tx.select({ domain: ssoDomains.domain }).from(ssoDomains).where(eq(ssoDomains.organizationId, organizationId));
  if (!domains.some((d) => d.domain === address.split('@')[1])) {
    throw new ScimError(
      400,
      `${address} is not in the organization's single sign-on domains (${domains.map((d) => d.domain).join(', ') || 'none'}): add the domain under Settings → Single sign-on.`,
      'invalidValue',
    );
  }
  const [taken] = await tx.select({ id: users.id, organizationId: users.organizationId }).from(users).where(sql`lower(${users.username}) = ${address}`).limit(1);
  if (taken) {
    throw new ScimError(
      409,
      taken.organizationId === organizationId
        ? `${address} already has an account here (id ${taken.id}): find it with filter userName eq "${address}".`
        : `${address} has an account in another organization on this installation.`,
      'uniqueness',
    );
  }
  return address;
}

/** Whether someone other than `userId` is an active owner of the organization. */
async function anotherActiveOwner(tx: Pick<Tx, 'select'>, organizationId: number, userId: number): Promise<boolean> {
  const [{ others }] = await tx
    .select({ others: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.organizationId, organizationId), eq(users.role, 'owner'), ne(users.id, userId), isNull(users.disabledAt)));
  return others > 0;
}

/** A password nobody knows: the column requires one, and comparePasswords must find it well formed. */
function unusablePassword(): string {
  return `${randomBytes(64).toString('hex')}.${randomBytes(16).toString('hex')}`;
}

export async function createUser(context: ScimContext, body: Record<string, unknown>) {
  const changes = userChangesFrom(body);
  if (changes.userName === undefined) throw new ScimError(400, 'userName is required.', 'invalidValue');
  const { organizationId } = context;
  try {
    const id = await privilegedDb.transaction(async (tx) => {
      const [provider] = await tx.select({ defaultRole: organizationSso.defaultRole }).from(organizationSso).where(eq(organizationSso.organizationId, organizationId));
      if (!provider) throw new ScimError(400, 'Single sign-on is not set up for this organization.', 'invalidValue');
      const username = await checkedUserName(tx, organizationId, changes.userName!);
      const [user] = await tx
        .insert(users)
        .values({
          username,
          password: unusablePassword(),
          organizationId,
          role: provider.defaultRole,
          kind: 'person',
          disabledAt: changes.active === false ? new Date() : null,
        })
        .returning();
      await tx.insert(scimUsers).values({ userId: user.id, organizationId, externalId: changes.externalId ?? null });
      await audit(tx, context, AUDIT_ACTIONS.MEMBER_PROVISIONED, 'user', user.id, {
        username,
        role: provider.defaultRole,
        byScim: true,
        ...(changes.active === false ? { active: false } : {}),
      });
      // With "require a group" a new account waits, deactivated, for a mapped group to hold it.
      await followGroups(tx, context, [user.id]);
      return user.id;
    });
    return readUser(context, id);
  } catch (error) {
    // Two creations of one address at once: the unique username decides.
    if (sqlState(error) === '23505') throw new ScimError(409, `${changes.userName} already has an account.`, 'uniqueness');
    throw error;
  }
}

async function applyUserChanges(context: ScimContext, id: number, changes: UserChanges) {
  const { organizationId } = context;
  try {
    await privilegedDb.transaction(async (tx) => {
      const [user] = await tx
        .select({ id: users.id, username: users.username, role: users.role, disabledAt: users.disabledAt })
        .from(users)
        .where(and(eq(users.id, id), personOf(organizationId)));
      if (!user) throw new ScimError(404, `No user ${id}.`);
      let blockedByGroups = false;

      if (changes.userName !== undefined && changes.userName.trim().toLowerCase() !== user.username.toLowerCase()) {
        const username = await checkedUserName(tx, organizationId, changes.userName);
        await tx.update(users).set({ username }).where(eq(users.id, id));
        await audit(tx, context, AUDIT_ACTIONS.MEMBER_RENAMED, 'user', id, { from: user.username, to: username, byScim: true });
      }
      if (changes.active === false && user.disabledAt === null) {
        if (user.role === 'owner' && !(await anotherActiveOwner(tx, organizationId, id))) {
          throw new ScimError(409, 'This is the organization\'s last active owner: make someone else an owner first.', 'mutability');
        }
        await tx.update(users).set({ disabledAt: new Date() }).where(eq(users.id, id));
        await audit(tx, context, AUDIT_ACTIONS.MEMBER_DEACTIVATED, 'user', id, { username: user.username, byScim: true });
      } else if (changes.active === true && user.disabledAt !== null) {
        // The provider says active; "require a group" still refuses someone in none of the mapped
        // groups, and lets them back when they join one.
        const { mappings, gate } = await gateOf(tx, organizationId);
        if (gate && (await mappedRoleOfPerson(tx, organizationId, id, mappings)) === null) {
          blockedByGroups = true;
        } else {
          await tx.update(users).set({ disabledAt: null }).where(eq(users.id, id));
          await audit(tx, context, AUDIT_ACTIONS.MEMBER_REACTIVATED, 'user', id, { username: user.username, byScim: true });
        }
      }
      // Any change from the provider makes the account one it manages (a member who was here first is
      // adopted). Its own word on `active` decides whether the groups are why the account is off.
      const disabledByGroups = changes.active === false ? false : changes.active === true ? blockedByGroups : undefined;
      await tx
        .insert(scimUsers)
        .values({ userId: id, organizationId, externalId: changes.externalId ?? null, disabledByGroups: disabledByGroups ?? false })
        .onConflictDoUpdate({
          target: scimUsers.userId,
          set: {
            updatedAt: new Date(),
            ...(changes.externalId !== undefined ? { externalId: changes.externalId } : {}),
            ...(disabledByGroups !== undefined ? { disabledByGroups } : {}),
          },
        });
    });
  } catch (error) {
    if (sqlState(error) === '23505') throw new ScimError(409, `${changes.userName} already has an account.`, 'uniqueness');
    throw error;
  }
  return readUser(context, id);
}

/** PUT: the attributes kept here, replaced. One left out stays as it is. */
export async function replaceUser(context: ScimContext, id: string, body: Record<string, unknown>) {
  return applyUserChanges(context, userId(id), userChangesFrom(body));
}

export async function patchUser(context: ScimContext, id: string, body: unknown) {
  const changes: UserChanges = {};
  for (const operation of patchOperations(body)) {
    if (!operation.path) {
      if (operation.op === 'remove') throw new ScimError(400, 'remove needs a path.', 'noTarget');
      if (!operation.value || typeof operation.value !== 'object') throw new ScimError(400, 'Without a path the value is an object of attributes.', 'invalidValue');
      Object.assign(changes, userChangesFrom(operation.value as Record<string, unknown>));
      continue;
    }
    const path = operation.path.toLowerCase();
    if (operation.op === 'remove') {
      if (path === 'externalid') changes.externalId = null;
      else if (path === 'username' || path === 'active') throw new ScimError(400, `${operation.path} cannot be removed.`, 'mutability');
      continue;
    }
    if (path === 'username' || path === 'active' || path === 'externalid') {
      Object.assign(changes, userChangesFrom({ [path]: operation.value }));
    }
    // Other paths (name.givenName, emails[type eq "work"].value, title…) are not kept here.
  }
  return applyUserChanges(context, userId(id), changes);
}

/**
 * Removes the member, as an owner removing them would: what they made goes to the longest-standing
 * active owner (server/member-removal.ts), their own rows go with the account.
 */
export async function deleteUser(context: ScimContext, id: string) {
  const target = userId(id);
  const { organizationId } = context;
  await runWithTenant(organizationId, () =>
    withTenantTransaction(async (tx) => {
      const [user] = await tx
        .select({ id: users.id, username: users.username, role: users.role })
        .from(users)
        .where(and(eq(users.id, target), personOf(organizationId)));
      if (!user) throw new ScimError(404, `No user ${id}.`);
      const [heir] = await tx
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(and(eq(users.organizationId, organizationId), eq(users.role, 'owner'), eq(users.kind, 'person'), ne(users.id, target), isNull(users.disabledAt)))
        .orderBy(asc(users.createdAt), asc(users.id))
        .limit(1);
      if (!heir) throw new ScimError(409, 'This is the organization\'s last active owner: make someone else an owner first.', 'mutability');
      const transferred = await transferMemberContent(tx, organizationId, target, heir.id);
      // Before the delete, like the owner's removal: the entry outlives the account.
      await audit(tx, context, AUDIT_ACTIONS.MEMBER_REMOVED, 'user', target, {
        username: user.username,
        role: user.role,
        transferredTo: heir.username,
        transferred,
        byScim: true,
      });
      await tx.delete(users).where(and(eq(users.id, target), eq(users.organizationId, organizationId)));
    }),
  );
}

// ─── Groups ─────────────────────────────────────────────────────────────────────

type GroupRow = typeof scimGroups.$inferSelect;

async function membersOf(groupIds: string[]): Promise<Map<string, Array<{ value: string; display: string }>>> {
  const map = new Map<string, Array<{ value: string; display: string }>>();
  if (groupIds.length === 0) return map;
  const rows = await privilegedDb
    .select({ groupId: scimGroupMembers.groupId, userId: users.id, username: users.username })
    .from(scimGroupMembers)
    .innerJoin(users, eq(users.id, scimGroupMembers.userId))
    .where(inArray(scimGroupMembers.groupId, groupIds))
    .orderBy(asc(users.id));
  for (const row of rows) {
    const list = map.get(row.groupId) ?? [];
    list.push({ value: String(row.userId), display: row.username });
    map.set(row.groupId, list);
  }
  return map;
}

function toScimGroup(context: ScimContext, row: GroupRow, members: Array<{ value: string; display: string }> | null) {
  return {
    schemas: [SCHEMAS.group],
    id: row.id,
    displayName: row.displayName,
    ...(row.externalId ? { externalId: row.externalId } : {}),
    ...(members ? { members: members.map((m) => ({ ...m, $ref: `${context.baseUrl}/Users/${m.value}` })) } : {}),
    meta: {
      resourceType: 'Group',
      created: row.createdAt.toISOString(),
      lastModified: row.updatedAt.toISOString(),
      location: `${context.baseUrl}/Groups/${row.id}`,
    },
  };
}

/** `excludedAttributes=members`: Entra ID asks for groups without their members, which can be many. */
function withMembers(excludedAttributes: unknown): boolean {
  return !String(excludedAttributes ?? '').split(',').some((a) => a.trim().toLowerCase() === 'members');
}

async function readGroup(context: ScimContext, id: string, includeMembers = true) {
  const [row] = await privilegedDb.select().from(scimGroups).where(and(eq(scimGroups.id, id), eq(scimGroups.organizationId, context.organizationId)));
  if (!row) throw new ScimError(404, `No group ${id}.`);
  return toScimGroup(context, row, includeMembers ? (await membersOf([id])).get(id) ?? [] : null);
}

export async function getGroup(context: ScimContext, id: string, query: { excludedAttributes?: unknown } = {}) {
  return readGroup(context, id, withMembers(query.excludedAttributes));
}

export async function listGroups(context: ScimContext, query: { filter?: string; startIndex?: unknown; count?: unknown; excludedAttributes?: unknown }) {
  const filter = parseFilter(query.filter, ['displayName', 'externalId', 'id']);
  const { startIndex, count } = paging(query);
  const conditions = [eq(scimGroups.organizationId, context.organizationId)];
  if (filter?.attribute === 'displayName') conditions.push(sql`lower(${scimGroups.displayName}) = ${filter.value.toLowerCase()}`);
  else if (filter?.attribute === 'externalId') conditions.push(eq(scimGroups.externalId, filter.value));
  else if (filter?.attribute === 'id') conditions.push(eq(scimGroups.id, filter.value));
  const where = and(...conditions);
  const [{ total }] = await privilegedDb.select({ total: sql<number>`count(*)::int` }).from(scimGroups).where(where);
  const rows = count === 0
    ? []
    : await privilegedDb.select().from(scimGroups).where(where).orderBy(asc(scimGroups.displayName), asc(scimGroups.id)).offset(startIndex - 1).limit(count);
  const members = withMembers(query.excludedAttributes) ? await membersOf(rows.map((r) => r.id)) : null;
  return listResponse(rows.map((r) => toScimGroup(context, r, members ? members.get(r.id) ?? [] : null)), total, startIndex);
}

/** The user ids a members value names: `[{ value: "12" }, …]`. Each must be a person of the organization. */
async function memberIds(tx: Tx, organizationId: number, value: unknown): Promise<number[]> {
  const list = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
  const ids = list.map((m) => {
    const raw = typeof m === 'object' && m !== null ? (m as { value?: unknown }).value : m;
    const id = Number(raw);
    if (!/^\d{1,10}$/.test(String(raw)) || !Number.isSafeInteger(id)) throw new ScimError(400, `Not a member: ${JSON.stringify(m)}.`, 'invalidValue');
    return id;
  });
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const found = await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, unique), personOf(organizationId)));
  const missing = unique.filter((id) => !found.some((f) => f.id === id));
  if (missing.length > 0) throw new ScimError(400, `No user ${missing.join(', ')} in this organization: provision the user first.`, 'invalidValue');
  return unique;
}

function checkedDisplayName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > 256) {
    throw new ScimError(400, 'displayName is required, up to 256 characters.', 'invalidValue');
  }
  return value.trim();
}

/** The organization's mappings, whether it refuses people in none of them, and whether its provider pushes groups at all. */
async function gateOf(tx: Pick<Tx, 'select'>, organizationId: number) {
  const [provider] = await tx
    .select({ mappings: organizationSso.roleMappings, requireGroup: organizationSso.requireGroup })
    .from(organizationSso)
    .where(eq(organizationSso.organizationId, organizationId));
  const mappings = provider?.mappings ?? [];
  const [pushed] = await tx.select({ id: scimGroups.id }).from(scimGroups).where(eq(scimGroups.organizationId, organizationId)).limit(1);
  // The gate needs groups to judge by: a provider that provisions people but pushes no groups would
  // otherwise have everyone it creates refused.
  return { mappings, gate: Boolean(provider?.requireGroup) && mappings.length > 0 && pushed !== undefined };
}

/** The role this person's pushed groups map to, or null when none of them is mapped. */
async function mappedRoleOfPerson(tx: Pick<Tx, 'select'>, organizationId: number, userId: number, mappings: RoleMapping[]) {
  const held = await tx
    .select({ name: scimGroups.displayName, externalId: scimGroups.externalId })
    .from(scimGroupMembers)
    .innerJoin(scimGroups, eq(scimGroups.id, scimGroupMembers.groupId))
    .where(and(eq(scimGroupMembers.userId, userId), eq(scimGroups.organizationId, organizationId)));
  return roleFromGroups(held.flatMap((g) => (g.externalId ? [g.name, g.externalId] : [g.name])), mappings);
}

/**
 * What each of these people's groups now say, applied:
 *
 * - the role: the highest role the organization's mappings give any of their groups' names or
 *   external ids. Nothing mapped, the role stays, as at sign-in; the last active owner is never
 *   demoted.
 * - with "refuse whoever is in none of these groups", whether they may be here at all: an account
 *   the provider manages, in none of the mapped groups, is deactivated at once — its sessions end,
 *   as if the provider had sent `active: false` — and comes back when it joins one again. Only an
 *   account the groups deactivated comes back this way; one the provider deactivated stays so until
 *   it says otherwise. The last active owner is never deactivated.
 */
async function followGroups(tx: Tx, context: ScimContext, userIds: number[]): Promise<void> {
  if (userIds.length === 0) return;
  const { mappings, gate } = await gateOf(tx, context.organizationId);
  if (mappings.length === 0) return;
  const people = await tx
    .select({ id: users.id, username: users.username, role: users.role, disabledAt: users.disabledAt, managed: scimUsers.userId, disabledByGroups: scimUsers.disabledByGroups })
    .from(users)
    .leftJoin(scimUsers, eq(scimUsers.userId, users.id))
    .where(and(inArray(users.id, [...new Set(userIds)]), personOf(context.organizationId)))
    .orderBy(asc(users.id));
  for (const person of people) {
    const mapped = await mappedRoleOfPerson(tx, context.organizationId, person.id, mappings);

    if (mapped === null) {
      if (gate && person.managed !== null && person.disabledAt === null) {
        if (person.role === 'owner' && !(await anotherActiveOwner(tx, context.organizationId, person.id))) continue;
        await tx.update(users).set({ disabledAt: new Date() }).where(eq(users.id, person.id));
        await tx.update(scimUsers).set({ disabledByGroups: true, updatedAt: new Date() }).where(eq(scimUsers.userId, person.id));
        await audit(tx, context, AUDIT_ACTIONS.MEMBER_DEACTIVATED, 'user', person.id, { username: person.username, byScim: true, reason: 'no_group' });
      }
      continue;
    }

    if (person.disabledAt !== null && person.disabledByGroups) {
      await tx.update(users).set({ disabledAt: null }).where(eq(users.id, person.id));
      await tx.update(scimUsers).set({ disabledByGroups: false, updatedAt: new Date() }).where(eq(scimUsers.userId, person.id));
      await audit(tx, context, AUDIT_ACTIONS.MEMBER_REACTIVATED, 'user', person.id, { username: person.username, byScim: true, reason: 'group' });
    }
    if (mapped === person.role) continue;
    if (person.role === 'owner' && !(await anotherActiveOwner(tx, context.organizationId, person.id))) continue;
    await tx.update(users).set({ role: mapped satisfies Role }).where(eq(users.id, person.id));
    await audit(tx, context, AUDIT_ACTIONS.MEMBER_ROLE_CHANGED, 'user', person.id, {
      username: person.username,
      from: person.role,
      to: mapped,
      bySsoGroups: true,
      byScim: true,
    });
  }
}

/**
 * Applies the role mappings to every member of a pushed group, at once: called when an owner changes
 * the mappings, so that a new mapping does not wait for the next membership change.
 */
export async function reapplyGroupRoles(organizationId: number, ipAddress: string | null = null): Promise<void> {
  await privilegedDb.transaction(async (tx) => {
    // Every account the provider manages, in a group or not: turning "require a group" on concerns
    // the people in none of them most of all.
    const members = await tx
      .selectDistinct({ userId: scimGroupMembers.userId })
      .from(scimGroupMembers)
      .innerJoin(scimGroups, eq(scimGroups.id, scimGroupMembers.groupId))
      .where(eq(scimGroups.organizationId, organizationId));
    const managed = await tx.select({ userId: scimUsers.userId }).from(scimUsers).where(eq(scimUsers.organizationId, organizationId));
    await followGroups(tx, { organizationId, baseUrl: '', ipAddress }, [...members, ...managed].map((m) => m.userId));
  });
}

function uniqueName(error: unknown, name: string | undefined): never {
  if (sqlState(error) === '23505') throw new ScimError(409, `A group named "${name}" already exists.`, 'uniqueness');
  throw error;
}

export async function createGroup(context: ScimContext, body: Record<string, unknown>) {
  const displayName = checkedDisplayName(body?.displayName);
  const id = randomUUID();
  try {
    await privilegedDb.transaction(async (tx) => {
      const members = await memberIds(tx, context.organizationId, body.members);
      await tx.insert(scimGroups).values({ id, organizationId: context.organizationId, displayName, externalId: asOptionalString(body.externalId, 'externalId') });
      if (members.length > 0) await tx.insert(scimGroupMembers).values(members.map((userId) => ({ groupId: id, userId })));
      await audit(tx, context, AUDIT_ACTIONS.SCIM_GROUP_CREATED, 'scim_group', id, { displayName, added: members.length });
      await followGroups(tx, context, members);
    });
  } catch (error) {
    uniqueName(error, displayName);
  }
  return readGroup(context, id);
}

interface GroupChanges {
  displayName?: string;
  externalId?: string | null;
  /** The whole membership. */
  members?: unknown;
  add?: unknown[];
  remove?: unknown[];
  removeAll?: boolean;
}

async function applyGroupChanges(context: ScimContext, id: string, changes: GroupChanges) {
  try {
    await privilegedDb.transaction(async (tx) => {
      const [group] = await tx.select().from(scimGroups).where(and(eq(scimGroups.id, id), eq(scimGroups.organizationId, context.organizationId)));
      if (!group) throw new ScimError(404, `No group ${id}.`);
      const before = (await tx.select({ userId: scimGroupMembers.userId }).from(scimGroupMembers).where(eq(scimGroupMembers.groupId, id))).map((m) => m.userId);

      let after = new Set(before);
      if (changes.removeAll) after = new Set();
      if (changes.members !== undefined) after = new Set(await memberIds(tx, context.organizationId, changes.members));
      for (const userId of await memberIds(tx, context.organizationId, changes.add ?? [])) after.add(userId);
      // Removing someone who is not there, or who was removed here, is no error.
      for (const raw of changes.remove ?? []) {
        const value = Number(typeof raw === 'object' && raw !== null ? (raw as { value?: unknown }).value : raw);
        after.delete(value);
      }

      const added = [...after].filter((u) => !before.includes(u));
      const removed = before.filter((u) => !after.has(u));
      if (removed.length > 0) await tx.delete(scimGroupMembers).where(and(eq(scimGroupMembers.groupId, id), inArray(scimGroupMembers.userId, removed)));
      if (added.length > 0) await tx.insert(scimGroupMembers).values(added.map((userId) => ({ groupId: id, userId })));

      const renamed = changes.displayName !== undefined && changes.displayName !== group.displayName;
      const externalChanged = changes.externalId !== undefined && changes.externalId !== group.externalId;
      if (renamed || externalChanged || added.length > 0 || removed.length > 0) {
        await tx
          .update(scimGroups)
          .set({ updatedAt: new Date(), ...(renamed ? { displayName: changes.displayName } : {}), ...(externalChanged ? { externalId: changes.externalId } : {}) })
          .where(eq(scimGroups.id, id));
        await audit(tx, context, AUDIT_ACTIONS.SCIM_GROUP_UPDATED, 'scim_group', id, {
          displayName: changes.displayName ?? group.displayName,
          ...(renamed ? { renamedFrom: group.displayName } : {}),
          ...(added.length > 0 ? { added: added.length } : {}),
          ...(removed.length > 0 ? { removed: removed.length } : {}),
        });
      }
      // A rename changes what the mappings see for everyone in the group.
      await followGroups(tx, context, renamed || externalChanged ? [...after, ...removed] : [...added, ...removed]);
    });
  } catch (error) {
    uniqueName(error, changes.displayName);
  }
  return readGroup(context, id);
}

/** PUT: name, external id and, when given, the whole membership. */
export async function replaceGroup(context: ScimContext, id: string, body: Record<string, unknown>) {
  return applyGroupChanges(context, id, {
    displayName: checkedDisplayName(body?.displayName),
    ...(body && 'externalId' in body ? { externalId: asOptionalString(body.externalId, 'externalId') } : {}),
    ...(body && 'members' in body ? { members: body.members ?? [] } : {}),
  });
}

/** The user id in `members[value eq "12"]`, the path Okta and Entra ID use to remove one member. */
function memberFilterValue(path: string): string | null {
  const match = /^members\[\s*value\s+eq\s+"([^"]*)"\s*\]$/i.exec(path);
  return match ? match[1] : null;
}

export async function patchGroup(context: ScimContext, id: string, body: unknown) {
  const changes: GroupChanges = {};
  const listOf = (value: unknown) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);
  for (const operation of patchOperations(body)) {
    const path = operation.path?.toLowerCase();
    if (path === undefined) {
      if (operation.op === 'remove') throw new ScimError(400, 'remove needs a path.', 'noTarget');
      const value = (operation.value ?? {}) as Record<string, unknown>;
      for (const [key, v] of Object.entries(value)) {
        const name = key.toLowerCase();
        if (name === 'displayname') changes.displayName = checkedDisplayName(v);
        else if (name === 'externalid') changes.externalId = asOptionalString(v, 'externalId');
        else if (name === 'members') {
          if (operation.op === 'replace') changes.members = v;
          else changes.add = [...(changes.add ?? []), ...listOf(v)];
        }
      }
      continue;
    }
    if (path === 'displayname') {
      if (operation.op === 'remove') throw new ScimError(400, 'displayName cannot be removed.', 'mutability');
      changes.displayName = checkedDisplayName(operation.value);
    } else if (path === 'externalid') {
      changes.externalId = operation.op === 'remove' ? null : asOptionalString(operation.value, 'externalId');
    } else if (path === 'members') {
      if (operation.op === 'add') changes.add = [...(changes.add ?? []), ...listOf(operation.value)];
      else if (operation.op === 'replace') changes.members = operation.value ?? [];
      else if (operation.value === undefined) changes.removeAll = true;
      else changes.remove = [...(changes.remove ?? []), ...listOf(operation.value)];
    } else {
      const member = operation.path ? memberFilterValue(operation.path) : null;
      if (member === null || operation.op !== 'remove') throw new ScimError(400, `Unsupported path "${operation.path}".`, 'invalidPath');
      changes.remove = [...(changes.remove ?? []), member];
    }
  }
  return applyGroupChanges(context, id, changes);
}

export async function deleteGroup(context: ScimContext, id: string) {
  await privilegedDb.transaction(async (tx) => {
    const [group] = await tx.select().from(scimGroups).where(and(eq(scimGroups.id, id), eq(scimGroups.organizationId, context.organizationId)));
    if (!group) throw new ScimError(404, `No group ${id}.`);
    const members = (await tx.select({ userId: scimGroupMembers.userId }).from(scimGroupMembers).where(eq(scimGroupMembers.groupId, id))).map((m) => m.userId);
    await tx.delete(scimGroups).where(eq(scimGroups.id, id));
    await audit(tx, context, AUDIT_ACTIONS.SCIM_GROUP_DELETED, 'scim_group', id, { displayName: group.displayName, members: members.length });
    await followGroups(tx, context, members);
  });
}

// ─── Discovery ──────────────────────────────────────────────────────────────────

export function serviceProviderConfig(baseUrl: string) {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: MAX_PAGE },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      { type: 'oauthbearertoken', name: 'Bearer token', description: 'The token issued under Settings → Single sign-on → Provisioning (SCIM).', primary: true },
    ],
    meta: { resourceType: 'ServiceProviderConfig', location: `${baseUrl}/ServiceProviderConfig` },
  };
}

export function resourceTypes(baseUrl: string) {
  const types = [
    { id: 'User', name: 'User', endpoint: '/Users', schema: SCHEMAS.user },
    { id: 'Group', name: 'Group', endpoint: '/Groups', schema: SCHEMAS.group },
  ].map((t) => ({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
    ...t,
    meta: { resourceType: 'ResourceType', location: `${baseUrl}/ResourceTypes/${t.id}` },
  }));
  return listResponse(types, types.length, 1);
}

const attribute = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  type: 'string',
  multiValued: false,
  required: false,
  caseExact: false,
  mutability: 'readWrite',
  returned: 'default',
  uniqueness: 'none',
  ...extra,
});

/** The attributes this API keeps, so a provider's attribute mapping can be checked against them. */
export function schemas(baseUrl: string) {
  const list = [
    {
      id: SCHEMAS.user,
      name: 'User',
      attributes: [
        attribute('userName', { required: true, uniqueness: 'server' }),
        attribute('externalId', { caseExact: true }),
        attribute('active', { type: 'boolean' }),
        attribute('emails', { type: 'complex', multiValued: true, mutability: 'readOnly' }),
        attribute('groups', { type: 'complex', multiValued: true, mutability: 'readOnly' }),
      ],
    },
    {
      id: SCHEMAS.group,
      name: 'Group',
      attributes: [
        attribute('displayName', { required: true, uniqueness: 'server' }),
        attribute('externalId', { caseExact: true }),
        attribute('members', { type: 'complex', multiValued: true }),
      ],
    },
  ].map((s) => ({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'], ...s, meta: { resourceType: 'Schema', location: `${baseUrl}/Schemas/${s.id}` } }));
  return listResponse(list, list.length, 1);
}
