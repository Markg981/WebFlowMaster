-- audit_log was "append-only" only through GRANT SELECT, INSERT to app_user: the proof held
-- against the application role and nothing else (audit C-41 / AZ-09 / RQ-07). This adds a
-- trigger so that UPDATE and DELETE are refused for every role, the table owner included.
--
-- Two legitimate paths stay open:
--  * the ON DELETE SET NULL on actor_user_id is executed by Postgres as an UPDATE of the row;
--    an UPDATE that changes nothing but that column, to NULL, is allowed (the entry keeps
--    actor_username).
--  * the privileged maintenance tasks (opt-in retention in data-retention.ts, organization
--    erasure) set the transaction-local GUC app.audit_maintenance = 'on' before deleting (the
--    same switch lets test fixtures age entries).
--    app_user still has no DELETE grant, so it cannot use the switch.
CREATE OR REPLACE FUNCTION audit_log_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.audit_maintenance', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit_log is append-only: DELETE refused' USING ERRCODE = '42501';
  END IF;
  IF current_setting('app.audit_maintenance', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.actor_user_id IS NULL
     AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only: UPDATE refused' USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_guard
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
