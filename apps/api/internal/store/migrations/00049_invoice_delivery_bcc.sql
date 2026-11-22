-- A send's hidden copies (Bcc) are kept with its delivery beside To and Cc.

-- +goose Up
ALTER TABLE invoice_deliveries ADD COLUMN bcc text[] DEFAULT '{}'::text[] NOT NULL;

-- +goose Down
ALTER TABLE invoice_deliveries DROP COLUMN bcc;
