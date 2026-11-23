-- A contract written from a quote (templates/contract_write.go) keeps what was reviewed and printed: the title, the
-- clauses and the quote's tables as they were, as JSON (contractpdf.Document without the logo), so it can be printed
-- again or edited later. Contracts filled from a template have none.

-- +goose Up
ALTER TABLE quote_contracts ADD COLUMN sections jsonb;

-- +goose Down
ALTER TABLE quote_contracts DROP COLUMN sections;
