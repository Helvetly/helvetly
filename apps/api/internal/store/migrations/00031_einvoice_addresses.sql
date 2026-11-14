-- +goose Up
ALTER TABLE clients ADD COLUMN electronic_address jsonb;
ALTER TABLE clients ADD COLUMN registration_number text;
ALTER TABLE clients ADD CONSTRAINT clients_electronic_address_object
    CHECK (electronic_address IS NULL OR jsonb_typeof(electronic_address) = 'object');

-- +goose Down
ALTER TABLE clients DROP CONSTRAINT clients_electronic_address_object;
ALTER TABLE clients DROP COLUMN registration_number;
ALTER TABLE clients DROP COLUMN electronic_address;
