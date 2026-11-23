-- Contracts made from a quote (templates/contract.go): each generated contract document links its quote, several per
-- quote (a contract made again), newest first. Deleting the document (or the quote) drops the link; a trashed
-- document is simply not listed. Contracts are filed in Clients/<client>/Documents/<year>/Contracts, a system folder
-- of the new kind contracts. A contract has its own number (<year>/C/<seq> in the workspace's format), counted per
-- workspace and year in contract_counters like quotes. Imported contracts keep their name and get no number.

-- +goose Up
CREATE TABLE quote_contracts (
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    quote_id     text NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    document_id  text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    number       text NOT NULL,
    template_id  text,
    created_by   text,
    created_at   timestamp with time zone NOT NULL,
    PRIMARY KEY (quote_id, document_id)
);

CREATE UNIQUE INDEX quote_contracts_number ON quote_contracts (workspace_id, number);
CREATE INDEX quote_contracts_document ON quote_contracts (document_id);
CREATE INDEX quote_contracts_workspace ON quote_contracts (workspace_id, quote_id, created_at DESC);

CREATE TABLE contract_counters (
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    year         integer NOT NULL,
    seq          bigint NOT NULL,
    PRIMARY KEY (workspace_id, year)
);

ALTER TABLE document_folders DROP CONSTRAINT document_folders_system_kind_check;
ALTER TABLE document_folders ADD CONSTRAINT document_folders_system_kind_check CHECK (system_kind IN ('clients', 'expenses',
    'client', 'invoices', 'quotes', 'engagements', 'signatures', 'documents', 'contracts', 'year', 'expense_category'));

-- AI filing records why a client's contract-like file went, or did not go, to its Contracts folder.
ALTER TABLE document_filings ADD COLUMN contract_reason text;

-- +goose Down
ALTER TABLE document_filings DROP COLUMN contract_reason;
UPDATE document_folders SET system_kind = NULL, system_ref = NULL WHERE system_kind = 'contracts';
ALTER TABLE document_folders DROP CONSTRAINT document_folders_system_kind_check;
ALTER TABLE document_folders ADD CONSTRAINT document_folders_system_kind_check CHECK (system_kind IN ('clients', 'expenses',
    'client', 'invoices', 'quotes', 'engagements', 'signatures', 'documents', 'year', 'expense_category'));
DROP TABLE quote_contracts, contract_counters;
