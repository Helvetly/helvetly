-- Optional approval before a document is issued (internal/approvals). Groups of approvers per workspace, a policy
-- per document type (enabled, an optional minimum total, rules that must all hold: at least min approvals from a
-- group, or from anyone eligible when group_id is null), and the requests: at most one pending or approved request
-- per document, whose rules are a snapshot of the policy at submit. A decision is one per person and request, and
-- keeps the approver's groups at that moment. doc_id is not a foreign key: the types live in several tables, and
-- deleting a draft deletes its requests in the same transaction.
--
-- The plan feature document_approvals (Business only) joins every published offer's values (no workspace loses
-- anything) and helvetly-v1.4, helvetly-v1.3 with its record, goes on sale.

-- +goose Up
CREATE TABLE approval_groups (
    id           text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL
);
CREATE UNIQUE INDEX approval_groups_name ON approval_groups (workspace_id, lower(name));

CREATE TABLE approval_group_members (
    group_id     text NOT NULL REFERENCES approval_groups (id) ON DELETE CASCADE,
    workspace_id text NOT NULL,
    user_id      text NOT NULL,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE
);
CREATE INDEX approval_group_members_user ON approval_group_members (workspace_id, user_id);

CREATE TABLE approval_policies (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    doc_type     text NOT NULL CHECK (doc_type IN ('invoice', 'credit_note', 'debit_note', 'corrected')),
    enabled      boolean NOT NULL,
    min_total    numeric(18, 2) CHECK (min_total >= 0),
    rules        jsonb NOT NULL DEFAULT '[]',
    updated_by   text NOT NULL,
    updated_at   timestamptz NOT NULL,
    PRIMARY KEY (workspace_id, doc_type)
);

CREATE TABLE approval_requests (
    id           text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    doc_type     text NOT NULL,
    doc_id       text NOT NULL,
    status       text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'reset')),
    rules        jsonb NOT NULL,
    submitted_by text NOT NULL,
    submitted_at timestamptz NOT NULL,
    ended_by     text,
    ended_at     timestamptz,
    comment      text CHECK (char_length(comment) <= 1000)
);
CREATE INDEX approval_requests_doc ON approval_requests (workspace_id, doc_id, submitted_at);
CREATE UNIQUE INDEX approval_requests_open ON approval_requests (doc_id) WHERE status IN ('pending', 'approved');
CREATE INDEX approval_requests_pending ON approval_requests (workspace_id) WHERE status = 'pending';

CREATE TABLE approval_decisions (
    request_id text NOT NULL REFERENCES approval_requests (id) ON DELETE CASCADE,
    user_id    text NOT NULL,
    decision   text NOT NULL CHECK (decision IN ('approve', 'reject')),
    group_ids  text[] NOT NULL DEFAULT '{}',
    comment    text CHECK (char_length(comment) <= 1000),
    at         timestamptz NOT NULL,
    PRIMARY KEY (request_id, user_id)
);

INSERT INTO limits (key, kind, unit, scope, period, requires_features, allow_unlimited, position, description)
SELECT 'document_approvals', 'access', 'boolean', 'workspace', NULL, '{}'::text[], true, max(position) + 1,
    'Approval by team members before a document is issued'
FROM limits;

-- Values join an offer only when it is published, so the guard is lifted for this one addition.
ALTER TABLE limit_plans DISABLE TRIGGER limit_plans_published_now;
INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
SELECT offer_id, plan_id, 'document_approvals', CASE plan_id WHEN 'business' THEN 'enabled' ELSE 'disabled' END, NULL, 0
FROM limit_plans WHERE limit_key = 'custom_portal_domain';
ALTER TABLE limit_plans ENABLE TRIGGER limit_plans_published_now;

-- helvetly-v1.4: helvetly-v1.3 with the record last. Its checksum is Offer.Checksum of this document.
INSERT INTO offer_versions (id, schema_version, checksum, published_at, document)
SELECT 'helvetly-v1.4', schema_version, 'c893d2ea0959e7417d468097c35aa14363061b6383d868ea46ec80e07ea8c995', now(),
    jsonb_set(jsonb_set(document, '{offer_id}', '"helvetly-v1.4"'), '{records}', document->'records' || jsonb_build_array(jsonb_build_object(
        'key', 'document_approvals', 'type', 'access', 'unit', 'boolean', 'scope', 'workspace', 'period', NULL,
        'requires_features', jsonb_build_array(),
        'values', jsonb_build_object('basic', jsonb_build_object('state', 'disabled'), 'business', jsonb_build_object('state', 'enabled'),
            'pro', jsonb_build_object('state', 'disabled')))))
FROM offer_versions WHERE id = 'helvetly-v1.3';

INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
SELECT 'helvetly-v1.4', plan_id, limit_key, state, value, per_additional_paid_seat FROM limit_plans WHERE offer_id = 'helvetly-v1.3';

-- +goose Down
-- Published rows refuse changes; a rollback is the one time they may be removed.
UPDATE billing_checkouts SET offer_id = 'helvetly-v1.3' WHERE offer_id = 'helvetly-v1.4';
UPDATE workspace_billing SET offer_id = 'helvetly-v1.3' WHERE offer_id = 'helvetly-v1.4';
DELETE FROM limit_workspaces WHERE offer_id = 'helvetly-v1.4' OR limit_key = 'document_approvals';
ALTER TABLE limit_plans DISABLE TRIGGER limit_plans_immutable;
ALTER TABLE offer_versions DISABLE TRIGGER offer_versions_immutable;
DELETE FROM limit_plans WHERE offer_id = 'helvetly-v1.4' OR limit_key = 'document_approvals';
DELETE FROM offer_versions WHERE id = 'helvetly-v1.4';
ALTER TABLE offer_versions ENABLE TRIGGER offer_versions_immutable;
ALTER TABLE limit_plans ENABLE TRIGGER limit_plans_immutable;
DELETE FROM limits WHERE key = 'document_approvals';
DROP TABLE approval_decisions;
DROP TABLE approval_requests;
DROP TABLE approval_policies;
DROP TABLE approval_group_members;
DROP TABLE approval_groups;
