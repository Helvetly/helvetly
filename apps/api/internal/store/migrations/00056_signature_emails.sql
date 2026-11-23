-- Document and signature emails from templates: a workspace's own wording for the email that sends a document, for the
-- email asking someone to sign and for its
-- reminder, and the language a request's emails are written in (NULL: a request from before, or one sent without a
-- language, keeps the English email it always had).

-- +goose Up
ALTER TABLE email_templates DROP CONSTRAINT email_templates_kind_check,
    ADD CONSTRAINT email_templates_kind_check
        CHECK (kind IN ('invoice', 'credit_note', 'proforma', 'quote', 'document', 'signature_request', 'signature_reminder'));

ALTER TABLE signature_requests ADD COLUMN language text CHECK (language IN ('de', 'fr', 'it', 'en'));

-- +goose Down
ALTER TABLE signature_requests DROP COLUMN language;
DELETE FROM email_templates WHERE kind IN ('document', 'signature_request', 'signature_reminder');
ALTER TABLE email_templates DROP CONSTRAINT email_templates_kind_check,
    ADD CONSTRAINT email_templates_kind_check CHECK (kind IN ('invoice', 'credit_note', 'proforma', 'quote'));
