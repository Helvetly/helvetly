-- Offer v2 (stage C): storage_bytes counts the bytes a workspace actually keeps in the bucket, one row per object
-- key, whatever record points at it (documents, receipts, client files, imports, Heidi, invoice PDF and XML, quote PDFs,
-- signature originals, logos, portal avatars). A row is written before the PUT (the reservation, in the admission's
-- transaction), its size set from what storage answered once the PUT succeeds (verified_at), and deleted only after
-- storage confirmed the object gone. Duplicate uploads are refused per workspace by SHA-256, so each row is a
-- distinct blob; a deliberate copy is its own object and its own row. No row is shared across workspaces.
-- Personal avatars (users/...) and feedback screenshots belong to no workspace and are not counted.
--
-- Earlier objects are backfilled unverified with the size their record holds (0 where none does): the reconciler
-- reads each one's real size from storage, and drops rows whose object is gone.

-- +goose Up
CREATE TABLE stored_objects (
    object_key   text PRIMARY KEY,
    workspace_id text NOT NULL,
    size         bigint NOT NULL CHECK (size >= 0),
    created_at   timestamp with time zone NOT NULL,
    verified_at  timestamp with time zone
);

CREATE INDEX stored_objects_workspace ON stored_objects (workspace_id);
CREATE INDEX stored_objects_unverified ON stored_objects (created_at) WHERE verified_at IS NULL;

INSERT INTO stored_objects (object_key, workspace_id, size, created_at)
SELECT object_key, workspace_id, size, created_at FROM documents
UNION ALL SELECT object_key, workspace_id, size, created_at FROM expense_receipts
UNION ALL SELECT x.object_key, i.workspace_id, x.size, x.created_at FROM invoice_xml_exports x JOIN invoices i ON i.id = x.invoice_id
UNION ALL SELECT object_key, workspace_id, size, updated_at FROM portal_avatars
UNION ALL SELECT object_key, workspace_id, max(size), min(created_at) FROM import_files WHERE object_key IS NOT NULL
    GROUP BY object_key, workspace_id
UNION ALL SELECT pdf_key, workspace_id, 0, created_at FROM invoices WHERE pdf_key IS NOT NULL
UNION ALL SELECT pdf_key, workspace_id, 0, created_at FROM quotes WHERE pdf_key IS NOT NULL
UNION ALL SELECT original_key, workspace_id, 0, created_at FROM signature_requests
UNION ALL SELECT 'workspaces/' || workspace_id || '/invoice-settings/' || (settings ->> 'logo_file_id'), workspace_id, 0, updated_at
    FROM invoice_settings WHERE settings ->> 'logo_file_id' IS NOT NULL
ON CONFLICT (object_key) DO NOTHING;

-- +goose Down
DROP TABLE stored_objects;
