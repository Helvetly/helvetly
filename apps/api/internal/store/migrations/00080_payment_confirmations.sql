-- Payment confirmations: the email that tells a client a payment on its invoice arrived. A row is queued in the
-- payment's own transaction (one per payment, never two) and sent by a job once that commits; a deleted payment takes
-- its unsent row with it. Deliveries now say what they were, so the Emails tab tells a confirmation from the invoice.

-- +goose Up
CREATE TABLE payment_confirmations (
    payment_id text PRIMARY KEY REFERENCES invoice_payments(id) ON DELETE CASCADE,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    invoice_id text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    recorded_by text REFERENCES users(id) ON DELETE SET NULL,
    open bigint NOT NULL,
    next_amount bigint,
    next_due date,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'uncertain', 'sent', 'skipped', 'failed')),
    attempts integer NOT NULL DEFAULT 0,
    retry_at timestamptz, -- a refused send waits until then
    created_at timestamptz NOT NULL
);
CREATE INDEX payment_confirmations_pending ON payment_confirmations(created_at) WHERE state = 'pending';

ALTER TABLE invoice_deliveries ADD COLUMN kind text NOT NULL DEFAULT 'invoice'
    CHECK (kind IN ('invoice', 'payment_confirmation'));

ALTER TABLE email_templates DROP CONSTRAINT email_templates_kind_check,
    ADD CONSTRAINT email_templates_kind_check
        CHECK (kind IN ('invoice', 'credit_note', 'proforma', 'quote', 'document', 'signature_request', 'signature_reminder',
            'payment_confirmation'));

-- +goose Down
DELETE FROM email_templates WHERE kind = 'payment_confirmation';
ALTER TABLE email_templates DROP CONSTRAINT email_templates_kind_check,
    ADD CONSTRAINT email_templates_kind_check
        CHECK (kind IN ('invoice', 'credit_note', 'proforma', 'quote', 'document', 'signature_request', 'signature_reminder'));
DELETE FROM invoice_deliveries WHERE kind = 'payment_confirmation';
ALTER TABLE invoice_deliveries DROP COLUMN kind;
DROP TABLE payment_confirmations;
