-- A bank statement, payment confirmation or credit advice can be linked to an invoice's payment or refund. While
-- linked, the file stays in its folder like any record file (recordFileSQL); unlinking or deleting the payment frees it.

-- +goose Up
ALTER TABLE document_links DROP CONSTRAINT document_links_target_type_check,
    ADD CONSTRAINT document_links_target_type_check
        CHECK (target_type IN ('client', 'invoice', 'expense', 'signature', 'payment', 'refund'));

-- +goose Down
DELETE FROM document_links WHERE target_type IN ('payment', 'refund');
ALTER TABLE document_links DROP CONSTRAINT document_links_target_type_check,
    ADD CONSTRAINT document_links_target_type_check CHECK (target_type IN ('client', 'invoice', 'expense', 'signature'));
