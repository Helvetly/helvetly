-- +goose Up
-- Bank Statements/<year>: the third top-level system folder, for account statements of banks and payment providers.
ALTER TABLE document_folders DROP CONSTRAINT document_folders_system_kind_check;
ALTER TABLE document_folders ADD CONSTRAINT document_folders_system_kind_check CHECK (system_kind IN ('clients', 'expenses',
    'bank_statements', 'client', 'invoices', 'quotes', 'engagements', 'signatures', 'documents', 'contracts', 'year',
    'expense_category'));

-- +goose Down
UPDATE document_folders f SET system_kind = NULL, system_ref = NULL WHERE system_kind = 'year'
    AND EXISTS (SELECT 1 FROM document_folders p WHERE p.id = f.parent_id AND p.system_kind = 'bank_statements');
UPDATE document_folders SET system_kind = NULL, system_ref = NULL WHERE system_kind = 'bank_statements';
ALTER TABLE document_folders DROP CONSTRAINT document_folders_system_kind_check;
ALTER TABLE document_folders ADD CONSTRAINT document_folders_system_kind_check CHECK (system_kind IN ('clients', 'expenses',
    'client', 'invoices', 'quotes', 'engagements', 'signatures', 'documents', 'contracts', 'year', 'expense_category'));
