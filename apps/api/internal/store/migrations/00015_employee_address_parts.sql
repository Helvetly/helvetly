-- An employee's address gets the house number and apartment as their own fields, like a client's.
-- +goose Up
ALTER TABLE employees ADD COLUMN street_number text, ADD COLUMN apt text;

-- +goose Down
ALTER TABLE employees DROP COLUMN street_number, DROP COLUMN apt;
