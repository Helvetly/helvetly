-- +goose Up
ALTER TABLE heidi_confirmations DROP CONSTRAINT heidi_confirmations_kind_check;
ALTER TABLE heidi_confirmations ADD CONSTRAINT heidi_confirmations_kind_check
 CHECK (kind IN ('log_entry','select_engagement','workspace_operation'));

-- +goose Down
DELETE FROM heidi_confirmations WHERE kind = 'workspace_operation';
ALTER TABLE heidi_confirmations DROP CONSTRAINT heidi_confirmations_kind_check;
ALTER TABLE heidi_confirmations ADD CONSTRAINT heidi_confirmations_kind_check
 CHECK (kind IN ('log_entry','select_engagement'));
