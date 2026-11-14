-- +goose Up
-- Change request decisions (docs/portal-contract.md): an approval may apply only some of the requested fields
-- (`applied_fields`, the rest are discarded; NULL for requests decided before and for rejections) and a rejection
-- may give the client a reason.
ALTER TABLE client_change_requests
    ADD COLUMN applied_fields text[],
    ADD COLUMN reject_reason text CHECK (char_length(reject_reason) <= 500);

-- +goose Down
ALTER TABLE client_change_requests
    DROP COLUMN reject_reason,
    DROP COLUMN applied_fields;
