-- +goose Up
-- Refunds of an invoice's credit balance (payments + credit notes above what it was worth), recorded like
-- payments: immutable, deleted only by owners and admins (internal/invoices).

ALTER TABLE invoices ADD COLUMN amount_refunded bigint NOT NULL DEFAULT 0; -- Σ refunds, kept with the balance

CREATE TABLE invoice_refunds (
    id          text PRIMARY KEY,
    invoice_id  text NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
    amount      bigint NOT NULL CHECK (amount > 0),
    refunded_on date NOT NULL,
    method      text NOT NULL CHECK (method IN ('bank_transfer', 'cash', 'card', 'twint', 'other')),
    note        text,
    created_by  text REFERENCES users (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL
);
CREATE INDEX invoice_refunds_invoice ON invoice_refunds (invoice_id, refunded_on);

-- +goose Down
DROP TABLE invoice_refunds;
ALTER TABLE invoices DROP COLUMN amount_refunded;
