-- One pending ZIP export per member and workspace, held by the database (audit A01): two submits at once used to
-- both pass the NOT EXISTS check. Earlier duplicates keep the oldest pending; the rest fail (their failed rows are
-- deleted a day later with the others).

-- +goose Up
UPDATE document_zip_exports e SET status = 'failed', finished_at = now(), claimed_until = NULL
WHERE e.status = 'pending' AND EXISTS (SELECT 1 FROM document_zip_exports o
    WHERE o.workspace_id = e.workspace_id AND o.user_id = e.user_id AND o.status = 'pending'
        AND (o.created_at, o.id) < (e.created_at, e.id));

CREATE UNIQUE INDEX document_zip_exports_one_pending ON document_zip_exports (workspace_id, user_id) WHERE status = 'pending';

-- +goose Down
DROP INDEX document_zip_exports_one_pending;
