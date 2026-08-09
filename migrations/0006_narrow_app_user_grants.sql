-- 0003 granted app_user full DML on ALL TABLES IN SCHEMA public. Five tables have no RLS
-- policy -- users, sessions, organizations, system_settings, user_settings -- so on those
-- five the grant is the only thing standing between a tenant transaction and every other
-- tenant's rows. A probe from inside an ordinary tenant transaction bound to one
-- organization read every organization's users including their password hashes, read the
-- sessions table, and successfully moved another organization's owner into the caller's org.
--
-- No route does any of that today: every query against users in
-- server/routes/organization.routes.ts carries its own organization predicate. But that
-- makes correctness depend on remembering the predicate, which is the exact property this
-- whole feature exists to remove. Narrow the grant so a forgotten predicate is a permission
-- error rather than a silent cross-tenant read.
--
-- Deliberately NOT adding ALTER DEFAULT PRIVILEGES. A table added by a future migration gets
-- no grant, so app_user hits "permission denied" the first time anything touches it -- loud,
-- in development, before release. Auto-granting instead would mean a new table whose RLS
-- policy someone forgot is readable across every tenant, silently. Failing closed on a new
-- table is worth the one-line grant a new table then needs.

-- users: organization.routes.ts reads the member list and updates or deletes a member's row,
-- all inside withTenantTransaction. It never inserts -- registration runs on the privileged
-- handle before any tenant context exists (server/storage.ts createUser).
REVOKE ALL ON TABLE "users" FROM app_user;
--> statement-breakpoint
GRANT SELECT, UPDATE, DELETE ON TABLE "users" TO app_user;
--> statement-breakpoint

-- organizations: read by GET /api/organization. Created only during registration, on the
-- privileged handle; nothing renames or deletes one yet.
REVOKE ALL ON TABLE "organizations" FROM app_user;
--> statement-breakpoint
GRANT SELECT ON TABLE "organizations" TO app_user;
--> statement-breakpoint

-- sessions: owned entirely by the express-session store, which has its own connection and
-- never runs as app_user. Nothing in a tenant transaction has any business here.
REVOKE ALL ON TABLE "sessions" FROM app_user;
--> statement-breakpoint

-- system_settings is global by design (log level, retention) and user_settings is per-user;
-- neither is org-scoped, and both are served today by handlers still on the privileged
-- handle. If either is ever moved into a tenant transaction it will fail loudly here, which
-- is the right prompt to think about what scoping it should have.
REVOKE ALL ON TABLE "system_settings" FROM app_user;
--> statement-breakpoint
REVOKE ALL ON TABLE "user_settings" FROM app_user;
