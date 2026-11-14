-- +goose Up
-- Where the supplier charged its VAT: only Swiss (and Liechtenstein) VAT is reclaimable as Swiss input tax.
ALTER TABLE expenses ADD COLUMN supplier_country text NOT NULL DEFAULT 'CH';

-- +goose Down
ALTER TABLE expenses DROP COLUMN supplier_country;
