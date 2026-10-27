-- Usernames unique regardless of case (audit A-05). users_username_unique is case-sensitive while
-- single sign-on matches lower(username) = e-mail, so "Bob@x" and "bob@x" made linking arbitrary.
-- Fails, listing the clashes, if such pairs exist: rename or merge them, then run the migration again.
DO $$
DECLARE clashes text;
BEGIN
  SELECT string_agg(k || ' => ' || names, '; ') INTO clashes FROM (
    SELECT lower(username) AS k, string_agg(username || ' (id ' || id || ')', ', ') AS names
    FROM users GROUP BY lower(username) HAVING count(*) > 1
  ) d;
  IF clashes IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot make usernames case-insensitively unique; duplicates by lower(username): %', clashes;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_lower_unique" ON "users" (lower("username"));
