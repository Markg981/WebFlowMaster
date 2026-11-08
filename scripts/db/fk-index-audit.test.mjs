import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMigrations, findUnindexed } from './fk-index-audit-core.mjs';

const sql = `
-- comment with an apostrophe: it's fine
CREATE TABLE "parents" ("id" serial PRIMARY KEY NOT NULL);
CREATE TABLE "kids" (
  "id" serial PRIMARY KEY NOT NULL,
  "parent_id" integer REFERENCES "parents"("id") ON DELETE CASCADE,
  "owner_id" integer REFERENCES "public"."parents"("id"),
  "slug_id" integer REFERENCES "parents"("id"),
  "org_id" integer,
  "other_id" integer,
  CONSTRAINT "kids_org_fk" FOREIGN KEY ("other_id", "org_id") REFERENCES "parents"("id", "org_id"),
  UNIQUE ("slug_id", "org_id")
);
CREATE INDEX "kids_parent_idx" ON "kids" USING btree ("parent_id");
ALTER TABLE "kids" ADD COLUMN "late_id" integer REFERENCES "parents"("id") ON DELETE SET NULL;
ALTER TABLE "kids" ADD CONSTRAINT "kids_x_fk" FOREIGN KEY ("org_id") REFERENCES "parents"("id");
CREATE INDEX IF NOT EXISTS "kids_late_idx" ON "kids" ("org_id", "late_id");
`;

test('lists FK columns without a leading index', () => {
  const missing = findUnindexed(parseMigrations([{ name: '0001.sql', sql }]));
  const names = missing.map((m) => `${m.table}.${m.cols.join('+')}`).sort();
  // parent_id: index; slug_id: leading column of the unique; org_id: leading column of kids_late_idx
  assert.deepEqual(names, ['kids.late_id', 'kids.other_id+org_id', 'kids.owner_id']);
});

test('records the delete action and honours DROP INDEX', () => {
  const parsed = parseMigrations([
    { name: 'a.sql', sql },
    { name: 'b.sql', sql: 'DROP INDEX "kids_parent_idx";' },
  ]);
  const m = findUnindexed(parsed).find((f) => f.cols[0] === 'parent_id');
  assert.equal(m?.onDelete, 'cascade');
});
