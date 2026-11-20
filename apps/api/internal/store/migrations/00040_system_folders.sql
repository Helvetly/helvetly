-- System folders in Documents: every workspace has the top-level folders Clients and Expenses, which nobody renames,
-- moves or deletes. Below Clients the app keeps Clients/<client>/<record type>/<year>, below Expenses Expenses/<year>.
-- system_kind says which one a folder is (clients, expenses, client, invoices, quotes, engagements, signatures,
-- documents, year), system_ref the client of a client folder. The stored name of a typed folder is its English name;
-- people see it in their own language. Existing top-level Clients and Expenses folders (and Expenses' year folders) are
-- adopted, the missing roots made; the rest is filed in by the app (documents.BackfillSystemFolders).

-- +goose Up
ALTER TABLE document_folders ADD COLUMN system_kind text CHECK (system_kind IN ('clients', 'expenses', 'client',
    'invoices', 'quotes', 'engagements', 'signatures', 'documents', 'year'));
ALTER TABLE document_folders ADD COLUMN system_ref text;
CREATE INDEX document_folders_system ON document_folders (workspace_id, parent_id, system_kind) WHERE system_kind IS NOT NULL;
CREATE INDEX documents_object_key ON documents (object_key);

UPDATE document_folders SET system_kind = lower(name)
WHERE parent_id IS NULL AND deleted_at IS NULL AND lower(name) IN ('clients', 'expenses');

UPDATE document_folders f SET system_kind = 'year'
FROM document_folders p WHERE f.parent_id = p.id AND p.system_kind = 'expenses' AND f.deleted_at IS NULL
    AND f.name ~ '^[0-9]{4}$';

INSERT INTO document_folders (id, workspace_id, parent_id, name, created_at, updated_at, system_kind)
SELECT 'fld_' || substr(md5(random()::text || w.id || r.kind), 1, 26), w.id, NULL, r.name, now(), now(), r.kind
FROM workspaces w CROSS JOIN (VALUES ('clients', 'Clients'), ('expenses', 'Expenses')) r (kind, name)
WHERE NOT EXISTS (SELECT 1 FROM document_folders f WHERE f.workspace_id = w.id AND f.parent_id IS NULL
    AND f.deleted_at IS NULL AND f.system_kind = r.kind);

-- +goose Down
DROP INDEX documents_object_key;
DROP INDEX document_folders_system;
ALTER TABLE document_folders DROP COLUMN system_ref;
ALTER TABLE document_folders DROP COLUMN system_kind;
