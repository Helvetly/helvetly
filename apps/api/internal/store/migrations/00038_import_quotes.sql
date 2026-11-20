-- Quotes can be imported from documents and spreadsheets.

-- +goose Up
ALTER TABLE import_batches DROP CONSTRAINT import_batches_kind_check,
    ADD CONSTRAINT import_batches_kind_check CHECK ((kind = ANY (ARRAY['clients'::text, 'products'::text, 'expenses'::text, 'invoices'::text, 'engagements'::text, 'auto'::text, 'payroll'::text, 'quotes'::text])));

-- +goose Down
DELETE FROM import_batches WHERE kind = 'quotes';
ALTER TABLE import_batches DROP CONSTRAINT import_batches_kind_check,
    ADD CONSTRAINT import_batches_kind_check CHECK ((kind = ANY (ARRAY['clients'::text, 'products'::text, 'expenses'::text, 'invoices'::text, 'engagements'::text, 'auto'::text, 'payroll'::text])));
