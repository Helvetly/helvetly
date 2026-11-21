-- Approvals (internal/approvals) also before a quote is sent and an expense is booked: two more policy types.

-- +goose Up
ALTER TABLE approval_policies DROP CONSTRAINT approval_policies_doc_type_check;
ALTER TABLE approval_policies ADD CONSTRAINT approval_policies_doc_type_check
    CHECK (doc_type IN ('invoice', 'credit_note', 'debit_note', 'corrected', 'quote', 'expense'));

-- +goose Down
DELETE FROM approval_requests WHERE doc_type IN ('quote', 'expense');
DELETE FROM approval_policies WHERE doc_type IN ('quote', 'expense');
ALTER TABLE approval_policies DROP CONSTRAINT approval_policies_doc_type_check;
ALTER TABLE approval_policies ADD CONSTRAINT approval_policies_doc_type_check
    CHECK (doc_type IN ('invoice', 'credit_note', 'debit_note', 'corrected'));
