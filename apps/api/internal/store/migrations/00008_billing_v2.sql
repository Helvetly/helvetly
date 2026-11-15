-- Offer v2 billing (stage E): checkout, seats, trial and grace.
-- billing_checkouts keeps what a plan Checkout was opened for (offer, plan, interval, currency, price, seats) before
-- Stripe is asked, so the webhook settles a subscription only on the terms it was sold on and assigns that offer.
-- trial_claims records who started a trial, as digests of the person, their email and their card's fingerprint (never
-- the card), so a customer gets one trial whatever the workspace. workspace_billing gains: trial_start (trial pools
-- count from it, across months); paid_seats (the seats paid for the current period: a reduction applies at renewal);
-- pending_plan/pending_interval/pending_at (a downgrade scheduled for the period's end); allowances (the costly monthly
-- allowances granted pro rata after an increase within allowance_period, the UTC month).

-- +goose Up
CREATE TABLE billing_checkouts (
    id                    text PRIMARY KEY,
    workspace_id          text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    offer_id              text NOT NULL REFERENCES offer_versions (id),
    plan                  text NOT NULL,
    billing_interval      text NOT NULL,
    currency              text NOT NULL,
    price_id              text NOT NULL,
    seats                 bigint NOT NULL CHECK (seats >= 1),
    trial                 boolean NOT NULL,
    created_by            text NOT NULL,
    created_at            timestamp with time zone NOT NULL,
    settled_subscription  text,
    settled_at            timestamp with time zone
);

CREATE INDEX billing_checkouts_workspace ON billing_checkouts (workspace_id, created_at);

CREATE TABLE trial_claims (
    kind         text NOT NULL CHECK (kind = ANY (ARRAY['user'::text, 'email'::text, 'card'::text])),
    digest       text NOT NULL,
    workspace_id text NOT NULL,
    claimed_at   timestamp with time zone NOT NULL,
    PRIMARY KEY (kind, digest)
);

ALTER TABLE workspace_billing
    ADD COLUMN trial_start      timestamp with time zone,
    ADD COLUMN paid_seats       bigint CHECK (paid_seats >= 0),
    ADD COLUMN pending_plan     text NOT NULL DEFAULT '',
    ADD COLUMN pending_interval text NOT NULL DEFAULT '',
    ADD COLUMN pending_at       timestamp with time zone,
    ADD COLUMN allowance_period text NOT NULL DEFAULT '',
    ADD COLUMN allowances       jsonb NOT NULL DEFAULT '{}'::jsonb;

-- +goose Down
ALTER TABLE workspace_billing
    DROP COLUMN trial_start, DROP COLUMN paid_seats, DROP COLUMN pending_plan, DROP COLUMN pending_interval,
    DROP COLUMN pending_at, DROP COLUMN allowance_period, DROP COLUMN allowances;
DROP TABLE trial_claims;
DROP TABLE billing_checkouts;
