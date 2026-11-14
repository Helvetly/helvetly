-- +goose Up
-- A person's own photo (docs/auth-contract.md, "Photo"): the stored object replaces Google's picture (avatar_url)
-- wherever the person is shown, until it is removed. All four are set together or are all NULL.
ALTER TABLE users
    ADD COLUMN photo_key    text,
    ADD COLUMN photo_type   text,
    ADD COLUMN photo_size   bigint,
    ADD COLUMN photo_sha256 text CHECK (photo_sha256 ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT users_photo_complete CHECK (
        (photo_key IS NULL) = (photo_type IS NULL) AND (photo_key IS NULL) = (photo_size IS NULL)
        AND (photo_key IS NULL) = (photo_sha256 IS NULL));

-- +goose Down
ALTER TABLE users DROP CONSTRAINT users_photo_complete, DROP COLUMN photo_key, DROP COLUMN photo_type,
    DROP COLUMN photo_size, DROP COLUMN photo_sha256;
