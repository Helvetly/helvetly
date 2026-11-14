-- +goose Up
-- Documents: the workspace's folder tree, its files and their links to records (internal/documents,
-- docs/documents-contract.md). Client files move in here: they become documents in a "Clients" folder
-- linked to their client, keeping their ids and objects.

CREATE TABLE document_folders (
    id           text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    parent_id    text REFERENCES document_folders (id) ON DELETE SET NULL, -- null = top level
    name         text NOT NULL,
    created_by   text REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL,
    deleted_at   timestamptz, -- in the Trash
    deleted_by   text REFERENCES users (id) ON DELETE SET NULL,
    trashed_with text -- the folder whose trashing took this along; null = trashed on its own (shown in the Trash)
);
CREATE UNIQUE INDEX document_folders_name ON document_folders (workspace_id, coalesce(parent_id, ''), lower(name))
    WHERE deleted_at IS NULL;
CREATE INDEX document_folders_parent ON document_folders (parent_id);
CREATE INDEX document_folders_trashed_with ON document_folders (trashed_with) WHERE trashed_with IS NOT NULL;

-- File names are unique among a folder's live files too, kept by the API under an advisory lock per folder:
-- migrated client files may share a name, so there is no index to enforce it.
CREATE TABLE documents (
    id           text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    folder_id    text REFERENCES document_folders (id) ON DELETE SET NULL,
    name         text NOT NULL,
    size         bigint NOT NULL,
    content_type text NOT NULL,
    sha256       text, -- hex; null for client files uploaded before checksums
    object_key   text NOT NULL UNIQUE,
    uploaded_by  text REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL,
    deleted_at   timestamptz,
    deleted_by   text REFERENCES users (id) ON DELETE SET NULL,
    trashed_with text
);
CREATE INDEX documents_folder ON documents (workspace_id, folder_id) WHERE deleted_at IS NULL;
CREATE INDEX documents_trash ON documents (workspace_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX documents_trashed_with ON documents (trashed_with) WHERE trashed_with IS NOT NULL;

-- A file attached to records; the record shows it as a backlink. Retention is derived from these rows.
CREATE TABLE document_links (
    document_id  text NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    target_type  text NOT NULL CHECK (target_type IN ('client', 'invoice', 'expense')),
    target_id    text NOT NULL,
    created_by   text REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL,
    PRIMARY KEY (document_id, target_type, target_id)
);
CREATE INDEX document_links_target ON document_links (target_type, target_id);

INSERT INTO document_folders (id, workspace_id, name, created_at, updated_at)
SELECT 'fld_' || md5(random()::text || workspace_id), workspace_id, 'Clients', now(), now()
FROM (SELECT DISTINCT workspace_id FROM client_files) w;

INSERT INTO documents (id, workspace_id, folder_id, name, size, content_type, object_key, uploaded_by, created_at, updated_at)
SELECT f.id, f.workspace_id, d.id, f.name, f.size, f.content_type, f.object_key, f.uploaded_by, f.created_at, f.created_at
FROM client_files f
JOIN document_folders d ON d.workspace_id = f.workspace_id AND d.parent_id IS NULL AND d.name = 'Clients';

INSERT INTO document_links (document_id, workspace_id, target_type, target_id, created_by, created_at)
SELECT id, workspace_id, 'client', client_id, uploaded_by, created_at FROM client_files;

DROP TABLE client_files;

-- +goose Down
CREATE TABLE client_files (
    id           text PRIMARY KEY,
    client_id    text NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    object_key   text NOT NULL UNIQUE,
    name         text NOT NULL,
    size         bigint NOT NULL,
    content_type text NOT NULL,
    uploaded_by  text REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL
);
CREATE INDEX client_files_client ON client_files (client_id, created_at);
INSERT INTO client_files (id, client_id, workspace_id, object_key, name, size, content_type, uploaded_by, created_at)
SELECT DISTINCT ON (d.id) d.id, l.target_id, d.workspace_id, d.object_key, d.name, d.size, d.content_type, d.uploaded_by,
    d.created_at
FROM documents d
JOIN document_links l ON l.document_id = d.id AND l.target_type = 'client'
JOIN clients c ON c.id = l.target_id
WHERE d.deleted_at IS NULL
ORDER BY d.id, l.created_at;
DROP TABLE document_links, documents, document_folders;
