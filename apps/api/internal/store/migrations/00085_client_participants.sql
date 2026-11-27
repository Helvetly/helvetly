-- People of a client: each person (client_contacts) is a contact (billing and correspondence), a participant (takes
-- the service) or both; every existing row stays a contact. A company client says where its invoices and documents
-- go (documents_to): the company, or the participant they are for. Sessions, engagements, their entries and invoices
-- may name one participant of their client; a participant may sign in to the client's portal with their own switch,
-- and a portal session names the participant it is bound to.

-- +goose Up
ALTER TABLE client_contacts
    ADD COLUMN roles text[] NOT NULL DEFAULT '{contact}'
        CHECK (cardinality(roles) BETWEEN 1 AND 2 AND roles <@ ARRAY['contact', 'participant']),
    ADD COLUMN portal_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN street text CHECK (char_length(street) <= 200),
    ADD COLUMN street_number text CHECK (char_length(street_number) <= 20),
    ADD COLUMN zip text CHECK (char_length(zip) <= 20),
    ADD COLUMN city text CHECK (char_length(city) <= 100),
    ADD COLUMN country text CHECK (country ~ '^[A-Z]{2}$'),
    ADD COLUMN vat_number text CHECK (char_length(vat_number) <= 50);
CREATE INDEX client_contacts_participant_email ON client_contacts (workspace_id, lower(email)) WHERE 'participant' = ANY (roles);

ALTER TABLE clients ADD COLUMN documents_to text NOT NULL DEFAULT 'company' CHECK (documents_to IN ('company', 'participants')),
    -- a person client made a participant of a company: deleted, its records moved there (a repeat is answered as done)
    ADD COLUMN merged_into text REFERENCES clients (id),
    ADD COLUMN merged_participant text REFERENCES client_contacts (id) ON DELETE SET NULL;

ALTER TABLE scheduling_events ADD COLUMN participant_contact_id text REFERENCES client_contacts (id) ON DELETE SET NULL;
ALTER TABLE engagements ADD COLUMN participant_contact_id text REFERENCES client_contacts (id) ON DELETE SET NULL;
ALTER TABLE engagement_entries ADD COLUMN participant_contact_id text REFERENCES client_contacts (id) ON DELETE SET NULL;
-- invoices: the participant the invoice is addressed to (participants mode); null = the company.
ALTER TABLE invoices ADD COLUMN participant_contact_id text REFERENCES client_contacts (id) ON DELETE SET NULL;
CREATE INDEX invoices_participant ON invoices (participant_contact_id) WHERE participant_contact_id IS NOT NULL;

ALTER TABLE portal_sessions ADD COLUMN participant_id text REFERENCES client_contacts (id) ON DELETE CASCADE;

-- Documents shared with one participant of a client (the client's own shares stay in document_shares).
CREATE TABLE document_participant_shares (
    document_id text NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    contact_id text NOT NULL REFERENCES client_contacts (id) ON DELETE CASCADE,
    client_id text NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    shared_by text REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (document_id, contact_id)
);
CREATE INDEX document_participant_shares_contact ON document_participant_shares (workspace_id, contact_id, created_at DESC);

-- +goose Down
DROP TABLE document_participant_shares;
ALTER TABLE portal_sessions DROP COLUMN participant_id;
ALTER TABLE invoices DROP COLUMN participant_contact_id;
ALTER TABLE engagement_entries DROP COLUMN participant_contact_id;
ALTER TABLE engagements DROP COLUMN participant_contact_id;
ALTER TABLE scheduling_events DROP COLUMN participant_contact_id;
ALTER TABLE clients DROP COLUMN documents_to, DROP COLUMN merged_into, DROP COLUMN merged_participant;
DROP INDEX client_contacts_participant_email;
ALTER TABLE client_contacts DROP COLUMN roles, DROP COLUMN portal_enabled, DROP COLUMN street, DROP COLUMN street_number,
    DROP COLUMN zip, DROP COLUMN city, DROP COLUMN country, DROP COLUMN vat_number;
