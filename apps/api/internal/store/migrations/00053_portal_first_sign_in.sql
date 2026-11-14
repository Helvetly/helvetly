-- +goose Up
-- When a contact first signed in to the client portal: the first sign-in tells the workspace once (portal.first_sign_in).
ALTER TABLE client_contacts ADD COLUMN portal_signed_in_at timestamptz;
UPDATE client_contacts k SET portal_signed_in_at = s.first
FROM (SELECT contact_id, min(created_at) AS first FROM portal_sessions GROUP BY contact_id) s WHERE s.contact_id = k.id;

-- +goose Down
ALTER TABLE client_contacts DROP COLUMN portal_signed_in_at;
