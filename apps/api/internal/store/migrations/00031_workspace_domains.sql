-- Client portal phase 2: a workspace's portal on its own host (portal.firma.ch), through Cloudflare for SaaS custom
-- hostnames (internal/customdomains). One row per domain a workspace added; a removed one stays for the record. A
-- hostname belongs to one workspace at a time, and a workspace has one domain at a time, among rows not removed.
-- status: pending (waiting for DNS or the certificate), active (served), failed (Cloudflare refused it, it timed out
-- or an active one broke; checked again daily), removed. problem is why it is not active (a code), detail Cloudflare's own words.
-- cf_status and ssl_status are Cloudflare's own words, records
-- the DNS records the settings show ([{type, name, value}]).
--
-- The plan feature custom_portal_domain (Business only) joins every published offer's values (no workspace loses
-- anything) and helvetly-v1.3, helvetly-v1.2 with its record, goes on sale.

-- +goose Up
CREATE TABLE workspace_domains (
    id              text PRIMARY KEY,
    workspace_id    text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    hostname        text NOT NULL CHECK (hostname = lower(hostname) AND char_length(hostname) BETWEEN 4 AND 253),
    cf_hostname_id  text,
    status          text NOT NULL CHECK (status IN ('pending', 'active', 'failed', 'removed')),
    cf_status       text NOT NULL DEFAULT '',
    ssl_status      text NOT NULL DEFAULT '',
    problem         text NOT NULL DEFAULT '',
    detail          text NOT NULL DEFAULT '',
    records         jsonb NOT NULL DEFAULT '[]',
    checks          integer NOT NULL DEFAULT 0,
    next_check_at   timestamptz NOT NULL,
    last_checked_at timestamptz,
    created_by      text NOT NULL,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    removed_at      timestamptz
);
CREATE UNIQUE INDEX workspace_domains_hostname ON workspace_domains (hostname) WHERE status <> 'removed';
CREATE UNIQUE INDEX workspace_domains_workspace ON workspace_domains (workspace_id) WHERE status <> 'removed';
CREATE INDEX workspace_domains_due ON workspace_domains (next_check_at) WHERE status <> 'removed';

INSERT INTO limits (key, kind, unit, scope, period, requires_features, allow_unlimited, position, description)
SELECT 'custom_portal_domain', 'access', 'boolean', 'workspace', NULL, '{client_portal}'::text[], true, max(position) + 1,
    'The client portal on the workspace''s own domain'
FROM limits;

-- Values join an offer only when it is published, so the guard is lifted for this one addition.
ALTER TABLE limit_plans DISABLE TRIGGER limit_plans_published_now;
INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
SELECT offer_id, plan_id, 'custom_portal_domain', CASE plan_id WHEN 'business' THEN 'enabled' ELSE 'disabled' END, NULL, 0
FROM limit_plans WHERE limit_key = 'client_portal';
ALTER TABLE limit_plans ENABLE TRIGGER limit_plans_published_now;

-- helvetly-v1.3: helvetly-v1.2 with the record last. Its checksum is Offer.Checksum of this document.
INSERT INTO offer_versions (id, schema_version, checksum, published_at, document)
SELECT 'helvetly-v1.3', schema_version, 'f22b1f76f927e66790b097fe864e8ffe9e35c60c09664b5c5f6fe926391fc0cd', now(),
    jsonb_set(jsonb_set(document, '{offer_id}', '"helvetly-v1.3"'), '{records}', document->'records' || jsonb_build_array(jsonb_build_object(
        'key', 'custom_portal_domain', 'type', 'access', 'unit', 'boolean', 'scope', 'workspace', 'period', NULL,
        'requires_features', jsonb_build_array('client_portal'),
        'values', jsonb_build_object('basic', jsonb_build_object('state', 'disabled'), 'business', jsonb_build_object('state', 'enabled'),
            'pro', jsonb_build_object('state', 'disabled')))))
FROM offer_versions WHERE id = 'helvetly-v1.2';

INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
SELECT 'helvetly-v1.3', plan_id, limit_key, state, value, per_additional_paid_seat FROM limit_plans WHERE offer_id = 'helvetly-v1.2';

INSERT INTO offer_audit (actor, action, target, after, reason)
VALUES ('migration 00031', 'offer.publish', 'helvetly-v1.3', jsonb_build_object('offer_id', 'helvetly-v1.3', 'checksum', 'f22b1f76f927e66790b097fe864e8ffe9e35c60c09664b5c5f6fe926391fc0cd'),
    'Business gets the client portal on its own domain, approved by the owner');

-- +goose Down
-- Published rows refuse changes; a rollback is the one time they may be removed.
UPDATE billing_checkouts SET offer_id = 'helvetly-v1.2' WHERE offer_id = 'helvetly-v1.3';
UPDATE workspace_billing SET offer_id = 'helvetly-v1.2' WHERE offer_id = 'helvetly-v1.3';
DELETE FROM limit_workspaces WHERE offer_id = 'helvetly-v1.3' OR limit_key = 'custom_portal_domain';
ALTER TABLE limit_plans DISABLE TRIGGER limit_plans_immutable;
ALTER TABLE offer_versions DISABLE TRIGGER offer_versions_immutable;
DELETE FROM limit_plans WHERE offer_id = 'helvetly-v1.3' OR limit_key = 'custom_portal_domain';
DELETE FROM offer_versions WHERE id = 'helvetly-v1.3';
ALTER TABLE offer_versions ENABLE TRIGGER offer_versions_immutable;
ALTER TABLE limit_plans ENABLE TRIGGER limit_plans_immutable;
DELETE FROM limits WHERE key = 'custom_portal_domain';
DROP TABLE workspace_domains;
