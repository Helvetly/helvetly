-- Custom portal domains without Cloudflare for SaaS: the origin's Caddy issues each domain's certificate on demand
-- (asking /api/v1/public/portal/domain-check), and the app checks the domain's DNS itself: a CNAME to
-- CUSTOM_DOMAIN_TARGET and, once, the TXT record _helvetly-verify.<host> that proves the workspace owns it
-- (verified_at). Cloudflare's columns go; the DNS records are derived, not stored. status_since dates the current
-- status: a domain pending or failed for 14 days is released. The feature was never turned on, so no row has data
-- worth keeping from Cloudflare.

-- +goose Up
ALTER TABLE workspace_domains
    DROP COLUMN cf_hostname_id,
    DROP COLUMN cf_status,
    DROP COLUMN ssl_status,
    DROP COLUMN records,
    ADD COLUMN verified_at timestamptz,
    ADD COLUMN status_since timestamptz;
UPDATE workspace_domains SET status_since = updated_at;
ALTER TABLE workspace_domains ALTER COLUMN status_since SET NOT NULL;

-- +goose Down
ALTER TABLE workspace_domains
    DROP COLUMN verified_at,
    DROP COLUMN status_since,
    ADD COLUMN cf_hostname_id text,
    ADD COLUMN cf_status text NOT NULL DEFAULT '',
    ADD COLUMN ssl_status text NOT NULL DEFAULT '',
    ADD COLUMN records jsonb NOT NULL DEFAULT '[]';
