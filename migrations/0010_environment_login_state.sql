-- Saved browser session per environment, so a test does not have to log in through the UI.
--
-- Without this, every test spends its first thirty seconds authenticating, and then fails
-- for reasons that have nothing to do with what it checks: the login form changed, SSO was
-- slow, the account got locked by the previous run. On DMO, where a factory site sits behind
-- an authenticated Angular shell, that was most of the cost of most tests.
--
-- Encrypted with the same AES-256-GCM scheme as `secrets` rather than stored as plain JSON,
-- and for the same reason: the payload is cookies and session tokens, which are credentials
-- for the system under test. A readable column here would be a readable credential store.
-- Three columns, matching the secrets table's shape, because GCM needs the iv and the auth
-- tag alongside the ciphertext to detect tampering.
--
-- Nullable: an environment without a saved session is the normal case, and tests against it
-- simply log in the way they always did.
ALTER TABLE "environments"
  ADD COLUMN "login_state" text,
  ADD COLUMN "login_state_iv" text,
  ADD COLUMN "login_state_auth_tag" text,
  ADD COLUMN "login_state_captured_at" timestamp;
--> statement-breakpoint

-- The session it holds expires like any other. Recording when it was captured is what lets
-- a report say "this login state is three weeks old" instead of leaving a tester to guess
-- why every test suddenly fails on its first authenticated step.
COMMENT ON COLUMN "environments"."login_state_captured_at" IS
  'When the browser session was captured. The session expires on the target system''s own schedule.';
