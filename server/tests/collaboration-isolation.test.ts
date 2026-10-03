import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { createTestOrganization, createTestUser } from './factories';
import { runWithTenant, withTenantTransaction } from '../middleware/tenancy';

let org: number;
let other: number;
let author: number;
let colleague: number;
let outsider: number;
let target: number;
let second: number;
let root: number;
let reply: number;

beforeAll(async () => {
  org = await createTestOrganization();
  other = await createTestOrganization();
  author = await createTestUser(org);
  colleague = await createTestUser(org);
  outsider = await createTestUser(other);
  const targets = await privilegedDb.execute(sql`INSERT INTO tests (organization_id, user_id, name, url, sequence, elements)
    VALUES (${org}, ${author}, 'Discussion target', 'https://example.com', '[]', '[]'),
      (${org}, ${author}, 'Other target', 'https://example.com', '[]', '[]') RETURNING id`);
  [target, second] = targets.rows.map(row => Number((row as { id: number }).id));
  const roots = await privilegedDb.execute(sql`INSERT INTO comments (organization_id, author_id, ui_test_id, body)
    VALUES (${org}, ${author}, ${target}, 'Root') RETURNING id`);
  root = Number((roots.rows[0] as { id: number }).id);
});

describe('collaboration database boundaries', () => {
  it('accepts a same-target reply and valid member mentions', async () => {
    const rows = await privilegedDb.execute(sql`INSERT INTO comments (organization_id, author_id, ui_test_id, parent_id, mentioned_user_ids, body)
      VALUES (${org}, ${colleague}, ${target}, ${root}, ${JSON.stringify([author])}::jsonb, 'Reply') RETURNING id`);
    reply = Number((rows.rows[0] as { id: number }).id);
    expect(reply).toBeGreaterThan(root);
  });

  it('rejects cross-target parent references even through privileged writes', async () => {
    await expect(privilegedDb.execute(sql`INSERT INTO comments (organization_id, author_id, ui_test_id, parent_id, body)
      VALUES (${org}, ${author}, ${second}, ${root}, 'Wrong target')`)).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects nested replies and resolution of a reply', async () => {
    await expect(privilegedDb.execute(sql`INSERT INTO comments (organization_id, author_id, ui_test_id, parent_id, body)
      VALUES (${org}, ${author}, ${target}, ${reply}, 'Nested reply')`)).rejects.toMatchObject({ code: '23514' });
    await expect(privilegedDb.execute(sql`UPDATE comments SET resolved_at = now(), resolved_by = ${author} WHERE id = ${reply}`))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('rejects malformed or cross-organization mentions and resolution authors', async () => {
    for (const ids of [[outsider], ['not-an-id'], [author, author], { user: author }]) {
      await expect(privilegedDb.execute(sql`UPDATE comments SET mentioned_user_ids = ${JSON.stringify(ids)}::jsonb WHERE id = ${root}`))
        .rejects.toMatchObject({ code: '23514' });
    }
    await expect(privilegedDb.execute(sql`UPDATE comments SET resolved_at = now(), resolved_by = ${outsider} WHERE id = ${root}`))
      .rejects.toMatchObject({ code: '23503' });
  });

  it('prevents retargeting or reparenting an existing conversation', async () => {
    await expect(privilegedDb.execute(sql`UPDATE comments SET ui_test_id = ${second} WHERE id = ${root}`))
      .rejects.toMatchObject({ code: '23514' });
    await expect(privilegedDb.execute(sql`UPDATE comments SET parent_id = NULL WHERE id = ${reply}`))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('keeps unrelated organizations from reading or modifying replies', async () => {
    await runWithTenant(other, () => withTenantTransaction(async tx => {
      expect((await tx.execute(sql`SELECT id FROM comments WHERE id IN (${root}, ${reply})`)).rows).toHaveLength(0);
      expect((await tx.execute(sql`UPDATE comments SET body = 'Changed' WHERE id = ${reply} RETURNING id`)).rows).toHaveLength(0);
    }), { userId: outsider, role: 'owner' });
  });

  it('hides private dashboards even from organization owners and allows read-only shared access', async () => {
    const rows = await privilegedDb.execute(sql`INSERT INTO dashboards (organization_id, creator_id, name, visibility, widgets)
      VALUES (${org}, ${author}, 'Private layout', 'private', '[]'),
        (${org}, ${author}, 'Shared layout', 'organization', '[]') RETURNING id, visibility`);
    const privateId = (rows.rows.find(r => (r as { visibility: string }).visibility === 'private') as { id: string }).id;
    const sharedId = (rows.rows.find(r => (r as { visibility: string }).visibility === 'organization') as { id: string }).id;
    await runWithTenant(org, () => withTenantTransaction(async tx => {
      const visible = await tx.execute(sql`SELECT id FROM dashboards WHERE id IN (${privateId}::uuid, ${sharedId}::uuid)`);
      expect(visible.rows).toEqual([{ id: sharedId }]);
      expect((await tx.execute(sql`UPDATE dashboards SET name = 'Hijacked' WHERE id = ${sharedId}::uuid RETURNING id`)).rows).toHaveLength(0);
    }), { userId: colleague, role: 'viewer' });
    await runWithTenant(org, () => withTenantTransaction(async tx => {
      expect((await tx.execute(sql`SELECT id FROM dashboards WHERE id = ${privateId}::uuid`)).rows).toHaveLength(0);
      expect((await tx.execute(sql`UPDATE dashboards SET name = 'Moderated' WHERE id = ${sharedId}::uuid RETURNING id`)).rows).toHaveLength(1);
    }), { userId: colleague, role: 'owner' });
    await runWithTenant(other, () => withTenantTransaction(async tx => {
      expect((await tx.execute(sql`SELECT id FROM dashboards`)).rows).toHaveLength(0);
    }), { userId: outsider, role: 'owner' });
    await expect(privilegedDb.execute(sql`UPDATE dashboards SET creator_id = ${outsider} WHERE id = ${privateId}::uuid`))
      .rejects.toMatchObject({ code: '23514' });
    await expect(privilegedDb.execute(sql`INSERT INTO user_dashboard_preferences (organization_id, user_id, default_dashboard_id)
      VALUES (${other}, ${outsider}, ${sharedId}::uuid)`)).rejects.toMatchObject({ code: '23503' });
  });

  it('clears deleted creators’ dashboard preferences and retains resolved conversations', async () => {
    const departed = await createTestUser(org);
    const dashboard = await privilegedDb.execute(sql`INSERT INTO dashboards (organization_id, creator_id, name, visibility, widgets)
      VALUES (${org}, ${departed}, 'Departing creator', 'organization', '[]') RETURNING id`);
    const id = (dashboard.rows[0] as { id: string }).id;
    await privilegedDb.execute(sql`INSERT INTO user_dashboard_preferences (organization_id, user_id, selected_dashboard_id, default_dashboard_id)
      VALUES (${org}, ${colleague}, ${id}::uuid, ${id}::uuid)`);
    await privilegedDb.execute(sql`UPDATE comments SET resolved_at = now(), resolved_by = ${departed} WHERE id = ${root}`);
    await privilegedDb.execute(sql`DELETE FROM users WHERE id = ${departed}`);
    expect((await privilegedDb.execute(sql`SELECT id FROM dashboards WHERE id = ${id}::uuid`)).rows).toHaveLength(0);
    expect((await privilegedDb.execute(sql`SELECT selected_dashboard_id, default_dashboard_id FROM user_dashboard_preferences WHERE user_id = ${colleague}`)).rows)
      .toEqual([{ selected_dashboard_id: null, default_dashboard_id: null }]);
    const retained = (await privilegedDb.execute(sql`SELECT body, resolved_by, resolved_at IS NOT NULL AS resolved FROM comments WHERE id = ${root}`)).rows[0];
    expect(retained).toEqual({ body: 'Root', resolved_by: null, resolved: true });
  });
});
