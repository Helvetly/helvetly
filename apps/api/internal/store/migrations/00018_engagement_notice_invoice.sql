-- +goose Up
-- A period can get both an advance and a usage draft: draft_created is unique per period and invoice.
ALTER TABLE engagement_notices DROP CONSTRAINT engagement_notices_period_id_kind_key;
CREATE UNIQUE INDEX engagement_notices_once ON engagement_notices (period_id, kind, coalesce(invoice_id, ''));

-- +goose Down
DROP INDEX engagement_notices_once;
ALTER TABLE engagement_notices ADD CONSTRAINT engagement_notices_period_id_kind_key UNIQUE (period_id, kind);
