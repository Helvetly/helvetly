-- A quote can carry a payment schedule: the invoice's instalment schedule (interval, then seq, due_date and amount per
-- instalment), which the client accepts with the quote and the invoice made from it takes over. A quote is not a
-- financial record, so the schedule is kept as one value on the row; null is none.

-- +goose Up
ALTER TABLE quotes ADD COLUMN instalments jsonb;

-- +goose Down
ALTER TABLE quotes DROP COLUMN instalments;
