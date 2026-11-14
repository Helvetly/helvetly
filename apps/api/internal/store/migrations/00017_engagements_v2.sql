-- +goose Up
-- Engagements v2: rollover, proration, automatic drafts, notices and the digest setting
-- (docs/engagements-contract.md).

ALTER TABLE engagements
    ADD COLUMN rollover       boolean NOT NULL DEFAULT false,
    ADD COLUMN auto_invoice   boolean NOT NULL DEFAULT false,
    ADD COLUMN invoice_detail text    NOT NULL DEFAULT 'summary' CHECK (invoice_detail IN ('summary', 'per_entry'));

ALTER TABLE engagement_periods
    ADD COLUMN natural_ends_on date,
    ADD COLUMN full_quantity   bigint,
    ADD COLUMN quantity_manual boolean NOT NULL DEFAULT false;
UPDATE engagement_periods SET natural_ends_on = ends_on, full_quantity = quantity;
ALTER TABLE engagement_periods
    ALTER COLUMN natural_ends_on SET NOT NULL,
    ALTER COLUMN full_quantity SET NOT NULL;

CREATE TABLE engagement_notices (
    id            text PRIMARY KEY,
    engagement_id text        NOT NULL REFERENCES engagements (id) ON DELETE CASCADE,
    period_id     text        NOT NULL REFERENCES engagement_periods (id) ON DELETE CASCADE,
    kind          text        NOT NULL CHECK (kind IN ('ending_soon', 'period_closed', 'draft_created', 'under_pace')),
    invoice_id    text        REFERENCES invoices (id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL,
    notified_at   timestamptz,
    UNIQUE (period_id, kind)
);
CREATE INDEX engagement_notices_pending ON engagement_notices (engagement_id) WHERE notified_at IS NULL;

CREATE TABLE engagement_settings (
    workspace_id text PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
    digest       boolean     NOT NULL DEFAULT true,
    updated_at   timestamptz NOT NULL
);

-- +goose Down
DROP TABLE engagement_settings, engagement_notices;
ALTER TABLE engagement_periods DROP COLUMN quantity_manual, DROP COLUMN full_quantity, DROP COLUMN natural_ends_on;
ALTER TABLE engagements DROP COLUMN invoice_detail, DROP COLUMN auto_invoice, DROP COLUMN rollover;
