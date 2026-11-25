-- +goose Up
CREATE TABLE admin_alerts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    ready_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_alerts_ready ON admin_alerts (ready_at, id);

-- +goose Down
DROP TABLE admin_alerts;
