-- +goose Up
-- RO e-Factura (CIUS-RO, docs/invoices-contract.md "E-invoice XML"): a client's country subdivision (ISO 3166-2, BT-54,
-- required for Romanian addresses), the RON rate a document's VAT is also stated in (BT-111, entered by the user, never
-- fetched) and the CIUS-RO format in the XML archive.
ALTER TABLE clients ADD COLUMN region text;
ALTER TABLE invoices ADD COLUMN tax_currency_rate numeric(18, 6) CHECK (tax_currency_rate > 0);
ALTER TABLE invoice_xml_exports DROP CONSTRAINT invoice_xml_exports_format_check;
ALTER TABLE invoice_xml_exports ADD CONSTRAINT invoice_xml_exports_format_check
    CHECK (format IN ('xrechnung-ubl', 'xrechnung-cii', 'peppol', 'ksef-fa3', 'ro-cius'));

-- +goose Down
ALTER TABLE invoice_xml_exports DROP CONSTRAINT invoice_xml_exports_format_check;
ALTER TABLE invoice_xml_exports ADD CONSTRAINT invoice_xml_exports_format_check
    CHECK (format IN ('xrechnung-ubl', 'xrechnung-cii', 'peppol', 'ksef-fa3'));
ALTER TABLE invoices DROP COLUMN tax_currency_rate;
ALTER TABLE clients DROP COLUMN region;
