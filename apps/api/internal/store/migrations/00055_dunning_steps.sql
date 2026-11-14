-- +goose Up
-- Dunning steps (docs/invoices-contract.md "Dunning"): up to ten reminders, notes before the due date among them. A
-- notice keeps its step's place as `level` (the old levels 1 to 3 are steps 1 to 3, so nothing goes out again), the
-- title it was sent with (NULL for notices sent before: named from level and levels) and whether it had a QR bill.
-- The settings' old "levels" are read as steps by internal/invoices.
ALTER TABLE dunning_notices
    DROP CONSTRAINT dunning_notices_level_check,
    DROP CONSTRAINT dunning_notices_check,
    ADD CONSTRAINT dunning_notices_level_check CHECK (level BETWEEN 1 AND 10),
    ADD CONSTRAINT dunning_notices_check CHECK (levels BETWEEN level AND 10),
    ADD COLUMN title text,
    ADD COLUMN qr_bill boolean NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE dunning_notices
    DROP COLUMN qr_bill,
    DROP COLUMN title,
    DROP CONSTRAINT dunning_notices_check,
    DROP CONSTRAINT dunning_notices_level_check,
    ADD CONSTRAINT dunning_notices_level_check CHECK (level BETWEEN 1 AND 3),
    ADD CONSTRAINT dunning_notices_check CHECK (levels BETWEEN level AND 3);
