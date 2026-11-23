-- The lookups Documents' grouped views make per file (store/queries_document_groups.go, audit A06): an invoice or
-- quote by its PDF, an imported invoice by its original and a signature request by its signed PDF, each within the
-- workspace. Without them every file scanned the whole invoices table.

-- +goose Up
CREATE INDEX invoices_workspace_pdf ON invoices (workspace_id, pdf_key) WHERE pdf_key IS NOT NULL;
CREATE INDEX invoices_workspace_source_document ON invoices (workspace_id, source_document_id) WHERE source_document_id IS NOT NULL;
CREATE INDEX quotes_workspace_pdf ON quotes (workspace_id, pdf_key) WHERE pdf_key IS NOT NULL;
CREATE INDEX signature_requests_signed_document ON signature_requests (signed_document_id) WHERE signed_document_id IS NOT NULL;

-- +goose Down
DROP INDEX signature_requests_signed_document;
DROP INDEX quotes_workspace_pdf;
DROP INDEX invoices_workspace_source_document;
DROP INDEX invoices_workspace_pdf;
