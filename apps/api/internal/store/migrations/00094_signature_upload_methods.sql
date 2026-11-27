-- A signer may also adopt an image of their own signature (uploaded) or the one saved in their account (saved).

-- +goose Up
ALTER TABLE signature_signers DROP CONSTRAINT signature_signers_signature_method_check;
ALTER TABLE signature_signers ADD CONSTRAINT signature_signers_signature_method_check
    CHECK (signature_method IN ('typed', 'drawn', 'uploaded', 'saved'));

-- +goose Down
UPDATE signature_signers SET signature_method = 'drawn' WHERE signature_method IN ('uploaded', 'saved');
ALTER TABLE signature_signers DROP CONSTRAINT signature_signers_signature_method_check;
ALTER TABLE signature_signers ADD CONSTRAINT signature_signers_signature_method_check
    CHECK (signature_method IN ('typed', 'drawn'));
