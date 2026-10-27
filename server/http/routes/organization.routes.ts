import { type Request, type Response } from 'express';
import { flattenZodError } from '../zod-error';
import { asyncRouter } from '../../platform/middleware/async-router';
import {
  isEmailAddress,
  organizationMailConfigured,
  sendMail,
  type MailResult,
} from '../../messaging/mailer';
import { invitationMail, passwordResetMail } from '../../messaging/mail-messages';
import { publicBase } from './sso.routes';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { and, desc, eq, gte, like, lte, type SQL } from 'drizzle-orm';
import {
  organizations,
  organizationMemberships,
  users,
  invitations,
  auditLog,
  AUDIT_ACTIONS,
} from '@shared/schema';
import { storage } from '../../identity/storage';
import { requireRole } from '../middleware/require-role';
import { sessionOnly } from '../middleware/session-only';
import { sharedSensitiveRateLimit } from '../middleware/rate-limits';
import { withTenantTransaction, getTenantOrgId } from '../../platform/middleware/tenancy';
import { auditActor, recordAudit } from '../../tenancy/audit';
import { exportOrganization, eraseOrganization } from '../../tenancy/organization-lifecycle';
import { transferMemberContent } from '../../tenancy/member-removal';
import {
  eldestOtherOwner,
  hasOtherMembership,
  listMembers,
  memberOf,
  moveToAnotherMembership,
  otherOwnerCount,
  removeMembership,
  setMemberRole,
} from '../../tenancy/organization-memberships';
import { issuePasswordReset } from '../../identity/password-reset';
import logger from '../../platform/logger';
import { liveRunCounts, quotaUsage, quotasFor } from '../../tenancy/tenant-quotas';
import { availableRunnerCount } from '../../runtime/runner-registry';

const router = asyncRouter();

const RoleSchema = z.enum(['viewer', 'editor', 'owner']);

/**
 * The organization's share of the execution plane: its limits and what it is using now.
 *
 * So a team whose run is "queued" for a while can see why — two already running, the limit is
 * two — instead of wondering whether the system is broken. Read-only: the limits are the
 * operator's to set (see server/tenancy/tenant-quotas.ts).
 */
router.get(
  '/api/organization/usage',
  requireRole('viewer'),
  async (_req: Request, res: Response) => {
    const organizationId = getTenantOrgId()!;
    const usage = await withTenantTransaction(async (tx) => {
      const [quotas, counts, consumption] = await Promise.all([
        quotasFor(tx, organizationId),
        liveRunCounts(tx, organizationId),
        quotaUsage(tx, organizationId),
      ]);
      return { ...counts, ...quotas, ...consumption };
    });
    // Zero means every run will wait however much room the organization has: say so, since that
    // is the question a run sitting in "queued" raises first.
    res.json({ ...usage, runnersOnline: await availableRunnerCount() });
  },
);

/**
 * Who is in the organization is organization_memberships (migration 0086), an org-scoped table
 * the policy filters; users itself is not one (it holds the current-organization pointer), so
 * wherever a handler below reads it alone, it names the organization explicitly.
 */
router.get('/api/organization', requireRole('viewer'), async (_req: Request, res: Response) => {
  const organizationId = getTenantOrgId()!;

  const result = await withTenantTransaction(async (tx) => {
    const [organization] = await tx
      .select({
        id: organizations.id,
        name: organizations.name,
        createdAt: organizations.createdAt,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId));

    // People, with the role each holds here. Service accounts are listed, and managed, under
    // /api/service-accounts. An explicit column list, never the user row: the password hash must
    // not leave the database.
    const members = (await listMembers(tx, organizationId)).map(
      ({ id, username, role, createdAt, disabledAt, current }) => ({
        id,
        username,
        role,
        createdAt,
        // Set when the identity provider deactivated them through SCIM (server/identity/scim.ts).
        disabledAt,
        // Whether this organization is the one they are acting in; a member of several may not be.
        current,
      }),
    );

    return { organization, members };
  });

  res.json(result);
});

