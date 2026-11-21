-- Expenses entered as one amount per VAT rate (single) or as items (itemised); an item may name its own category,
-- whose account the ledger posts its share to. Quantity and unit price are shown only: amount stays the figure.

-- +goose Up
ALTER TABLE expenses ADD COLUMN entry_mode text NOT NULL DEFAULT 'single'
    CONSTRAINT expenses_entry_mode_check CHECK (entry_mode IN ('single', 'itemised'));
ALTER TABLE expense_lines
    ADD COLUMN category_id text REFERENCES expense_categories(id),
    ADD COLUMN quantity bigint CONSTRAINT expense_lines_quantity_check CHECK (quantity > 0),
    ADD COLUMN unit_price bigint CONSTRAINT expense_lines_unit_price_check CHECK (unit_price >= 0);
CREATE INDEX expense_lines_category ON expense_lines (category_id) WHERE category_id IS NOT NULL;

-- +goose Down
DROP INDEX expense_lines_category;
ALTER TABLE expense_lines DROP COLUMN unit_price, DROP COLUMN quantity, DROP COLUMN category_id;
ALTER TABLE expenses DROP COLUMN entry_mode;
