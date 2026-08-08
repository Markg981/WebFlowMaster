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
  await privilegedDb.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`);
  await privilegedDb.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`);
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

    expect(res.status).toBe(204);
    const rows = await privilegedDb.execute(sql`SELECT count(*) AS n FROM users WHERE id = ${editorId}`);
    expect(Number((rows.rows[0] as { n: string }).n)).toBe(0);
  });

  it('refuses to remove the last owner', async () => {
    const res = await request(app).delete(`/api/organization/members/${ownerId}`);
    expect(res.status).toBe(409);
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