/**
 * The audit trail. Owner-only: it names who did what, which is exactly the information a
 * viewer or editor has no business enumerating.
 *
 * No organizationId predicate — audit_log IS an RLS table (unlike users and invitations), so
 * the policy scopes this. Nothing here can write, either: app_user holds SELECT and INSERT on
 * this table and nothing more, so there is no route that could erase an entry even by mistake.
 */
const AUDIT_ACTION_VALUES = Object.values(AUDIT_ACTIONS) as string[];
/** 'test' for test.created, test.updated…: what a person filtering the trail thinks in. */
const AUDIT_CATEGORIES = [...new Set(AUDIT_ACTION_VALUES.map((action) => action.split('.')[0]))];

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  action: z
    .string()
    .refine((value) => AUDIT_ACTION_VALUES.includes(value), 'Unknown action')
    .optional(),
  category: z
    .string()
    .refine((value) => AUDIT_CATEGORIES.includes(value), 'Unknown category')
    .optional(),
  actorUserId: z.coerce.number().int().positive().optional(),
  targetType: z.string().max(40).optional(),
  targetId: z.string().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

/** The most a CSV export holds. Past it, narrow the filter: the trail is not a backup. */
const AUDIT_EXPORT_LIMIT = 10_000;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  // A cell starting with = + - @ is a formula to a spreadsheet; the trail is read in one.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

router.get(
  '/api/organization/audit-log',
  requireRole('owner'),
  async (req: Request, res: Response) => {
    const parsed = auditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid query', details: flattenZodError(parsed.error) });
    }
    const query = parsed.data;

    const conditions: SQL[] = [];
    if (query.action) conditions.push(eq(auditLog.action, query.action));
    if (query.category) conditions.push(like(auditLog.action, `${query.category}.%`));
    if (query.actorUserId) conditions.push(eq(auditLog.actorUserId, query.actorUserId));
    if (query.targetType) conditions.push(eq(auditLog.targetType, query.targetType));
    if (query.targetId) conditions.push(eq(auditLog.targetId, query.targetId));
    if (query.from) conditions.push(gte(auditLog.createdAt, query.from));
    if (query.to) conditions.push(lte(auditLog.createdAt, query.to));

    const exporting = query.format === 'csv';
    // One more than asked for, so the answer can say whether there is a next page without a count.
    const take = exporting ? AUDIT_EXPORT_LIMIT : query.limit + 1;

    const rows = await withTenantTransaction((tx) =>
      tx
        .select()
        .from(auditLog)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(take)
        .offset(exporting ? 0 : query.offset),
    );

    if (exporting) {
      const columns = [
        'createdAt',
        'action',
        'actorUsername',
        'actorUserId',
        'apiKeyId',
        'ipAddress',
        'targetType',
        'targetId',
        'metadata',
      ] as const;
      const lines = [
        columns.join(','),
        ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
      ];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      return res.send(lines.join('\r\n') + '\r\n');
    }

    const hasMore = rows.length > query.limit;
    res.json({
      entries: rows.slice(0, query.limit),
      limit: query.limit,
      offset: query.offset,
      hasMore,
      categories: AUDIT_CATEGORIES,
    });
  },
);

/**
 * Data portability. Owner-only, and it is the whole organization: members, tests, plans,
 * executions, the audit trail. Credentials are excluded by exportOrganization — this is a
 * customer taking their data with them, not a credential dump, and the file will be emailed.
 */
