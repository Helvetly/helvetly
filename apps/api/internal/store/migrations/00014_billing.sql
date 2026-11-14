-- +goose Up
-- A deleted workspace keeps its records (invoices and receipts must be kept for ten years) but loses its members,
-- sessions and open invitations, so nobody reaches it any more (docs/workspaces-contract.md).
ALTER TABLE workspaces ADD COLUMN deleted_at timestamptz;

-- The workspace's Stripe customer and subscription, as last read from Stripe (docs/billing-contract.md).
CREATE TABLE workspace_billing (
    workspace_id           text        PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
    stripe_customer_id     text        UNIQUE,
    stripe_subscription_id text,
    status                 text        NOT NULL DEFAULT '', -- Stripe's subscription status; '' when there is none
    plan                   text        NOT NULL DEFAULT '' CHECK (plan IN ('', 'standard', 'pro')),
    billing_interval       text        NOT NULL DEFAULT '' CHECK (billing_interval IN ('', 'month', 'year')),
    current_period_end     timestamptz,
    cancel_at_period_end   boolean     NOT NULL DEFAULT false,
    trial_end              timestamptz,
    trial_used             boolean     NOT NULL DEFAULT false,
    updated_at             timestamptz NOT NULL
);

-- Webhook events already applied: Stripe delivers at least once.
CREATE TABLE stripe_events (
    id          text        PRIMARY KEY,
    type        text        NOT NULL,
    received_at timestamptz NOT NULL
);

-- +goose Down
DROP TABLE stripe_events, workspace_billing;
ALTER TABLE workspaces DROP COLUMN deleted_at;
