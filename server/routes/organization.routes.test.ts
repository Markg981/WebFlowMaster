import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { runWithTenant } from '../middleware/tenancy';
import organizationRoutes from './organization.routes';

let orgId: number;
let ownerId: number;
let editorId: number;
let currentUser: { id: number; role: string; organizationId: number };

const app = express();
app.use(express.json());
app.use((req: Request, _res: Response, next: NextFunction) => {
  (req as Request & { user?: unknown }).user = currentUser;
  req.isAuthenticated = (() => true) as never;
  runWithTenant(currentUser.organizationId, async () => next());
});
app.use(organizationRoutes);

beforeEach(async () => {
  const orgRows = await privilegedDb.execute(
    sql`INSERT INTO organizations (name) VALUES ('Acme') RETURNING id`,
  );
  orgId = Number((orgRows.rows[0] as { id: number }).id);

  const userRows = await privilegedDb.execute(sql`
    INSERT INTO users (username, password, organization_id, role)
    VALUES ('org-owner', 'x', ${orgId}, 'owner'), ('org-editor', 'x', ${orgId}, 'editor')
    RETURNING id
  `);
  ownerId = Number((userRows.rows[0] as { id: number }).id);
  editorId = Number((userRows.rows[1] as { id: number }).id);

  currentUser = { id: ownerId, role: 'owner', organizationId: orgId };
});

afterEach(async () => {
  await privilegedDb.execute(sql`DELETE FROM audit_log WHERE organization_id = ${orgId}`);
  await privilegedDb.execute(sql`DELETE FROM invitations WHERE organization_id = ${orgId}`);
  await privilegedDb.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`);
  await privilegedDb.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`);
});

describe('export and erasure', () => {
  it('exports the organization, without credentials, to an owner only', async () => {
    const res = await request(app).get('/api/organization/export');

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body.organization.id).toBe(orgId);
    expect(res.body.data.users).toHaveLength(2);
    expect(JSON.stringify(res.body)).not.toContain('password');

    currentUser = { id: editorId, role: 'editor', organizationId: orgId };
    expect((await request(app).get('/api/organization/export')).status).toBe(403);
  });

  it('refuses erasure without the organization’s name, and without owner', async () => {
    expect((await request(app).delete('/api/organization').send({})).status).toBe(400);
    expect(
      (await request(app).delete('/api/organization').send({ confirmName: 'Not Acme' })).status,
    ).toBe(400);

    // Nothing was touched by either refusal.
    const still = await privilegedDb.execute(sql`SELECT id FROM organizations WHERE id = ${orgId}`);
    expect(still.rows).toHaveLength(1);

    currentUser = { id: editorId, role: 'editor', organizationId: orgId };
    expect(
      (await request(app).delete('/api/organization').send({ confirmName: 'Acme' })).status,
    ).toBe(403);
  });

  it('erases the organization when the name matches', async () => {
    const res = await request(app).delete('/api/organization').send({ confirmName: 'Acme' });

    expect(res.status).toBe(200);
    expect(res.body.erased).toBe(true);
    expect(res.body.deleted.users).toBe(2);

    const gone = await privilegedDb.execute(sql`SELECT id FROM organizations WHERE id = ${orgId}`);
    expect(gone.rows).toHaveLength(0);
  });
});

