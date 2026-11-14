-- +goose Up
-- The product and service catalogue (internal/products, docs/products-contract.md). Prices in minor units,
-- VAT rates in hundredths of a percent.

CREATE TABLE products (
    id           text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    type         text NOT NULL CHECK (type IN ('product', 'service')),
    name         text NOT NULL,
    description  text,
    sku          text,
    gtin         text,
    unit         text CHECK (unit IN ('hour', 'day', 'piece', 'month', 'km', 'flat')),
    price_basis  text NOT NULL CHECK (price_basis IN ('net', 'gross')),
    unit_price   bigint NOT NULL CHECK (unit_price >= 0),
    currency     text NOT NULL,
    vat_category text NOT NULL CHECK (vat_category IN ('S', 'Z', 'E', 'AE', 'K', 'G', 'O')),
    vat_rate     integer NOT NULL CHECK (vat_rate BETWEEN 0 AND 10000),
    archived_at  timestamptz,
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL,
    deleted_at   timestamptz, -- soft delete: invoices keep their copied lines anyway
    CHECK (gtin IS NULL OR type = 'product')
);
-- A SKU is taken only by live, active items (the old app reserved archived SKUs forever).
CREATE UNIQUE INDEX products_sku ON products (workspace_id, lower(sku))
    WHERE sku IS NOT NULL AND deleted_at IS NULL AND archived_at IS NULL;
CREATE INDEX products_workspace_name ON products (workspace_id, lower(name)) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE products;
