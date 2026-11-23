-- Calendar sync (docs/architecture/contracts/scheduling-contract.md, "Calendar sync"): each member's own Google or
-- Microsoft connection per workspace, with sealed tokens (internal/calsync seals them; the database never sees them
-- in the clear). Sources are the account's calendars, those ticked for busy times polled through sync tokens or
-- delta links; watches are the push channels and subscriptions; busy holds only start, end and the external id;
-- links map an occurrence to its pushed event; the queue holds pushes to make (occurrence_id is no foreign key, so a
-- removal can still be pushed after its row is gone); a feed is a member's private iCal URL (its token's SHA-256 for
-- lookup and a sealed copy to show again). None of these tables is exported (store.ExportExcluded).

-- +goose Up
CREATE TABLE calendar_connections (
    id                  text PRIMARY KEY,
    workspace_id        text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id             text NOT NULL,
    provider            text NOT NULL CHECK (provider IN ('google', 'microsoft')),
    account_email       text NOT NULL,
    external_account_id text NOT NULL,
    scopes              text[] NOT NULL DEFAULT '{}',
    refresh_token       bytea,
    access_token        bytea,
    access_expires_at   timestamptz,
    push_calendar_id    text,
    status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'error')),
    error               text,
    last_synced_at      timestamptz,
    created_at          timestamptz NOT NULL,
    updated_at          timestamptz NOT NULL,
    UNIQUE (workspace_id, user_id, provider),
    FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE
);
-- One account belongs to one member of a workspace (calendar_error=account_in_use).
CREATE UNIQUE INDEX calendar_connections_account ON calendar_connections (workspace_id, provider, external_account_id);

CREATE TABLE calendar_sources (
    connection_id text NOT NULL REFERENCES calendar_connections (id) ON DELETE CASCADE,
    calendar_id   text NOT NULL,
    name          text NOT NULL,
    is_primary    boolean NOT NULL DEFAULT false,
    busy          boolean NOT NULL DEFAULT false,
    sync_token    text,
    due_at        timestamptz NOT NULL,
    full_resync   boolean NOT NULL DEFAULT true,
    PRIMARY KEY (connection_id, calendar_id)
);
CREATE INDEX calendar_sources_due ON calendar_sources (due_at) WHERE busy;

CREATE TABLE calendar_watches (
    id            text PRIMARY KEY,
    connection_id text NOT NULL REFERENCES calendar_connections (id) ON DELETE CASCADE,
    calendar_id   text NOT NULL,
    provider_id   text NOT NULL UNIQUE,
    resource_id   text,
    secret_hash   bytea NOT NULL,
    expires_at    timestamptz NOT NULL
);
CREATE INDEX calendar_watches_expiry ON calendar_watches (expires_at);

CREATE TABLE calendar_busy (
    connection_id text NOT NULL REFERENCES calendar_connections (id) ON DELETE CASCADE,
    external_id   text NOT NULL,
    workspace_id  text NOT NULL,
    user_id       text NOT NULL,
    starts_at     timestamptz NOT NULL,
    ends_at       timestamptz NOT NULL CHECK (ends_at > starts_at),
    PRIMARY KEY (connection_id, external_id)
);
CREATE INDEX calendar_busy_host ON calendar_busy (workspace_id, user_id, starts_at);

CREATE TABLE calendar_event_links (
    connection_id   text NOT NULL REFERENCES calendar_connections (id) ON DELETE CASCADE,
    occurrence_id   text NOT NULL REFERENCES scheduling_occurrences (id) ON DELETE CASCADE,
    external_id     text NOT NULL,
    etag            text,
    pushed_sequence integer NOT NULL DEFAULT 0,
    state           text NOT NULL DEFAULT 'ok' CHECK (state IN ('ok', 'detached')),
    PRIMARY KEY (connection_id, occurrence_id),
    UNIQUE (connection_id, external_id)
);

-- queued_at: when the oldest change still waiting was queued (a push that keeps failing gives up after 24 h).
CREATE TABLE calendar_push_queue (
    connection_id text NOT NULL REFERENCES calendar_connections (id) ON DELETE CASCADE,
    occurrence_id text NOT NULL,
    due_at        timestamptz NOT NULL,
    queued_at     timestamptz NOT NULL,
    attempts      integer NOT NULL DEFAULT 0,
    last_error    text,
    leased_until  timestamptz,
    PRIMARY KEY (connection_id, occurrence_id)
);
CREATE INDEX calendar_push_queue_due ON calendar_push_queue (due_at);

CREATE TABLE calendar_feeds (
    workspace_id    text NOT NULL,
    user_id         text NOT NULL,
    token_hash      bytea NOT NULL UNIQUE,
    token_sealed    bytea NOT NULL,
    created_at      timestamptz NOT NULL,
    last_fetched_at timestamptz,
    PRIMARY KEY (workspace_id, user_id),
    FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE
);

-- +goose Down
DROP TABLE calendar_feeds;
DROP TABLE calendar_push_queue;
DROP TABLE calendar_event_links;
DROP TABLE calendar_busy;
DROP TABLE calendar_watches;
DROP TABLE calendar_sources;
DROP TABLE calendar_connections;