describe('the audit trail records what the member routes do', () => {
  const auditFor = () =>
    privilegedDb.execute(
      sql`SELECT action, actor_username, target_id, metadata FROM audit_log WHERE organization_id = ${orgId} ORDER BY id`,
    );

  it('records a role change with both the old and the new role', async () => {
    await request(app).patch(`/api/organization/members/${editorId}`).send({ role: 'viewer' }).expect(200);

    const rows = (await auditFor()).rows as { action: string; actor_username: string; target_id: string; metadata: Record<string, unknown> }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('member.role_changed');
    expect(rows[0].target_id).toBe(String(editorId));
    // Both sides: "changed to viewer" is not answerable without knowing what it was before.
    expect(rows[0].metadata).toMatchObject({ from: 'editor', to: 'viewer' });
  });

  it('records a removal, and keeps it after the member is gone', async () => {
    await request(app).delete(`/api/organization/members/${editorId}`).expect(200);

    const rows = (await auditFor()).rows as { action: string; target_id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('member.removed');
    expect(rows[0].target_id).toBe(String(editorId));
  });

  it('writes no entry when the change is refused', async () => {
    // The last-owner guard rejects this. An audit log that records attempts as if they were
    // changes is worse than none: it makes the trail unreadable.
    await request(app).patch(`/api/organization/members/${ownerId}`).send({ role: 'viewer' }).expect(409);
    expect((await auditFor()).rows).toHaveLength(0);
  });

  it('records invitation creation and revocation, never the token', async () => {
    const created = await request(app)
      .post('/api/organization/invitations')
      .send({ username: 'audited-newcomer' })
      .expect(201);
    await request(app).delete(`/api/organization/invitations/${created.body.id}`).expect(204);

    const rows = (await auditFor()).rows as { action: string; metadata: Record<string, unknown> }[];
    expect(rows.map((r) => r.action)).toEqual(['invitation.created', 'invitation.revoked']);
    // The token is a bearer credential and this table cannot be redacted afterwards.
    expect(JSON.stringify(rows)).not.toContain(created.body.token);
  });

  it('is readable by an owner and refused to an editor', async () => {
    await request(app).post('/api/organization/invitations').send({ username: 'audited-newcomer' }).expect(201);

    const asOwner = await request(app).get('/api/organization/audit-log');
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.entries).toHaveLength(1);

    currentUser = { id: editorId, role: 'editor', organizationId: orgId };
    expect((await request(app).get('/api/organization/audit-log')).status).toBe(403);
  });
});

