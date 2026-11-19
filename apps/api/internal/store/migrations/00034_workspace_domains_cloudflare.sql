-- Custom portal domains through Cloudflare for SaaS again (00033 had moved them to DNS proof and on-demand
-- certificates at the origin; neither was released). The customer adds a CNAME to CUSTOM_DOMAIN_TARGET and the TXT
-- record Cloudflare names for the custom hostname (ownership_name, ownership_value), which the app checks itself
-- before the domain may go active (verified_at, kept from 00033). cf_hostname_id is the custom hostname on the zone,
-- kept on a removed row so the cleanup can tell a hostname the app created from one someone else did; cf_status and
-- ssl_status are Cloudflare's own words from the last check.

-- +goose Up
ALTER TABLE workspace_domains
    ADD COLUMN cf_hostname_id  text,
    ADD COLUMN cf_status       text NOT NULL DEFAULT '',
    ADD COLUMN ssl_status      text NOT NULL DEFAULT '',
    ADD COLUMN ownership_name  text NOT NULL DEFAULT '',
    ADD COLUMN ownership_value text NOT NULL DEFAULT '';
-- The cleanup looks up one page of the zone's hostnames at a time, removed rows included; a duplicate, its id.
CREATE INDEX workspace_domains_hostname_any ON workspace_domains (hostname);
CREATE INDEX workspace_domains_cf_hostname ON workspace_domains (cf_hostname_id) WHERE cf_hostname_id IS NOT NULL;

-- +goose Down
DROP INDEX workspace_domains_hostname_any;
DROP INDEX workspace_domains_cf_hostname;
ALTER TABLE workspace_domains
    DROP COLUMN cf_hostname_id,
    DROP COLUMN cf_status,
    DROP COLUMN ssl_status,
    DROP COLUMN ownership_name,
    DROP COLUMN ownership_value;
