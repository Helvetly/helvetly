-- +goose Up
-- The KSeF structured invoice (FA(3)) is archived like the EN 16931 formats: first exported bytes, append-only.
ALTER TABLE invoice_xml_exports DROP CONSTRAINT invoice_xml_exports_format_check;
ALTER TABLE invoice_xml_exports ADD CONSTRAINT invoice_xml_exports_format_check
    CHECK(format IN ('xrechnung-ubl','xrechnung-cii','peppol','ksef-fa3'));

-- +goose Down
ALTER TABLE invoice_xml_exports DROP CONSTRAINT invoice_xml_exports_format_check;
ALTER TABLE invoice_xml_exports ADD CONSTRAINT invoice_xml_exports_format_check
    CHECK(format IN ('xrechnung-ubl','xrechnung-cii','peppol'));
