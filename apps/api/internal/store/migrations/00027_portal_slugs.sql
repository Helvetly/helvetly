-- +goose Up
-- Each workspace's client portal lives at PORTAL_URL/w/<slug>/ (internal/portalscope). One row per slug a workspace
-- has had: the current one has no retired_at, earlier ones stay so their links redirect to the current slug, and no
-- other workspace can ever take them over.
CREATE TABLE portal_slugs (
    slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' AND char_length(slug) BETWEEN 3 AND 32),
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL,
    retired_at timestamptz
);
CREATE UNIQUE INDEX portal_slugs_current ON portal_slugs (workspace_id) WHERE retired_at IS NULL;

-- A session opened under a workspace's portal address is valid only there; false: the unscoped /login.
ALTER TABLE portal_sessions ADD COLUMN scoped boolean NOT NULL DEFAULT false;

-- Every workspace gets a slug from its name, spelled the way portalscope.FromName does it; a reserved, short or
-- repeated one gets -2, -3, … in the order the workspaces were made. The reserved list is portalscope.reserved.
-- +goose StatementBegin
DO $$
DECLARE
    w record;
    base text;
    candidate text;
    n int;
    reserved text[] := ARRAY['api', 'w', 'login', 'logout', 'assets', 'static', 'admin', 'app', 'www', 'portal',
        'help', 'support', 'status', 'docs', 'media', 'mail', 'settings', 'helvetly'];
BEGIN
    FOR w IN SELECT id, name FROM workspaces ORDER BY created_at, id LOOP
        -- Umlauts and accents are spelled out before lower(), whose idea of upper case depends on the database's
        -- locale (in "C" it leaves Ä alone).
        base := rtrim(left(btrim(regexp_replace(
            lower(translate(
                replace(replace(replace(replace(replace(replace(replace(w.name,
                    'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'Ä', 'ae'), 'Ö', 'oe'), 'Ü', 'ue'), 'ß', 'ss'),
                'àáâãåèéêëìíîïòóôõùúûýÿçñÀÁÂÃÅÈÉÊËÌÍÎÏÒÓÔÕÙÚÛÝÇÑ',
                'aaaaaeeeeiiiiooooouuuyycnaaaaaeeeeiiiiooooouuuycn')),
            '[^a-z0-9]+', '-', 'g'), '-'), 28), '-');
        IF char_length(base) < 3 THEN
            base := 'portal-' || base;
        END IF;
        base := rtrim(base, '-');
        candidate := base;
        n := 1;
        WHILE candidate = ANY (reserved) OR EXISTS (SELECT 1 FROM portal_slugs WHERE slug = candidate) LOOP
            n := n + 1;
            candidate := base || '-' || n;
        END LOOP;
        INSERT INTO portal_slugs (slug, workspace_id, created_at) VALUES (candidate, w.id, now());
    END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
ALTER TABLE portal_sessions DROP COLUMN scoped;
DROP TABLE portal_slugs;
