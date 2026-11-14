-- +goose Up
-- The payment methods chosen per invoice (docs/invoices-contract.md), and the Revolut link frozen on issue.
ALTER TABLE invoices
    ADD COLUMN pay_qr_bill boolean NOT NULL DEFAULT false,
    ADD COLUMN pay_revolut boolean NOT NULL DEFAULT false,
    ADD COLUMN revolut_url text;

-- Keep what each document had or would have had: issued ones their QR bill, drafts the QR bill their
-- currency and IBAN allowed.
UPDATE invoices SET pay_qr_bill = qr_bill WHERE status <> 'draft';
UPDATE invoices i SET pay_qr_bill = true
    WHERE i.status = 'draft' AND i.kind = 'invoice' AND i.currency IN ('CHF', 'EUR')
      AND coalesce((SELECT left(s.settings ->> 'iban', 2) FROM invoice_settings s WHERE s.workspace_id = i.workspace_id),
                   'CH') IN ('CH', 'LI');

-- +goose Down
ALTER TABLE invoices DROP COLUMN pay_qr_bill, DROP COLUMN pay_revolut, DROP COLUMN revolut_url;
