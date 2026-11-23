-- API token requests per workspace and minute (audit A04): the plan's api_read_requests_per_minute and
-- api_write_requests_per_minute are counted here, so every instance shares one count. A row per workspace, pool
-- (read or write) and minute; the minute before stays for the rolling estimate, older ones go on the next request.

-- +goose Up
CREATE TABLE api_request_windows (
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    pool         text NOT NULL CHECK (pool IN ('read', 'write')),
    window_start timestamp with time zone NOT NULL,
    requests     bigint NOT NULL,
    PRIMARY KEY (workspace_id, pool, window_start)
);

-- +goose Down
DROP TABLE api_request_windows;
