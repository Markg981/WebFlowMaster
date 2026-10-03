import { it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { readFileSync } from 'node:fs';

it('upgrades a saved personal layout without losing order, visibility or discussion text', async () => {
  const db = new PGlite();
  try {
    const migrations = readMigrationFiles({ migrationsFolder: 'migrations' });
    const journal = JSON.parse(readFileSync('migrations/meta/_journal.json', 'utf8')) as { entries: { tag: string; when: number }[] };
    const entry = journal.entries.find(item => item.tag === '0076_collaboration')!;
    const index = migrations.findIndex(migration => migration.folderMillis === entry.when);
    expect(index).toBeGreaterThan(0);
    for (const migration of migrations.slice(0, index)) for (const statement of migration.sql) await db.exec(statement);
    const org = (await db.query<{ id: number }>("INSERT INTO organizations (name) VALUES ('Legacy collaboration') RETURNING id")).rows[0].id;
    const user = (await db.query<{ id: number }>('INSERT INTO users (username, password, organization_id) VALUES ($1, $2, $3) RETURNING id', ['legacy-layout-user', 'unused-password', org])).rows[0].id;
    const widgets = ['reports', 'schedules', 'trend', 'status', 'kpis'].map(id => ({ id, visible: id !== 'trend' }));
    await db.query('INSERT INTO user_dashboard_layouts (organization_id, user_id, widgets) VALUES ($1, $2, $3)', [org, user, JSON.stringify(widgets)]);
    const target = (await db.query<{ id: number }>('INSERT INTO tests (organization_id, user_id, name, url, sequence, elements) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [org, user, 'Legacy test', 'https://example.com', '[]', '[]'])).rows[0].id;
    await db.query('INSERT INTO comments (organization_id, author_id, ui_test_id, body) VALUES ($1, $2, $3, $4)', [org, user, target, 'Existing discussion']);
    for (const statement of migrations[index].sql) await db.exec(statement);
    const dashboards = await db.query<{ id: string; widgets: { type: string; visible: boolean }[]; visibility: string }>('SELECT id, widgets, visibility FROM dashboards');
    expect(dashboards.rows).toHaveLength(1);
    expect(dashboards.rows[0].visibility).toBe('private');
    expect(dashboards.rows[0].widgets.map(w => ({ id: w.type, visible: w.visible }))).toEqual(widgets);
    const preferences = (await db.query<{ selected_dashboard_id: string; default_dashboard_id: string }>('SELECT selected_dashboard_id, default_dashboard_id FROM user_dashboard_preferences')).rows[0];
    expect(preferences).toEqual({ selected_dashboard_id: dashboards.rows[0].id, default_dashboard_id: dashboards.rows[0].id });
    expect((await db.query('SELECT body, parent_id, mentioned_user_ids FROM comments')).rows).toEqual([{ body: 'Existing discussion', parent_id: null, mentioned_user_ids: [] }]);
  } finally { await db.close(); }
}, 30_000);
