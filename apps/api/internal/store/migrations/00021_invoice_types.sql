-- +goose Up
-- Document types (docs/invoices-contract.md "Document types"): kind gains partial, prepayment, debit_note,
-- corrected, proforma and self_billed; counters get a series; prepayments are deducted from a final invoice.

ALTER TABLE invoices DROP CONSTRAINT invoices_kind_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_kind_check CHECK (kind IN
    ('invoice', 'partial', 'prepayment', 'debit_note', 'corrected', 'credit_note', 'proforma', 'self_billed'));
ALTER TABLE invoices DROP CONSTRAINT invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN ('draft', 'open', 'paid', 'void', 'replaced'));
ALTER TABLE invoice_counters DROP CONSTRAINT invoice_counters_kind_check;
ALTER TABLE invoice_counters ADD CONSTRAINT invoice_counters_kind_check CHECK (kind IN
    ('invoice', 'credit_note', 'proforma', 'self_billed'));

ALTER TABLE invoices ADD COLUMN prepaid_total bigint NOT NULL DEFAULT 0; -- Σ payable of the deducted prepayments
ALTER TABLE invoices ADD COLUMN deducted_on_invoice_id text REFERENCES invoices (id); -- prepayment: the final invoice

CREATE TABLE invoice_prepayments (
    invoice_id    text NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
    prepayment_id text NOT NULL REFERENCES invoices (id),
    position      integer NOT NULL,
    PRIMARY KEY (invoice_id, prepayment_id)
);

-- +goose Down
DROP TABLE invoice_prepayments;
ALTER TABLE invoices DROP COLUMN deducted_on_invoice_id;
ALTER TABLE invoices DROP COLUMN prepaid_total;
ALTER TABLE invoice_counters DROP CONSTRAINT invoice_counters_kind_check;
ALTER TABLE invoice_counters ADD CONSTRAINT invoice_counters_kind_check CHECK (kind IN ('invoice', 'credit_note'));
ALTER TABLE invoices DROP CONSTRAINT invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN ('draft', 'open', 'paid', 'void'));
ALTER TABLE invoices DROP CONSTRAINT invoices_kind_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_kind_check CHECK (kind IN ('invoice', 'credit_note'));
