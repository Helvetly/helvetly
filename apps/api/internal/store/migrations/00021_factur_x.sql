-- Factur-X / ZUGFeRD: the issued PDF as PDF/A-3 with its EN 16931 CII XML embedded. It is archived like the XML
-- formats on first export, and a client can ask for it on its invoice emails (in place of the plain PDF).

-- +goose Up
ALTER TABLE invoice_xml_exports DROP CONSTRAINT invoice_xml_exports_format_check,
    ADD CONSTRAINT invoice_xml_exports_format_check
    CHECK (format IN ('xrechnung-ubl', 'xrechnung-cii', 'peppol', 'ksef-fa3', 'ro-cius', 'factur-x'));
ALTER TABLE clients DROP CONSTRAINT clients_einvoice_format_check,
    ADD CONSTRAINT clients_einvoice_format_check
    CHECK (einvoice_format IN ('none', 'xrechnung_ubl', 'xrechnung_cii', 'peppol', 'factur_x'));

-- +goose Down
-- Archived Factur-X files are append-only financial records: they stay, and so does their format in the check.
UPDATE clients SET einvoice_format = 'none' WHERE einvoice_format = 'factur_x';
ALTER TABLE clients DROP CONSTRAINT clients_einvoice_format_check,
    ADD CONSTRAINT clients_einvoice_format_check
    CHECK (einvoice_format IN ('none', 'xrechnung_ubl', 'xrechnung_cii', 'peppol'));