describe('organization invitations', () => {
  const invite = (body: Record<string, unknown>) =>
    request(app).post('/api/organization/invitations').send(body);

  it('creates an invitation and returns the token exactly once', async () => {
    const res = await invite({ username: 'newcomer', role: 'editor' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ username: 'newcomer', role: 'editor' });
    expect(res.body.token).toMatch(/^[0-9a-f]{64}$/);

    // The listing deliberately omits the token: it is a bearer credential, handed back once
    // at creation. An endpoint that re-reads it turns any owner session into a way to
    // retrieve every outstanding one.
    const list = await request(app).get('/api/organization/invitations');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ username: 'newcomer', role: 'editor' });
    expect(list.body[0].token).toBeUndefined();
  });

  it('refuses to invite a username that already exists', async () => {
    // The whole reason invitations exist: an existing account cannot be moved between
    // organizations, so it cannot be invited into one either.
    const res = await invite({ username: 'org-editor' });
    expect(res.status).toBe(409);
  });

  it('refuses to invite someone straight to owner', async () => {
    const res = await invite({ username: 'newcomer', role: 'owner' });
    expect(res.status).toBe(400);
  });

  it('refuses a second invitation for the same username', async () => {
    expect((await invite({ username: 'newcomer' })).status).toBe(201);
    expect((await invite({ username: 'newcomer' })).status).toBe(409);
  });

  it('refuses invitation management to an editor', async () => {
    currentUser = { id: editorId, role: 'editor', organizationId: orgId };
    expect((await invite({ username: 'newcomer' })).status).toBe(403);
    expect((await request(app).get('/api/organization/invitations')).status).toBe(403);
  });

  it('revokes an invitation', async () => {
    const created = await invite({ username: 'newcomer' });
    const del = await request(app).delete(`/api/organization/invitations/${created.body.id}`);

    expect(del.status).toBe(204);
    expect((await request(app).get('/api/organization/invitations')).body).toHaveLength(0);
  });

  it('cannot revoke another organization’s invitation', async () => {
    const otherOrg = await privilegedDb.execute(
      sql`INSERT INTO organizations (name) VALUES ('Other') RETURNING id`,
    );
    const otherOrgId = Number((otherOrg.rows[0] as { id: number }).id);
    const [otherOwner] = (
      await privilegedDb.execute(sql`
        INSERT INTO users (username, password, organization_id, role)
        VALUES ('other-owner', 'x', ${otherOrgId}, 'owner') RETURNING id
      `)
    ).rows as { id: number }[];
    const theirInvite = await privilegedDb.execute(sql`
      INSERT INTO invitations (organization_id, username, role, token, invited_by_user_id, expires_at)
      VALUES (${otherOrgId}, 'their-newcomer', 'editor', 'f'||repeat('0', 63), ${otherOwner.id}, now() + interval '7 days')
      RETURNING id
    `);
    const theirInviteId = Number((theirInvite.rows[0] as { id: number }).id);

    // invitations has no RLS policy, so this is the explicit organizationId predicate in the
    // handler doing the work — the same shape as the member routes against `users`.
    const res = await request(app).delete(`/api/organization/invitations/${theirInviteId}`);
    expect(res.status).toBe(404);

    const stillThere = await privilegedDb.execute(
      sql`SELECT id FROM invitations WHERE id = ${theirInviteId}`,
    );
    expect(stillThere.rows).toHaveLength(1);

    await privilegedDb.execute(sql`DELETE FROM invitations WHERE organization_id = ${otherOrgId}`);
    await privilegedDb.execute(sql`DELETE FROM users WHERE organization_id = ${otherOrgId}`);
    await privilegedDb.execute(sql`DELETE FROM organizations WHERE id = ${otherOrgId}`);
  });

  it('does not list another organization’s invitations', async () => {
    const otherOrg = await privilegedDb.execute(
      sql`INSERT INTO organizations (name) VALUES ('Other') RETURNING id`,
    );
    const otherOrgId = Number((otherOrg.rows[0] as { id: number }).id);
    const [otherOwner] = (
      await privilegedDb.execute(sql`
        INSERT INTO users (username, password, organization_id, role)
        VALUES ('other-owner-2', 'x', ${otherOrgId}, 'owner') RETURNING id
      `)
    ).rows as { id: number }[];
    await privilegedDb.execute(sql`
      INSERT INTO invitations (organization_id, username, role, token, invited_by_user_id, expires_at)
      VALUES (${otherOrgId}, 'their-newcomer', 'editor', 'e'||repeat('0', 63), ${otherOwner.id}, now() + interval '7 days')
    `);

    await invite({ username: 'my-newcomer' });
    const list = await request(app).get('/api/organization/invitations');

    expect(list.body).toHaveLength(1);
    expect(list.body[0].username).toBe('my-newcomer');

    await privilegedDb.execute(sql`DELETE FROM invitations WHERE organization_id = ${otherOrgId}`);
    await privilegedDb.execute(sql`DELETE FROM users WHERE organization_id = ${otherOrgId}`);
    await privilegedDb.execute(sql`DELETE FROM organizations WHERE id = ${otherOrgId}`);
  });
});

describe('GET /api/organization', () => {
  it('returns the organization and its members', async () => {
    const res = await request(app).get('/api/organization');

    expect(res.status).toBe(200);
    expect(res.body.organization).toMatchObject({ id: orgId, name: 'Acme' });
    expect(res.body.members).toHaveLength(2);
    expect(res.body.members.map((m: { username: string }) => m.username).sort()).toEqual([
      'org-editor',
      'org-owner',
    ]);
  });

  it('never returns password hashes', async () => {
    const res = await request(app).get('/api/organization');
    expect(JSON.stringify(res.body)).not.toContain('password');
  });
});

