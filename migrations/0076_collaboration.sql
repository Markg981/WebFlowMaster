ALTER TABLE comments
  ADD COLUMN parent_id integer REFERENCES comments(id) ON DELETE CASCADE,
  ADD COLUMN mentioned_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN resolved_at timestamp,
  ADD COLUMN resolved_by integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN deleted_at timestamp;
--> statement-breakpoint
ALTER TABLE comments ADD CONSTRAINT comments_id_organization_unique UNIQUE (id, organization_id);
--> statement-breakpoint
ALTER TABLE comments ADD CONSTRAINT comments_parent_id_same_org_fk
  FOREIGN KEY (parent_id, organization_id) REFERENCES comments(id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE comments ADD CONSTRAINT comments_resolved_by_same_org_fk
  FOREIGN KEY (resolved_by, organization_id) REFERENCES users(id, organization_id);
--> statement-breakpoint
ALTER TABLE comments DROP CONSTRAINT comments_body_length;
--> statement-breakpoint
ALTER TABLE comments ADD CONSTRAINT comments_body_length CHECK (
  (deleted_at IS NULL AND length(btrim(body)) BETWEEN 1 AND 5000)
  OR (deleted_at IS NOT NULL AND body = '' AND mentioned_user_ids = '[]'::jsonb)
);
--> statement-breakpoint
ALTER TABLE comments ADD CONSTRAINT comments_only_root_resolved CHECK (
  parent_id IS NULL OR (resolved_at IS NULL AND resolved_by IS NULL)
);
--> statement-breakpoint
CREATE INDEX comments_parent_idx ON comments(parent_id);
--> statement-breakpoint
CREATE FUNCTION validate_comment_conversation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent comments%ROWTYPE; mention jsonb; recipient integer; seen integer[] := '{}';
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
    OR NEW.ui_test_id IS DISTINCT FROM OLD.ui_test_id
    OR NEW.api_test_id IS DISTINCT FROM OLD.api_test_id
    OR NEW.mobile_test_id IS DISTINCT FROM OLD.mobile_test_id
    OR NEW.result_id IS DISTINCT FROM OLD.result_id
  ) THEN
    RAISE EXCEPTION 'Conversation target and parent are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO parent FROM comments WHERE id = NEW.parent_id FOR UPDATE;
    IF NOT FOUND OR parent.parent_id IS NOT NULL OR parent.id = NEW.id
      OR parent.organization_id <> NEW.organization_id
      OR parent.ui_test_id IS DISTINCT FROM NEW.ui_test_id
      OR parent.api_test_id IS DISTINCT FROM NEW.api_test_id
      OR parent.mobile_test_id IS DISTINCT FROM NEW.mobile_test_id
      OR parent.result_id IS DISTINCT FROM NEW.result_id THEN
      RAISE EXCEPTION 'Replies must reference a root on the same target and organization' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' AND (parent.resolved_at IS NOT NULL OR parent.deleted_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Cannot reply to a closed conversation' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF jsonb_typeof(NEW.mentioned_user_ids) <> 'array' THEN
    RAISE EXCEPTION 'Mentions must be an array' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(NEW.mentioned_user_ids) > 20 THEN
    RAISE EXCEPTION 'Too many mentions' USING ERRCODE = '23514';
  END IF;
  FOR mention IN SELECT value FROM jsonb_array_elements(NEW.mentioned_user_ids) LOOP
    IF jsonb_typeof(mention) <> 'number' OR mention::text !~ '^[1-9][0-9]{0,9}$'
      OR (mention::text)::numeric > 2147483647 THEN
      RAISE EXCEPTION 'Mention IDs must be positive integers' USING ERRCODE = '23514';
    END IF;
    recipient := (mention::text)::integer;
    IF recipient = ANY(seen) OR (NOT EXISTS (
      SELECT 1 FROM users WHERE id = recipient AND organization_id = NEW.organization_id
    ) AND NOT (TG_OP = 'UPDATE' AND OLD.mentioned_user_ids @> jsonb_build_array(recipient))) THEN
      RAISE EXCEPTION 'Mentions must identify distinct members of this organization' USING ERRCODE = '23514';
    END IF;
    seen := array_append(seen, recipient);
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER comments_conversation_guard BEFORE INSERT OR UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION validate_comment_conversation();
--> statement-breakpoint
CREATE TABLE dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  creator_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'organization')),
  widgets jsonb NOT NULL CHECK (jsonb_typeof(widgets) = 'array' AND jsonb_array_length(widgets) BETWEEN 0 AND 20),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  CONSTRAINT dashboards_creator_id_same_org_fk FOREIGN KEY (creator_id, organization_id)
    REFERENCES users(id, organization_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX dashboards_organization_idx ON dashboards(organization_id);
--> statement-breakpoint
ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dashboards FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY dashboard_read ON dashboards FOR SELECT USING (
  organization_id = NULLIF(current_setting('app.current_org', true), '')::integer
  AND (app_principal_id() IS NULL OR creator_id = app_principal_id() OR visibility = 'organization')
);
--> statement-breakpoint
CREATE POLICY dashboard_create ON dashboards FOR INSERT WITH CHECK (
  organization_id = NULLIF(current_setting('app.current_org', true), '')::integer
  AND (app_principal_id() IS NULL OR creator_id = app_principal_id())
);
--> statement-breakpoint
CREATE POLICY dashboard_update ON dashboards FOR UPDATE USING (
  organization_id = NULLIF(current_setting('app.current_org', true), '')::integer
  AND (app_principal_id() IS NULL OR creator_id = app_principal_id()
    OR (visibility = 'organization' AND current_setting('app.current_user_role', true) = 'owner'))
) WITH CHECK (
  organization_id = NULLIF(current_setting('app.current_org', true), '')::integer
  AND (app_principal_id() IS NULL OR creator_id = app_principal_id()
    OR (visibility = 'organization' AND current_setting('app.current_user_role', true) = 'owner'))
);
--> statement-breakpoint
CREATE POLICY dashboard_delete ON dashboards FOR DELETE USING (
  organization_id = NULLIF(current_setting('app.current_org', true), '')::integer
  AND (app_principal_id() IS NULL OR creator_id = app_principal_id()
    OR (visibility = 'organization' AND current_setting('app.current_user_role', true) = 'owner'))
);
--> statement-breakpoint
CREATE FUNCTION dashboard_ownership_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.creator_id IS DISTINCT FROM OLD.creator_id THEN
    RAISE EXCEPTION 'Dashboard ownership is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dashboard_ownership_guard BEFORE UPDATE ON dashboards
  FOR EACH ROW EXECUTE FUNCTION dashboard_ownership_immutable();
--> statement-breakpoint
CREATE TABLE user_dashboard_preferences (
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selected_dashboard_id uuid REFERENCES dashboards(id) ON DELETE SET NULL,
  default_dashboard_id uuid REFERENCES dashboards(id) ON DELETE SET NULL,
  updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  CONSTRAINT user_dashboard_preferences_user_id_same_org_fk FOREIGN KEY (user_id, organization_id)
    REFERENCES users(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT user_dashboard_preferences_selected_dashboard_id_same_org_fk FOREIGN KEY (selected_dashboard_id, organization_id)
    REFERENCES dashboards(id, organization_id),
  CONSTRAINT user_dashboard_preferences_default_dashboard_id_same_org_fk FOREIGN KEY (default_dashboard_id, organization_id)
    REFERENCES dashboards(id, organization_id)
);
--> statement-breakpoint
ALTER TABLE user_dashboard_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_dashboard_preferences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY personal_dashboard_preferences ON user_dashboard_preferences USING (
  organization_id = NULLIF(current_setting('app.current_org', true), '')::integer
  AND (app_principal_id() IS NULL OR user_id = app_principal_id())
) WITH CHECK (
  organization_id = NULLIF(current_setting('app.current_org', true), '')::integer
  AND (app_principal_id() IS NULL OR user_id = app_principal_id())
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON dashboards, user_dashboard_preferences TO app_user;
--> statement-breakpoint
-- Existing saved layouts become the same member's private initial dashboard.
DO $$
DECLARE layout user_dashboard_layouts%ROWTYPE; dashboard_id uuid; converted jsonb;
BEGIN
  FOR layout IN SELECT * FROM user_dashboard_layouts LOOP
    SELECT jsonb_agg(jsonb_build_object(
      'id', item->>'id', 'type', item->>'id', 'visible', item->'visible',
      'width', CASE WHEN item->>'id' IN ('status', 'trend') THEN 'half' ELSE 'full' END,
      'config', '{}'::jsonb
    ) ORDER BY ordinal) INTO converted FROM jsonb_array_elements(layout.widgets) WITH ORDINALITY AS e(item, ordinal);
    INSERT INTO dashboards (organization_id, creator_id, name, visibility, widgets)
      VALUES (layout.organization_id, layout.user_id, 'My dashboard', 'private', converted) RETURNING id INTO dashboard_id;
    INSERT INTO user_dashboard_preferences (organization_id, user_id, selected_dashboard_id, default_dashboard_id)
      VALUES (layout.organization_id, layout.user_id, dashboard_id, dashboard_id);
  END LOOP;
END;
$$;