router.get(
  '/api/organization/export',
  requireRole('owner'),
  async (_req: Request, res: Response) => {
    const organizationId = getTenantOrgId()!;
    const payload = await exportOrganization(organizationId);

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="organization-${organizationId}-export.json"`,
    );
    res.json(payload);
  },
);

/**
 * Erasure. Irreversible, and it takes every member account with it.
 *
 * Requires the organization's own name in the body. Not security — an owner is already
 * authorised — but a deliberate pause: this is the one endpoint whose accidental success cannot
 * be undone, and `DELETE /api/organization` is two characters away from `DELETE
 * /api/organization/members/:id`.
 *
 * Recorded in the application log rather than the audit trail: an audit entry about erasing an
 * organization would be erased along with it. The log outlives the tenant.
 */
router.delete('/api/organization', requireRole('owner'), async (req: Request, res: Response) => {
  const organizationId = getTenantOrgId()!;
  const parsed = z.object({ confirmName: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Provide confirmName, the organization's name." });
  }

  const [organization] = await withTenantTransaction((tx) =>
    tx
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId)),
  );
  if (!organization) return res.status(404).json({ error: 'Organization not found' });

  if (parsed.data.confirmName !== organization.name) {
    return res.status(400).json({ error: "confirmName does not match the organization's name." });
  }

  logger.warn({
    message: 'Organization erased',
    organizationId,
    organizationName: organization.name,
    byUserId: req.user!.id,
    byUsername: req.user!.username,
  });

  const { deleted, files } = await eraseOrganization(organizationId, {
    actor: { id: req.user!.id, username: req.user!.username },
  });
  if (files.failed.length > 0) {
    logger.error({
      message: 'Organization erased, but some of its files could not be removed',
      organizationId,
      prefixes: files.failed,
    });
  }

  // The caller's own account is among the rows just deleted, so their session now points at
  // nothing. Ending it is tidier than letting the next request fail to deserialise a user — but
  // the response must not depend on it: the erasure has already committed, and reporting it is
  // the last thing anyone will ever learn about this organization. Guarded because req.logout
  // only exists where passport is mounted.
  if (typeof req.logout === 'function') {
    req.logout(() => undefined);
  }
  res.json({ erased: true, deleted, files });
});

/**
 * How someone actually joins an organization they did not create.
 *
 * POST /api/organization/members cannot do it: an account is never moved into an organization
 * by an owner of it, since ownership of an organization is authority over its membership, not
 * over other people's accounts. An invitation names a username: one that does not exist yet
 * registers with the token and the new account is created here; one that exists signs in and
 * accepts the link (POST /api/invitations/accept), which adds this organization to the ones the
 * account belongs to (migration 0086).
 */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What the answer says about the e-mail: `emailed` true when it left, false with `emailError`
 * when it was tried and failed, absent when there was nothing to try (no mail configured, or a
 * username that is not an address) — then the owner hands the link over, as before.
 */
async function mailIfPossible(
  username: string,
  build: () => Promise<Parameters<typeof sendMail>[0]>,
): Promise<{ emailed?: boolean; emailError?: string }> {
  if (!isEmailAddress(username) || !(await organizationMailConfigured(getTenantOrgId()))) return {};
  const result: MailResult = await sendMail(await build());
  return result.sent ? { emailed: true } : { emailed: false, emailError: result.error };
}

router.get(
  '/api/organization/invitations',
  requireRole('owner'),
  async (_req: Request, res: Response) => {
    const organizationId = getTenantOrgId()!;

    // invitations has no RLS policy (registration must read it before any tenant context
    // exists), so the organizationId predicate here is the isolation, not a belt-and-braces.
    const pending = await withTenantTransaction((tx) =>
      tx
        .select({
          id: invitations.id,
          username: invitations.username,
          role: invitations.role,
          expiresAt: invitations.expiresAt,
          acceptedAt: invitations.acceptedAt,
          createdAt: invitations.createdAt,
        })
        .from(invitations)
        .where(eq(invitations.organizationId, organizationId)),
    );

    // The token is deliberately absent: it is a bearer credential, and this endpoint exists to
    // show who has been invited, not to re-read secrets. It is returned once, at creation.
    res.json(pending);
  },
);

router.post(
  '/api/organization/invitations',
  requireRole('owner'),
  sharedSensitiveRateLimit(),
  sessionOnly('Inviting members'),
  async (req: Request, res: Response) => {
    const organizationId = getTenantOrgId()!;
    const parsed = z
      .object({
        username: z.string().min(3),
        // No 'owner': granting ownership is a deliberate act on an existing member (PATCH), not
        // something an unaccepted invitation can pre-authorise.
        role: z.enum(['viewer', 'editor']).default('editor'),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid payload', details: flattenZodError(parsed.error) });
    }

    // Privileged and outside the tenant transaction: this asks a question about the global
    // username namespace, which is not org-scoped. An existing account may be invited — it joins
    // by accepting, signed in — unless it is a service account or already a member here.
    const existing = await storage.getUserByUsername(parsed.data.username);
    if (existing && existing.kind !== 'person') {
      return res.status(409).json({ error: 'That username belongs to a service account.' });
    }
    if (existing) {
      const alreadyMember = await withTenantTransaction((tx) =>
        memberOf(tx, organizationId, existing.id),
      );
      if (alreadyMember) {
        return res
          .status(409)
          .json({ error: 'That user is already a member of this organization.' });
      }
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    try {
      const created = await withTenantTransaction(async (tx) => {
        const [row] = await tx
          .insert(invitations)
          .values({
            organizationId,
            username: parsed.data.username,
            role: parsed.data.role,
            token,
            invitedByUserId: req.user!.id,
            expiresAt,
          })
          .returning();

        // The token is deliberately not in the metadata: this table is readable by every owner
        // and cannot be redacted afterwards.
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.INVITATION_CREATED,
          actor: auditActor(req),
          targetType: 'invitation',
          targetId: row.id,
          metadata: {
            username: row.username,
            role: row.role,
            expiresAt: row.expiresAt.toISOString(),
          },
        });

        return row;
      });

      // Mailed when the installation can and the username is an address (server/messaging/mailer.ts); the
      // token is still returned, once, so the owner can hand the link over if the mail does not
      // arrive — or when there is no mail at all.
      const mail = await mailIfPossible(created.username, async () => {
        const [org] = await withTenantTransaction((tx) =>
          tx
            .select({ name: organizations.name })
            .from(organizations)
            .where(eq(organizations.id, organizationId)),
        );
        return invitationMail({
          organizationId,
          base: publicBase(req),
          username: created.username,
          token: created.token,
          role: created.role,
          organizationName: org?.name ?? 'your organization',
          invitedBy: req.user!.username,
          expiresAt: created.expiresAt,
        });
      });
      res.status(201).json({
        id: created.id,
        username: created.username,
        role: created.role,
        token: created.token,
        expiresAt: created.expiresAt,
        // The owner is told which: an existing account joins by signing in and opening the link,
        // not by registering.
        existingAccount: existing !== undefined,
        ...mail,
      });
    } catch (e: unknown) {
      if (/unique/i.test((e as Error).message ?? '')) {
        return res
          .status(409)
          .json({ error: 'That username already has an invitation waiting to be accepted.' });
      }
      throw e;
    }
  },
);

router.delete(
  '/api/organization/invitations/:id',
  requireRole('owner'),
  sharedSensitiveRateLimit(),
  sessionOnly('Revoking invitations'),
  async (req: Request, res: Response) => {
    const organizationId = getTenantOrgId()!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid invitation id' });

    const removed = await withTenantTransaction(async (tx) => {
      const deleted = await tx
        .delete(invitations)
        .where(and(eq(invitations.id, id), eq(invitations.organizationId, organizationId)))
        .returning();
      if (deleted.length === 0) return false;

      await recordAudit(tx, {
        action: AUDIT_ACTIONS.INVITATION_REVOKED,
        actor: auditActor(req),
        targetType: 'invitation',
        targetId: id,
        metadata: { username: deleted[0].username, role: deleted[0].role },
      });
      return true;
    });

    if (!removed) return res.status(404).json({ error: 'Invitation not found' });
    res.status(204).end();
  },
);

router.post(
  '/api/organization/members',
  requireRole('owner'),
  sharedSensitiveRateLimit(),
  sessionOnly('Adding members'),
  async (req: Request, res: Response) => {
    const organizationId = getTenantOrgId()!;
    const parsed = z
      .object({ userId: z.number().int().positive(), role: RoleSchema })
      .safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid payload', details: flattenZodError(parsed.error) });
    }

    const outcome = await withTenantTransaction(async (tx) => {
      // Members of this organization only: the lookup is through organization_memberships, which
      // the policy scopes, so an id of anyone else in the system is simply not found here.
      //
      // Which is what keeps this endpoint from being a cross-tenant member-theft vector: an owner
      // could otherwise enumerate ids and re-parent anyone into their own organization. Ownership
      // of an organization is authority over its membership, not over other people's accounts.
      // Growing an organization is what POST /api/organization/invitations is for. A service
      // account's role is set where it was created; this is for people.
      const target = await memberOf(tx, organizationId, parsed.data.userId);
      if (!target) return { status: 404 as const };

      await setMemberRole(tx, organizationId, target.id, parsed.data.role);
      return {
        status: 201 as const,
        body: { id: target.id, username: target.username, role: parsed.data.role },
      };
    });

    if (outcome.status === 404) {
      // Not here. Said apart from "nobody" when it is somebody of another organization, as it
      // always was: the refusal, and the reason, are the point of this handler.
      const elsewhere = await storage.getUser(parsed.data.userId);
      if (elsewhere && elsewhere.kind === 'person') {
        return res.status(409).json({
          error:
            'That user is not a member of this organization. Invite them instead: an account ' +
            'joins an organization by accepting an invitation, never by being moved.',
        });
      }
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(201).json(outcome.body);
  },
);

/**
 * A one-time link for a member to choose a new password (server/identity/password-reset.ts), when they
 * cannot sign in. The link is returned once, for the owner to hand over; the application sends no
 * e-mail. A signed-in session only, as for resetting a second factor: a key that could hand out
 * passwords would be a way into every account of the organization. Never for oneself: that is
 * what changing one's own password, with the current one, is for.
 */
router.post(
  '/api/organization/members/:userId/password-reset',
  requireRole('owner'),
  async (req: Request, res: Response) => {
    if ((req as Request & { apiKeyId?: string }).apiKeyId) {
      return res.status(403).json({
        error: 'Password reset links are issued from a signed-in session, not with an API key.',
      });
    }
    const organizationId = getTenantOrgId()!;
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id' });
    if (userId === req.user!.id) {
      return res
        .status(400)
        .json({ error: 'Change your own password in Settings > Account, with your current one.' });
    }

    const issued = await withTenantTransaction(async (tx) => {
      // users has no RLS: the membership names the organization, whichever one they act in.
      const [member] = await tx
        .select({ id: users.id, username: users.username })
        .from(users)
        .innerJoin(organizationMemberships, eq(organizationMemberships.userId, users.id))
        .where(
          and(
            eq(users.id, userId),
            eq(organizationMemberships.organizationId, organizationId),
            eq(users.kind, 'person'),
          ),
        );
      if (!member) return null;

      const reset = await issuePasswordReset(tx, {
        organizationId,
        userId,
        createdBy: req.user!.id,
      });
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.PASSWORD_RESET_ISSUED,
        actor: auditActor(req),
        targetType: 'user',
        targetId: userId,
        // Never the token: this table is readable by every owner.
        metadata: { username: member.username, expiresAt: reset.expiresAt.toISOString() },
      });
      return { ...reset, username: member.username };
    });

    if (!issued) return res.status(404).json({ error: 'Member not found' });
    const mail = await mailIfPossible(issued.username, async () =>
      passwordResetMail({
        base: publicBase(req),
        username: issued.username,
        token: issued.token,
        expiresAt: issued.expiresAt,
        organizationId: getTenantOrgId()!,
      }),
    );
    res.status(201).json({
      username: issued.username,
      token: issued.token,
      expiresAt: issued.expiresAt,
      ...mail,
    });
  },
);

router.patch(
  '/api/organization/members/:userId',
  requireRole('owner'),
  sharedSensitiveRateLimit(),
  sessionOnly('Changing roles or removing members'),
  async (req: Request, res: Response) => {
    const organizationId = getTenantOrgId()!;
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id' });

    const parsed = z.object({ role: RoleSchema }).safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid role', details: flattenZodError(parsed.error) });
    }

    const outcome = await withTenantTransaction(async (tx) => {
      const target = await memberOf(tx, organizationId, userId);
      if (!target) return { status: 404 as const };

      // Counted inside the transaction, not before it: a read-then-write check would let two
      // concurrent demotions both observe a second owner and both succeed.
      if (target.role === 'owner' && parsed.data.role !== 'owner') {
        if ((await otherOwnerCount(tx, organizationId, userId)) === 0)
          return { status: 409 as const };
      }

      // The role they hold here; the user row follows only when here is where they are acting.
      await setMemberRole(tx, organizationId, userId, parsed.data.role);
      const updated = { id: target.id, username: target.username, role: parsed.data.role };

      await recordAudit(tx, {
        action: AUDIT_ACTIONS.MEMBER_ROLE_CHANGED,
        actor: auditActor(req),
        targetType: 'user',
        targetId: userId,
        // Both sides: "changed to editor" is not answerable without knowing what it was.
        metadata: { username: target.username, from: target.role, to: parsed.data.role },
      });

      return { status: 200 as const, body: updated };
    });

    if (outcome.status === 404) return res.status(404).json({ error: 'Member not found' });
    if (outcome.status === 409) {
      return res.status(409).json({ error: 'An organization must keep at least one owner' });
    }
    res.json(outcome.body);
  },
);

router.delete(
  '/api/organization/members/:userId',
  requireRole('owner'),
  sharedSensitiveRateLimit(),
  sessionOnly('Changing roles or removing members'),
  async (req: Request, res: Response) => {
    const organizationId = getTenantOrgId()!;
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id' });

    const body = z
      .object({ transferTo: z.number().int().positive().optional() })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return res
        .status(400)
        .json({ error: 'Invalid payload', details: flattenZodError(body.error) });
    }

    // Whether the person belongs anywhere else decides what "remove" means: taking this
    // organization away from an account that lives on, or deleting the account as before. Asked
    // before the tenant transaction, because from inside it the other memberships are not visible.
    const belongsElsewhere = await hasOtherMembership(userId, organizationId);

    const outcome = await withTenantTransaction(async (tx) => {
      const target = await memberOf(tx, organizationId, userId);
      if (!target) return { status: 404 as const };

      if (target.role === 'owner') {
        if ((await otherOwnerCount(tx, organizationId, userId)) === 0)
          return { status: 409 as const };
      }

      // Who takes over what the member made (server/tenancy/member-removal.ts): the member the request
      // names, or the owner removing them, or — when an owner removes themselves — the longest-
      // standing other owner, who exists because the check above passed.
      let heir: { id: number; username: string } | undefined;
      const named = body.data.transferTo ?? (req.user!.id !== userId ? req.user!.id : undefined);
      if (named !== undefined) {
        if (named === userId)
          return { status: 400 as const, error: 'transferTo must be another member' };
        heir = await memberOf(tx, organizationId, named);
        if (!heir)
          return { status: 400 as const, error: 'transferTo is not a member of this organization' };
      } else {
        heir = await eldestOtherOwner(tx, organizationId, userId);
      }

      const transferred = await transferMemberContent(tx, organizationId, userId, heir!.id);

      // Audit before the delete, not after: actor_user_id is ON DELETE SET NULL, and an owner
      // removing themselves would otherwise null out the actor on their own entry. The
      // denormalised actor_username survives either way, but the id is worth keeping when it
      // can be.
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.MEMBER_REMOVED,
        actor: auditActor(req),
        targetType: 'user',
        targetId: userId,
        metadata: {
          username: target.username,
          role: target.role,
          transferredTo: heir!.username,
          transferred,
          accountDeleted: !belongsElsewhere,
        },
      });

      if (belongsElsewhere) {
        // The account stays: its membership here goes, with what was theirs here.
        await removeMembership(tx, organizationId, userId);
      } else {
        await tx
          .delete(users)
          .where(and(eq(users.id, userId), eq(users.organizationId, organizationId)));
      }
      return {
        status: 200 as const,
        wasCurrent: target.current,
        body: {
          removed: userId,
          accountDeleted: !belongsElsewhere,
          transferredTo: { id: heir!.id, username: heir!.username },
          transferred,
        },
      };
    });

    if (outcome.status === 404) return res.status(404).json({ error: 'Member not found' });
    if (outcome.status === 400) return res.status(400).json({ error: outcome.error });
    if (outcome.status === 409) {
      return res.status(409).json({ error: 'An organization must keep at least one owner' });
    }
    // They were acting here and still have somewhere to be: their session moves there on its next
    // request (passport re-reads the user row). After the transaction, where the other membership
    // is visible.
    if (belongsElsewhere && outcome.wasCurrent)
      await moveToAnotherMembership(userId, organizationId);
    res.json(outcome.body);
  },
);

export default router;