describe('POST /api/organization/members', () => {
  /**
   * The theft case. The handler looks the target up by id, so without an organization check
   * an owner could enumerate ids and re-parent anyone in the system into their own
   * organization — taking that person's access to their own organization's data away and
   * handing them this one's. Ownership is authority over an organization's membership, not
   * over other people's accounts.
   */
  it('refuses to pull a user out of another organization', async () => {
    const otherOrg = await privilegedDb.execute(
      sql`INSERT INTO organizations (name) VALUES ('Other') RETURNING id`,
    );
    const otherOrgId = Number((otherOrg.rows[0] as { id: number }).id);
    const otherUserRows = await privilegedDb.execute(sql`
      INSERT INTO users (username, password, organization_id, role)
      VALUES ('other-editor', 'x', ${otherOrgId}, 'editor') RETURNING id
    `);
    const otherUserId = Number((otherUserRows.rows[0] as { id: number }).id);

    const res = await request(app)
      .post('/api/organization/members')
      .send({ userId: otherUserId, role: 'viewer' });

    expect(res.status).toBe(409);

    // Not merely refused — untouched. An earlier version of this handler moved the row.
    const rows = await privilegedDb.execute(
      sql`SELECT organization_id, role FROM users WHERE id = ${otherUserId}`,
    );
    const row = rows.rows[0] as { organization_id: number; role: string };
    expect(row.organization_id).toBe(otherOrgId);
    expect(row.role).toBe('editor');

    await privilegedDb.execute(sql`DELETE FROM users WHERE id = ${otherUserId}`);
    await privilegedDb.execute(sql`DELETE FROM organizations WHERE id = ${otherOrgId}`);
  });

  it('sets the role of a user already in the organization', async () => {
    const res = await request(app)
      .post('/api/organization/members')
      .send({ userId: editorId, role: 'viewer' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: editorId, role: 'viewer' });
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('rejects an invalid role', async () => {
    const res = await request(app)
      .post('/api/organization/members')
      .send({ userId: editorId, role: 'superadmin' });

    expect(res.status).toBe(400);
  });

  it('404s on a userId that does not exist', async () => {
    const res = await request(app)
      .post('/api/organization/members')
      .send({ userId: 999999, role: 'viewer' });

    expect(res.status).toBe(404);
  });

  /**
   * Subsumed by the cross-organization refusal above, and kept deliberately: it asserts the
   * specific consequence that made the old behaviour dangerous rather than merely wrong, so
   * it fails loudly if someone ever reopens cross-organization moves without also restoring
   * a last-owner guard.
   */
  it('refuses to move the last owner out of their organization', async () => {
    const otherOrg = await privilegedDb.execute(
      sql`INSERT INTO organizations (name) VALUES ('Solo') RETURNING id`,
    );
    const otherOrgId = Number((otherOrg.rows[0] as { id: number }).id);
    const soloOwnerRows = await privilegedDb.execute(sql`
      INSERT INTO users (username, password, organization_id, role)
      VALUES ('solo-owner', 'x', ${otherOrgId}, 'owner') RETURNING id
    `);
    const soloOwnerId = Number((soloOwnerRows.rows[0] as { id: number }).id);

    const res = await request(app)
      .post('/api/organization/members')
      .send({ userId: soloOwnerId, role: 'editor' });

    expect(res.status).toBe(409);

    const rows = await privilegedDb.execute(
      sql`SELECT organization_id, role FROM users WHERE id = ${soloOwnerId}`,
    );
    const row = rows.rows[0] as { organization_id: number; role: string };
    expect(row.organization_id).toBe(otherOrgId);
    expect(row.role).toBe('owner');

    await privilegedDb.execute(sql`DELETE FROM users WHERE id = ${soloOwnerId}`);
    await privilegedDb.execute(sql`DELETE FROM organizations WHERE id = ${otherOrgId}`);
  });

  it('refuses member addition to an editor', async () => {
    currentUser = { id: editorId, role: 'editor', organizationId: orgId };

    const res = await request(app)
      .post('/api/organization/members')
      .send({ userId: editorId, role: 'viewer' });

    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/organization/members/:userId', () => {
  it('changes a member role', async () => {
    const res = await request(app)
      .patch(`/api/organization/members/${editorId}`)
      .send({ role: 'viewer' });

    expect(res.status).toBe(200);
    const rows = await privilegedDb.execute(sql`SELECT role FROM users WHERE id = ${editorId}`);
    expect((rows.rows[0] as { role: string }).role).toBe('viewer');
  });

  it('rejects an invalid role', async () => {
    const res = await request(app)
      .patch(`/api/organization/members/${editorId}`)
      .send({ role: 'superadmin' });

    expect(res.status).toBe(400);
  });

  /**
   * Without this, an organization can be left with nobody able to manage it — a state
   * unrecoverable without direct database access.
   */
  it('refuses to demote the last owner', async () => {
    const res = await request(app)
      .patch(`/api/organization/members/${ownerId}`)
      .send({ role: 'editor' });

    expect(res.status).toBe(409);
    const rows = await privilegedDb.execute(sql`SELECT role FROM users WHERE id = ${ownerId}`);
    expect((rows.rows[0] as { role: string }).role).toBe('owner');
  });

  it('refuses to act on a user in another organization', async () => {
    const otherOrg = await privilegedDb.execute(
      sql`INSERT INTO organizations (name) VALUES ('Other') RETURNING id`,
    );
    const otherOrgId = Number((otherOrg.rows[0] as { id: number }).id);
    const outsider = await privilegedDb.execute(sql`
      INSERT INTO users (username, password, organization_id, role)
      VALUES ('outsider', 'x', ${otherOrgId}, 'editor') RETURNING id
    `);
    const outsiderId = Number((outsider.rows[0] as { id: number }).id);

    const res = await request(app)
      .patch(`/api/organization/members/${outsiderId}`)
      .send({ role: 'viewer' });

    expect(res.status).toBe(404);

    await privilegedDb.execute(sql`DELETE FROM users WHERE id = ${outsiderId}`);
    await privilegedDb.execute(sql`DELETE FROM organizations WHERE id = ${otherOrgId}`);
  });
});

describe('DELETE /api/organization/members/:userId', () => {
  it('removes a member', async () => {
    const res = await request(app).delete(`/api/organization/members/${editorId}`);

    expect(res.status).toBe(200);
    const rows = await privilegedDb.execute(sql`SELECT count(*) AS n FROM users WHERE id = ${editorId}`);
    expect(Number((rows.rows[0] as { n: string }).n)).toBe(0);
  });

  it('refuses to remove the last owner', async () => {
    const res = await request(app).delete(`/api/organization/members/${ownerId}`);
    expect(res.status).toBe(409);
  });
});

describe('removing a member who made things', () => {
  let environmentId: number;

  const count = async (query: ReturnType<typeof sql>) =>
    Number(((await privilegedDb.execute(query)).rows[0] as { n: string }).n);

  /** One of everything a member can create, all by the editor. */
  beforeEach(async () => {
    await privilegedDb.execute(sql`INSERT INTO projects (name, user_id, organization_id) VALUES ('Shop', ${editorId}, ${orgId})`);
    await privilegedDb.execute(sql`
      INSERT INTO tests (user_id, organization_id, name, url, sequence, elements)
      VALUES (${editorId}, ${orgId}, 'Checkout', 'https://app.test', '[]'::jsonb, '[]'::jsonb)
    `);
    await privilegedDb.execute(sql`
      INSERT INTO api_tests (user_id, organization_id, name, method, url)
      VALUES (${editorId}, ${orgId}, 'Health', 'GET', 'https://app.test/health')
    `);
    await privilegedDb.execute(sql`
      INSERT INTO test_plans (id, name, user_id, organization_id) VALUES (${`plan-${orgId}`}, 'Nightly', ${editorId}, ${orgId})
    `);
    await privilegedDb.execute(sql`
      INSERT INTO test_plan_schedules (id, test_plan_id, organization_id, schedule_name, frequency, next_run_at, user_id)
      VALUES (${`schedule-${orgId}`}, ${`plan-${orgId}`}, ${orgId}, 'Every night', 'daily', now(), ${editorId})
    `);
    await privilegedDb.execute(sql`
      INSERT INTO step_groups (id, organization_id, user_id, name, sequence)
      VALUES (${`group-${orgId}`}, ${orgId}, ${editorId}, 'Sign in', '[]'::jsonb)
    `);
    const env = await privilegedDb.execute(sql`
      INSERT INTO environments (name, user_id, organization_id) VALUES (${`staging-${orgId}`}, ${editorId}, ${orgId}) RETURNING id
    `);
    environmentId = Number((env.rows[0] as { id: number }).id);
    await privilegedDb.execute(sql`
      INSERT INTO secrets (environment_id, key_name, encrypted_value, iv, auth_tag, user_id, organization_id)
      VALUES (${environmentId}, 'password', 'x', 'x', 'x', ${editorId}, ${orgId})
    `);
    // The editor's own things: they go with the account.
    await privilegedDb.execute(sql`INSERT INTO user_settings (user_id) VALUES (${editorId})`);
    await privilegedDb.execute(sql`
      INSERT INTO api_keys (id, organization_id, user_id, name, prefix, hashed_key)
      VALUES (${`key-${orgId}`}, ${orgId}, ${editorId}, 'CI', 'wfm_abc', ${`hash-${orgId}`})
    `);
    await privilegedDb.execute(sql`
      INSERT INTO invitations (organization_id, username, role, token, invited_by_user_id, expires_at)
      VALUES (${orgId}, ${`invitee-${orgId}`}, 'viewer', ${`token-${orgId}`}, ${editorId}, now() + interval '1 day')
    `);
  });

  // Runs before the file's own cleanup, which deletes the users these rows now point at.
  afterEach(async () => {
    for (const table of ['secrets', 'environments', 'test_plan_schedules', 'test_plans', 'step_groups', 'api_tests', 'tests', 'projects', 'api_keys']) {
      await privilegedDb.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE organization_id = ${orgId}`);
    }
  });

  it('hands everything the member made to the owner removing them', async () => {
    const res = await request(app).delete(`/api/organization/members/${editorId}`);

    expect(res.status).toBe(200);
    expect(res.body.transferredTo).toEqual({ id: ownerId, username: 'org-owner' });
    expect(res.body.transferred).toEqual({
      projects: 1, tests: 1, api_tests: 1, test_plans: 1, test_plan_schedules: 1, step_groups: 1, environments: 1, secrets: 1,
    });
    for (const table of ['projects', 'tests', 'api_tests', 'test_plans', 'test_plan_schedules', 'step_groups', 'environments', 'secrets']) {
      expect(await count(sql`SELECT count(*) AS n FROM ${sql.identifier(table)} WHERE organization_id = ${orgId} AND user_id = ${ownerId}`)).toBe(1);
    }
  });

  it('deletes only what was the member’s own, and keeps the invitation they sent', async () => {
    await request(app).delete(`/api/organization/members/${editorId}`);

    expect(await count(sql`SELECT count(*) AS n FROM user_settings WHERE user_id = ${editorId}`)).toBe(0);
    expect(await count(sql`SELECT count(*) AS n FROM api_keys WHERE user_id = ${editorId}`)).toBe(0);
    expect(await count(sql`SELECT count(*) AS n FROM invitations WHERE organization_id = ${orgId} AND invited_by_user_id IS NULL`)).toBe(1);
  });

  it('hands things to the member the request names', async () => {
    const other = await privilegedDb.execute(sql`
      INSERT INTO users (username, password, organization_id, role) VALUES ('org-viewer', 'x', ${orgId}, 'viewer') RETURNING id
    `);
    const viewerId = Number((other.rows[0] as { id: number }).id);

    const res = await request(app).delete(`/api/organization/members/${editorId}`).send({ transferTo: viewerId });

    expect(res.status).toBe(200);
    expect(res.body.transferredTo.id).toBe(viewerId);
    expect(await count(sql`SELECT count(*) AS n FROM tests WHERE organization_id = ${orgId} AND user_id = ${viewerId}`)).toBe(1);
  });

  it('refuses to hand things to someone outside the organization, or to the member leaving', async () => {
    const elsewhere = await privilegedDb.execute(sql`INSERT INTO organizations (name) VALUES ('Other') RETURNING id`);
    const otherOrg = Number((elsewhere.rows[0] as { id: number }).id);
    const stranger = await privilegedDb.execute(sql`
      INSERT INTO users (username, password, organization_id, role) VALUES ('stranger', 'x', ${otherOrg}, 'owner') RETURNING id
    `);
    const strangerId = Number((stranger.rows[0] as { id: number }).id);

    try {
      const outside = await request(app).delete(`/api/organization/members/${editorId}`).send({ transferTo: strangerId });
      const self = await request(app).delete(`/api/organization/members/${editorId}`).send({ transferTo: editorId });

      expect(outside.status).toBe(400);
      expect(self.status).toBe(400);
      expect(await count(sql`SELECT count(*) AS n FROM users WHERE id = ${editorId}`)).toBe(1);
    } finally {
      await privilegedDb.execute(sql`DELETE FROM users WHERE organization_id = ${otherOrg}`);
      await privilegedDb.execute(sql`DELETE FROM organizations WHERE id = ${otherOrg}`);
    }
  });

  it('hands an owner’s things to another owner when they remove themselves', async () => {
    const second = await privilegedDb.execute(sql`
      INSERT INTO users (username, password, organization_id, role) VALUES ('org-owner-2', 'x', ${orgId}, 'owner') RETURNING id
    `);
    const secondOwnerId = Number((second.rows[0] as { id: number }).id);
    await privilegedDb.execute(sql`UPDATE tests SET user_id = ${ownerId} WHERE organization_id = ${orgId}`);

    const res = await request(app).delete(`/api/organization/members/${ownerId}`);

    expect(res.status).toBe(200);
    expect(res.body.transferredTo.id).toBe(secondOwnerId);
    expect(await count(sql`SELECT count(*) AS n FROM tests WHERE organization_id = ${orgId} AND user_id = ${secondOwnerId}`)).toBe(1);
  });

  it('records who took over, and how much', async () => {
    await request(app).delete(`/api/organization/members/${editorId}`);

    const entry = await privilegedDb.execute(sql`
      SELECT metadata FROM audit_log WHERE organization_id = ${orgId} AND action = 'member.removed'
    `);
    const metadata = (entry.rows[0] as { metadata: { transferredTo: string; transferred: Record<string, number> } }).metadata;
    expect(metadata.transferredTo).toBe('org-owner');
    expect(metadata.transferred.environments).toBe(1);
  });
});

describe('POST /api/organization/members/:userId/password-reset', () => {
  afterEach(async () => {
    await privilegedDb.execute(sql`DELETE FROM password_resets WHERE organization_id = ${orgId}`);
  });

  it('issues a one-time link for a member, returned once, and records it without the token', async () => {
    const res = await request(app).post(`/api/organization/members/${editorId}/password-reset`);

    expect(res.status).toBe(201);
    expect(res.body.username).toBe('org-editor');
    expect(res.body.token).toEqual(expect.any(String));
    const stored = await privilegedDb.execute(sql`SELECT token_hash FROM password_resets WHERE user_id = ${editorId}`);
    expect((stored.rows[0] as { token_hash: string }).token_hash).not.toBe(res.body.token);
    const entry = await privilegedDb.execute(sql`
      SELECT metadata FROM audit_log WHERE organization_id = ${orgId} AND action = 'auth.password_reset_issued'
    `);
    expect(entry.rows).toHaveLength(1);
    expect(JSON.stringify(entry.rows[0])).not.toContain(res.body.token);
  });

  it('refuses one for oneself, and for someone in another organization', async () => {
    const self = await request(app).post(`/api/organization/members/${ownerId}/password-reset`);
    expect(self.status).toBe(400);

    const elsewhere = await privilegedDb.execute(sql`INSERT INTO organizations (name) VALUES ('Other') RETURNING id`);
    const otherOrg = Number((elsewhere.rows[0] as { id: number }).id);
    const stranger = await privilegedDb.execute(sql`
      INSERT INTO users (username, password, organization_id, role) VALUES ('reset-stranger', 'x', ${otherOrg}, 'owner') RETURNING id
    `);
    const strangerId = Number((stranger.rows[0] as { id: number }).id);
    try {
      const res = await request(app).post(`/api/organization/members/${strangerId}/password-reset`);
      expect(res.status).toBe(404);
    } finally {
      await privilegedDb.execute(sql`DELETE FROM users WHERE organization_id = ${otherOrg}`);
      await privilegedDb.execute(sql`DELETE FROM organizations WHERE id = ${otherOrg}`);
    }
  });

  it('refuses an editor', async () => {
    currentUser = { id: editorId, role: 'editor', organizationId: orgId };
    const res = await request(app).post(`/api/organization/members/${ownerId}/password-reset`);
    expect(res.status).toBe(403);
  });
});

describe('role gating', () => {
  it('refuses member management to an editor', async () => {
    currentUser = { id: editorId, role: 'editor', organizationId: orgId };

    const res = await request(app)
      .patch(`/api/organization/members/${ownerId}`)
      .send({ role: 'viewer' });

    expect(res.status).toBe(403);
  });
});
