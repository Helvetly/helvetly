-- +goose Up
-- The client portal's login is the client's own address (email, else billing email), no longer a contact:
-- sessions hold the client and the address they signed in with, contacts lose their portal switch, and the
-- client keeps when it was invited and first signed in. Contact-based sessions end (they sign in again).
ALTER TABLE clients ADD COLUMN portal_invited_at timestamptz, ADD COLUMN portal_signed_in_at timestamptz;
UPDATE clients c SET portal_signed_in_at = k.first
FROM (SELECT client_id, min(portal_signed_in_at) AS first FROM client_contacts GROUP BY client_id) k
WHERE k.client_id = c.id;

DELETE FROM portal_sessions;
DROP INDEX portal_sessions_contact;
ALTER TABLE portal_sessions DROP COLUMN contact_id, ADD COLUMN email text NOT NULL;
ALTER TABLE client_contacts DROP COLUMN portal_access, DROP COLUMN portal_signed_in_at;

-- +goose Down
ALTER TABLE client_contacts ADD COLUMN portal_access boolean NOT NULL DEFAULT false, ADD COLUMN portal_signed_in_at timestamptz;
DELETE FROM portal_sessions;
ALTER TABLE portal_sessions DROP COLUMN email,
    ADD COLUMN contact_id text NOT NULL REFERENCES client_contacts (id) ON DELETE CASCADE;
CREATE INDEX portal_sessions_contact ON portal_sessions (contact_id);
ALTER TABLE clients DROP COLUMN portal_signed_in_at, DROP COLUMN portal_invited_at;
