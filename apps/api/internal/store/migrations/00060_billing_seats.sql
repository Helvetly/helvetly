-- +goose Up
-- Per-seat pricing (docs/billing-contract.md, "Seats"): a subscription on a per-seat price is billed for each
-- member of the workspace; one on an earlier flat price (per_seat false) keeps its plan's member cap until it
-- changes plan or interval. seats is the quantity Stripe bills, NULL until a subscription is recorded.
ALTER TABLE workspace_billing
    ADD COLUMN per_seat boolean NOT NULL DEFAULT false,
    ADD COLUMN seats    integer CHECK (seats >= 0);

-- +goose Down
ALTER TABLE workspace_billing DROP COLUMN per_seat, DROP COLUMN seats;
