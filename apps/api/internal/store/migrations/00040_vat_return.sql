-- +goose Up
-- The Swiss VAT return (internal/vatreturn, docs/vat-return-contract.md): the workspace's settlement method, period and
-- basis, and two expense fields the return needs: acquisition tax on services from abroad (Bezugsteuer, MWSTG
-- art. 45) and an explicit input-tax box (400 or 405) where the category's account does not decide it.
CREATE TABLE vat_return_settings (
    workspace_id text PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
    method       text NOT NULL CHECK (method IN ('effective', 'net_tax_rate')),
    period       text NOT NULL CHECK (period IN ('monthly', 'quarterly', 'half_yearly', 'yearly')),
    basis        text NOT NULL CHECK (basis IN ('agreed', 'received')),
    net_rates    jsonb NOT NULL DEFAULT '[]', -- [{label, rate}], the first is the default activity
    updated_by   text REFERENCES users (id) ON DELETE SET NULL,
    updated_at   timestamptz NOT NULL
);

ALTER TABLE expenses ADD COLUMN reverse_charge boolean NOT NULL DEFAULT false;
ALTER TABLE expenses ADD COLUMN input_tax_box text CHECK (input_tax_box IN ('400', '405'));

-- +goose Down
ALTER TABLE expenses DROP COLUMN input_tax_box;
ALTER TABLE expenses DROP COLUMN reverse_charge;
DROP TABLE vat_return_settings;
