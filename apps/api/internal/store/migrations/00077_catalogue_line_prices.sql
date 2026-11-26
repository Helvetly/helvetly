-- +goose Up
ALTER TABLE invoice_lines
    ADD COLUMN catalogue_price_basis text,
    ADD COLUMN catalogue_unit_price bigint,
    ADD COLUMN catalogue_currency text,
    ADD CONSTRAINT invoice_lines_catalogue_price CHECK (
        num_nonnulls(catalogue_price_basis, catalogue_unit_price, catalogue_currency) = 0 OR
        (num_nonnulls(catalogue_price_basis, catalogue_unit_price, catalogue_currency) = 3
            AND catalogue_price_basis IN ('gross', 'net') AND catalogue_unit_price >= 0)
    );

-- +goose Down
ALTER TABLE invoice_lines DROP COLUMN catalogue_price_basis, DROP COLUMN catalogue_unit_price, DROP COLUMN catalogue_currency;
