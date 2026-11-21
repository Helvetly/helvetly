-- Expenses are filed by category, then year: Expenses/<category>/<year>. A category's folder is a system folder of kind
-- expense_category, system_ref the category (NULL for the folder of expenses without one, stored as "Uncategorised").
-- documents.BackfillSystemFolders moves the expenses' files out of the earlier Expenses/<year>[/<category>] folders.
-- Nothing here reads 00043's category columns, so the two migrations stand alone.

-- +goose Up
ALTER TABLE document_folders DROP CONSTRAINT document_folders_system_kind_check;
ALTER TABLE document_folders ADD CONSTRAINT document_folders_system_kind_check CHECK (system_kind IN ('clients', 'expenses',
    'client', 'invoices', 'quotes', 'engagements', 'signatures', 'documents', 'year', 'expense_category'));

-- +goose Down
UPDATE document_folders SET system_kind = NULL, system_ref = NULL WHERE system_kind = 'expense_category';
ALTER TABLE document_folders DROP CONSTRAINT document_folders_system_kind_check;
ALTER TABLE document_folders ADD CONSTRAINT document_folders_system_kind_check CHECK (system_kind IN ('clients', 'expenses',
    'client', 'invoices', 'quotes', 'engagements', 'signatures', 'documents', 'year'));
