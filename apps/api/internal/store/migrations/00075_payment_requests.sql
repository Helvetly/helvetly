-- +goose Up
CREATE TABLE invoice_payment_requests (
    invoice_id text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    request_id text NOT NULL,
    params_hash bytea NOT NULL,
    PRIMARY KEY (invoice_id, request_id)
);

-- +goose Down
DROP TABLE invoice_payment_requests;
