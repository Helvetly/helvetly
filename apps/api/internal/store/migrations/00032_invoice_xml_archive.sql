-- +goose Up
-- First exported bytes are a business record, separate from the PDF created on issue.
CREATE TABLE invoice_xml_exports (
    invoice_id text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    format text NOT NULL CHECK(format IN ('xrechnung-ubl','xrechnung-cii','peppol')),
    serializer_version text NOT NULL,
    object_key text NOT NULL UNIQUE,
    sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
    size bigint NOT NULL CHECK(size > 0),
    filename text NOT NULL,
    created_at timestamptz NOT NULL,
    created_by text,
    PRIMARY KEY(invoice_id,format)
);
-- Storage retention is applied after the archive transaction commits, so rollback cleanup remains possible.
CREATE TABLE invoice_xml_retention (
    invoice_id text NOT NULL,
    format text NOT NULL,
    applied_at timestamptz NOT NULL,
    PRIMARY KEY(invoice_id,format),
    FOREIGN KEY(invoice_id,format) REFERENCES invoice_xml_exports(invoice_id,format) ON DELETE CASCADE
);

-- +goose StatementBegin
CREATE FUNCTION invoice_xml_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('helvetly.purge', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'invoice XML archive is append-only';
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER invoice_xml_exports_append_only BEFORE UPDATE OR DELETE ON invoice_xml_exports FOR EACH ROW EXECUTE FUNCTION invoice_xml_append_only();
CREATE TRIGGER invoice_xml_exports_no_truncate BEFORE TRUNCATE ON invoice_xml_exports FOR EACH STATEMENT EXECUTE FUNCTION invoice_xml_append_only();
CREATE TRIGGER invoice_xml_retention_append_only BEFORE UPDATE OR DELETE ON invoice_xml_retention FOR EACH ROW EXECUTE FUNCTION invoice_xml_append_only();
CREATE TRIGGER invoice_xml_retention_no_truncate BEFORE TRUNCATE ON invoice_xml_retention FOR EACH STATEMENT EXECUTE FUNCTION invoice_xml_append_only();

-- +goose Down
DROP TABLE invoice_xml_retention,invoice_xml_exports;
DROP FUNCTION invoice_xml_append_only();
