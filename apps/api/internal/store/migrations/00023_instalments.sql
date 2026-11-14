-- +goose Up
-- Instalments (docs/invoices-contract.md "Instalments", "Instalment plans", "Reminders"): a schedule on one invoice,
-- plans that issue one partial invoice per instalment, the reminders sent once per key, and VAT exemption codes on lines.
-- The instalments settings live in invoice_settings.settings (the "instalments" object).

ALTER TABLE invoices ADD COLUMN instalment_interval text
    CHECK (instalment_interval IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'));
ALTER TABLE invoices ADD COLUMN reminders_enabled boolean NOT NULL DEFAULT true;

-- Only the amounts are stored; effective, paid and open are derived on read.
CREATE TABLE invoice_instalments (
    invoice_id text NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
    seq        integer NOT NULL CHECK (seq > 0),
    due_date   date NOT NULL,
    amount     bigint NOT NULL,
    reference  text, -- QRR/SCOR of this instalment, set on issue
    PRIMARY KEY (invoice_id, seq)
);

CREATE TABLE instalment_plans (
    id                  text PRIMARY KEY,
    workspace_id        text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    source_invoice_id   text NOT NULL REFERENCES invoices (id),
    client_id           text NOT NULL REFERENCES clients (id),
    count               integer NOT NULL CHECK (count BETWEEN 2 AND 12),
    instalment_interval text NOT NULL CHECK (instalment_interval IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
    first_due_date      date NOT NULL,
    lead_days           integer NOT NULL CHECK (lead_days >= 0),
    auto_send           boolean NOT NULL,
    status              text NOT NULL CHECK (status IN ('active', 'paused', 'cancelled', 'done')),
    reminders_enabled   boolean NOT NULL DEFAULT true,
    created_by          text REFERENCES users (id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL
);
CREATE INDEX instalment_plans_workspace ON instalment_plans (workspace_id, client_id);
CREATE INDEX instalment_plans_source ON instalment_plans (source_invoice_id);

CREATE TABLE instalment_plan_items (
    plan_id    text NOT NULL REFERENCES instalment_plans (id) ON DELETE CASCADE,
    seq        integer NOT NULL CHECK (seq > 0),
    due_date   date NOT NULL,
    issue_on   date NOT NULL,
    invoice_id text REFERENCES invoices (id),
    issued_at  timestamptz,
    PRIMARY KEY (plan_id, seq)
);
CREATE INDEX instalment_plan_items_due ON instalment_plan_items (issue_on) WHERE invoice_id IS NULL;

ALTER TABLE invoices ADD COLUMN plan_id text REFERENCES instalment_plans (id);
ALTER TABLE invoices ADD COLUMN plan_seq integer;

-- One row per reminder sent: the primary key makes each (target, instalment, kind, offset) go out once.
CREATE TABLE reminder_log (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    target_id    text NOT NULL,
    seq          integer NOT NULL,
    kind         text NOT NULL CHECK (kind IN ('before', 'after')),
    offset_days  integer NOT NULL,
    sent_at      timestamptz NOT NULL,
    PRIMARY KEY (target_id, seq, kind, offset_days)
);

ALTER TABLE invoice_lines ADD COLUMN vat_exemption_code text;
ALTER TABLE invoice_lines ADD COLUMN vat_exemption_reason text;

-- +goose Down
ALTER TABLE invoice_lines DROP COLUMN vat_exemption_reason;
ALTER TABLE invoice_lines DROP COLUMN vat_exemption_code;
DROP TABLE reminder_log;
ALTER TABLE invoices DROP COLUMN plan_seq;
ALTER TABLE invoices DROP COLUMN plan_id;
DROP TABLE instalment_plan_items;
DROP TABLE instalment_plans;
DROP TABLE invoice_instalments;
ALTER TABLE invoices DROP COLUMN reminders_enabled;
ALTER TABLE invoices DROP COLUMN instalment_interval;
