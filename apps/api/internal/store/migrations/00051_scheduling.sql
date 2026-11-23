-- Scheduling (docs/architecture/contracts/scheduling-contract.md): one-off and recurring sessions with clients, hosted
-- by members (never employees). An event is a one-off or a series (its rule kept for .ics and re-expansion); its occurrences are rows
-- materialised up to a horizon, each with its own status, attendance, requests and reminders. Hosts' weekly hours,
-- date overrides and the workspace's holidays feed booking slots; event types are what clients may book. A booking
-- link is made on demand for a host or an event type, until a date or with no end, and can be revoked; it is the only
-- way someone who is not a client yet books.
-- host_user_id is not a foreign key on events and occurrences: a host who leaves (or a workspace deleted and restored)
-- keeps their sessions, and readers show no host while they are not a member.
--
-- The plan feature scheduling (Pro and Business) and its monthly limit scheduled_events_per_month (Pro 100,
-- Business unlimited) join every published offer's values (no workspace loses anything), and helvetly-v1.5,
-- helvetly-v1.4 with both records, goes on sale.

-- +goose Up
ALTER TABLE clients ADD COLUMN time_zone text CHECK (char_length(time_zone) <= 64);

CREATE TABLE scheduling_settings (
    workspace_id              text PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
    booking_mode              text NOT NULL DEFAULT 'staff' CHECK (booking_mode IN ('staff', 'clients')),
    confirmation              text NOT NULL DEFAULT 'auto' CHECK (confirmation IN ('auto', 'manual')),
    notice_minutes            integer NOT NULL DEFAULT 1440 CHECK (notice_minutes BETWEEN 0 AND 20160),
    cutoff_time               time,
    cutoff_days               smallint[] NOT NULL DEFAULT '{1,2,3,4,5}' CHECK (cutoff_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
    cutoff_skips_holidays     boolean NOT NULL DEFAULT true,
    auto_approve_on_time      boolean NOT NULL DEFAULT true,
    late_cancel_counts        boolean NOT NULL DEFAULT true,
    no_show_counts            boolean NOT NULL DEFAULT true,
    late_reschedule_counts    boolean NOT NULL DEFAULT false,
    client_reminders          integer[] NOT NULL DEFAULT '{1440,60}' CHECK (cardinality(client_reminders) <= 5),
    host_reminders            integer[] NOT NULL DEFAULT '{}' CHECK (cardinality(host_reminders) <= 5),
    auto_attended_after_hours integer CHECK (auto_attended_after_hours BETWEEN 1 AND 720),
    feed_details              text NOT NULL DEFAULT 'full' CHECK (feed_details IN ('full', 'busy')),
    default_location          text CHECK (char_length(default_location) <= 500),
    updated_by                text,
    updated_at                timestamptz NOT NULL
);

CREATE TABLE scheduling_holidays (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    day          date NOT NULL,
    name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    PRIMARY KEY (workspace_id, day)
);

CREATE TABLE scheduling_hosts (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id      text NOT NULL,
    time_zone    text CHECK (char_length(time_zone) <= 64),
    bookable     boolean NOT NULL DEFAULT true,
    color        text CHECK (char_length(color) <= 20),
    updated_at   timestamptz NOT NULL,
    PRIMARY KEY (workspace_id, user_id),
    FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE
);

CREATE TABLE scheduling_availability (
    workspace_id text NOT NULL,
    user_id      text NOT NULL,
    weekday      smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    starts       time NOT NULL,
    ends         time NOT NULL,
    CHECK (starts < ends),
    PRIMARY KEY (workspace_id, user_id, weekday, starts),
    FOREIGN KEY (workspace_id, user_id) REFERENCES scheduling_hosts (workspace_id, user_id) ON DELETE CASCADE
);

CREATE TABLE scheduling_availability_overrides (
    workspace_id text NOT NULL,
    user_id      text NOT NULL,
    day          date NOT NULL,
    starts       time,
    ends         time,
    CHECK ((starts IS NULL) = (ends IS NULL) AND (starts IS NULL OR starts < ends)),
    PRIMARY KEY (workspace_id, user_id, day),
    FOREIGN KEY (workspace_id, user_id) REFERENCES scheduling_hosts (workspace_id, user_id) ON DELETE CASCADE
);

CREATE TABLE scheduling_event_types (
    id                 text PRIMARY KEY,
    workspace_id       text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    name               text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    description        text CHECK (char_length(description) <= 2000),
    duration_minutes   integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 720),
    mode               text NOT NULL CHECK (mode IN ('online', 'live')),
    meeting_provider   text CHECK (meeting_provider IN ('manual', 'google_meet', 'teams')),
    location           text CHECK (char_length(location) <= 500),
    product_id         text REFERENCES products (id) ON DELETE SET NULL,
    unit_price         bigint CHECK (unit_price >= 0),
    currency           text CHECK (currency ~ '^[A-Z]{3}$'),
    host_ids           text[] NOT NULL DEFAULT '{}',
    buffer_before      integer NOT NULL DEFAULT 0 CHECK (buffer_before BETWEEN 0 AND 240),
    buffer_after       integer NOT NULL DEFAULT 0 CHECK (buffer_after BETWEEN 0 AND 240),
    min_notice_minutes integer NOT NULL DEFAULT 720 CHECK (min_notice_minutes BETWEEN 0 AND 525600),
    max_horizon_days   integer NOT NULL DEFAULT 60 CHECK (max_horizon_days BETWEEN 1 AND 365),
    slot_step_minutes  integer CHECK (slot_step_minutes BETWEEN 5 AND 720),
    bookable           boolean NOT NULL DEFAULT true,
    color              text CHECK (char_length(color) <= 20),
    archived_at        timestamptz,
    created_at         timestamptz NOT NULL,
    updated_at         timestamptz NOT NULL
);
CREATE UNIQUE INDEX scheduling_event_types_name ON scheduling_event_types (workspace_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE scheduling_events (
    id                 text PRIMARY KEY,
    workspace_id       text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    client_id          text NOT NULL REFERENCES clients (id),
    engagement_id      text REFERENCES engagements (id),
    event_type_id      text REFERENCES scheduling_event_types (id) ON DELETE SET NULL,
    host_user_id       text,
    title              text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    description        text CHECK (char_length(description) <= 4000),
    client_note        text CHECK (char_length(client_note) <= 2000),
    mode               text NOT NULL CHECK (mode IN ('online', 'live')),
    meeting_provider   text CHECK (meeting_provider IN ('manual', 'google_meet', 'teams')),
    meeting_url        text CHECK (char_length(meeting_url) <= 2000),
    meeting_ref        text,
    location           text CHECK (char_length(location) <= 500),
    time_zone          text NOT NULL CHECK (char_length(time_zone) <= 64),
    starts_local       timestamp NOT NULL,
    duration_minutes   integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 720),
    rrule              text,
    until_date         date,
    count              integer CHECK (count BETWEEN 1 AND 520),
    skip_holidays      boolean NOT NULL DEFAULT false,
    attendees          text[] NOT NULL DEFAULT '{}' CHECK (cardinality(attendees) <= 10),
    units_per_session  bigint CHECK (units_per_session > 0),
    unit_price         bigint CHECK (unit_price >= 0),
    currency           text CHECK (currency ~ '^[A-Z]{3}$'),
    sequence           integer NOT NULL DEFAULT 0,
    materialised_until timestamptz,
    created_by         text,
    created_at         timestamptz NOT NULL,
    updated_at         timestamptz NOT NULL,
    CHECK (NOT (until_date IS NOT NULL AND count IS NOT NULL)),
    CHECK (rrule IS NOT NULL OR (until_date IS NULL AND count IS NULL))
);
CREATE INDEX scheduling_events_client ON scheduling_events (workspace_id, client_id);
CREATE INDEX scheduling_events_materialise ON scheduling_events (materialised_until) WHERE rrule IS NOT NULL;

-- timed_at: when starts_at was last set (made or moved); a reminder that fell due before it is never sent.
CREATE TABLE scheduling_occurrences (
    id                text PRIMARY KEY,
    workspace_id      text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    event_id          text NOT NULL REFERENCES scheduling_events (id) ON DELETE CASCADE,
    host_user_id      text,
    client_id         text NOT NULL REFERENCES clients (id),
    engagement_id     text REFERENCES engagements (id),
    original_start    timestamptz NOT NULL,
    starts_at         timestamptz NOT NULL,
    ends_at           timestamptz NOT NULL,
    status            text NOT NULL CHECK (status IN ('requested', 'scheduled', 'rescheduled', 'attended', 'no_show',
        'cancelled_on_time', 'cancelled_late', 'declined')),
    late              boolean NOT NULL DEFAULT false,
    waived_by         text,
    waived_at         timestamptz,
    waive_reason      text CHECK (char_length(waive_reason) <= 500),
    is_exception      boolean NOT NULL DEFAULT false,
    title             text CHECK (char_length(title) BETWEEN 1 AND 200),
    location          text CHECK (char_length(location) <= 500),
    meeting_url       text CHECK (char_length(meeting_url) <= 2000),
    sequence          integer NOT NULL DEFAULT 0,
    invoice_id        text REFERENCES invoices (id) ON DELETE SET NULL,
    timed_at          timestamptz NOT NULL,
    status_changed_by text,
    status_changed_at timestamptz,
    created_at        timestamptz NOT NULL,
    updated_at        timestamptz NOT NULL,
    CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '24 hours'),
    UNIQUE (event_id, original_start)
);
CREATE INDEX scheduling_occurrences_host ON scheduling_occurrences (workspace_id, host_user_id, starts_at);
CREATE INDEX scheduling_occurrences_client ON scheduling_occurrences (workspace_id, client_id, starts_at);
CREATE INDEX scheduling_occurrences_engagement ON scheduling_occurrences (engagement_id);
CREATE INDEX scheduling_occurrences_open ON scheduling_occurrences (starts_at) WHERE status IN ('requested', 'scheduled', 'rescheduled');

CREATE TABLE scheduling_occurrence_entries (
    occurrence_id text NOT NULL REFERENCES scheduling_occurrences (id) ON DELETE CASCADE,
    entry_id      text NOT NULL UNIQUE REFERENCES engagement_entries (id) ON DELETE CASCADE,
    reason        text NOT NULL CHECK (reason IN ('attended', 'no_show', 'late_cancel', 'late_reschedule')),
    PRIMARY KEY (occurrence_id, reason)
);

CREATE TABLE scheduling_requests (
    id                 text PRIMARY KEY,
    workspace_id       text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    occurrence_id      text NOT NULL REFERENCES scheduling_occurrences (id) ON DELETE CASCADE,
    client_id          text NOT NULL REFERENCES clients (id),
    kind               text NOT NULL CHECK (kind IN ('cancel', 'reschedule', 'booking')),
    status             text NOT NULL CHECK (status IN ('pending', 'proposed', 'approved', 'declined', 'accepted', 'withdrawn', 'expired')),
    late               boolean NOT NULL DEFAULT false,
    proposed_times     timestamptz[] NOT NULL DEFAULT '{}' CHECK (cardinality(proposed_times) <= 3),
    staff_proposal     timestamptz,
    chosen             timestamptz,
    note               text CHECK (char_length(note) <= 500),
    reason             text CHECK (char_length(reason) <= 500),
    requested_by_email text,
    created_at         timestamptz NOT NULL,
    decided_at         timestamptz,
    decided_by         text
);
CREATE UNIQUE INDEX scheduling_requests_open ON scheduling_requests (occurrence_id) WHERE status IN ('pending', 'proposed');
CREATE INDEX scheduling_requests_status ON scheduling_requests (workspace_id, status);

CREATE TABLE scheduling_reminders (
    occurrence_id  text NOT NULL REFERENCES scheduling_occurrences (id) ON DELETE CASCADE,
    offset_minutes integer NOT NULL,
    audience       text NOT NULL CHECK (audience IN ('client', 'host')),
    sent_at        timestamptz NOT NULL,
    PRIMARY KEY (occurrence_id, offset_minutes, audience)
);

-- token_hash: the SHA-256 of the link's token, for lookup; token_sealed: the token sealed, to show the link again.
CREATE TABLE scheduling_booking_links (
    id            text PRIMARY KEY,
    workspace_id  text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    host_user_id  text,
    event_type_id text REFERENCES scheduling_event_types (id) ON DELETE CASCADE,
    token_hash    bytea NOT NULL UNIQUE,
    token_sealed  bytea NOT NULL,
    expires_at    timestamptz,
    revoked_at    timestamptz,
    created_by    text NOT NULL,
    created_at    timestamptz NOT NULL,
    last_used_at  timestamptz,
    CHECK (host_user_id IS NOT NULL OR event_type_id IS NOT NULL),
    FOREIGN KEY (workspace_id, host_user_id) REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE
);
CREATE INDEX scheduling_booking_links_workspace ON scheduling_booking_links (workspace_id, created_at);

INSERT INTO limits (key, kind, unit, scope, period, requires_features, allow_unlimited, position, description)
SELECT 'scheduling', 'access', 'boolean', 'workspace', NULL, '{}'::text[], true, max(position) + 1,
    'Sessions with clients, calendar sync and booking in the client portal'
FROM limits;
INSERT INTO limits (key, kind, unit, scope, period, requires_features, allow_unlimited, position, description)
SELECT 'scheduled_events_per_month', 'period_counter', 'scheduled_event', 'workspace', 'calendar_month_utc', '{scheduling}'::text[], true,
    max(position) + 1, 'Sessions and series scheduled, and client bookings, this month'
FROM limits;

-- Values join an offer only when it is published, so the guard is lifted for this one addition.
ALTER TABLE limit_plans DISABLE TRIGGER limit_plans_published_now;
INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
SELECT offer_id, plan_id, 'scheduling', CASE plan_id WHEN 'basic' THEN 'disabled' ELSE 'enabled' END, NULL, 0
FROM limit_plans WHERE limit_key = 'custom_portal_domain';
INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
SELECT offer_id, plan_id, 'scheduled_events_per_month', CASE plan_id WHEN 'business' THEN 'unlimited' ELSE 'limited' END,
    CASE plan_id WHEN 'basic' THEN 0 WHEN 'pro' THEN 100 END, 0
FROM limit_plans WHERE limit_key = 'custom_portal_domain';
ALTER TABLE limit_plans ENABLE TRIGGER limit_plans_published_now;

-- helvetly-v1.5: helvetly-v1.4 with both records last. Its checksum is Offer.Checksum of this document.
INSERT INTO offer_versions (id, schema_version, checksum, published_at, document)
SELECT 'helvetly-v1.5', schema_version, '2277472650e053c56a1aa9ba6d87aa7047271e232d32f0a6c122c73d3088065b', now(),
    jsonb_set(jsonb_set(document, '{offer_id}', '"helvetly-v1.5"'), '{records}', document->'records' || jsonb_build_array(
        jsonb_build_object('key', 'scheduling', 'type', 'access', 'unit', 'boolean', 'scope', 'workspace', 'period', NULL,
            'requires_features', jsonb_build_array(),
            'values', jsonb_build_object('basic', jsonb_build_object('state', 'disabled'), 'business', jsonb_build_object('state', 'enabled'),
                'pro', jsonb_build_object('state', 'enabled'))),
        jsonb_build_object('key', 'scheduled_events_per_month', 'type', 'period_counter', 'unit', 'scheduled_event', 'scope', 'workspace',
            'period', 'calendar_month_utc', 'requires_features', jsonb_build_array('scheduling'),
            'values', jsonb_build_object('basic', jsonb_build_object('state', 'limited', 'value', 0),
                'business', jsonb_build_object('state', 'unlimited'), 'pro', jsonb_build_object('state', 'limited', 'value', 100)),
            'per_additional_paid_seat', jsonb_build_object('basic', 0, 'business', 0, 'pro', 0))))
FROM offer_versions WHERE id = 'helvetly-v1.4';

INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
SELECT 'helvetly-v1.5', plan_id, limit_key, state, value, per_additional_paid_seat FROM limit_plans WHERE offer_id = 'helvetly-v1.4';

-- +goose Down
-- Published rows refuse changes; a rollback is the one time they may be removed.
UPDATE billing_checkouts SET offer_id = 'helvetly-v1.4' WHERE offer_id = 'helvetly-v1.5';
UPDATE workspace_billing SET offer_id = 'helvetly-v1.4' WHERE offer_id = 'helvetly-v1.5';
DELETE FROM limit_workspaces WHERE offer_id = 'helvetly-v1.5' OR limit_key IN ('scheduling', 'scheduled_events_per_month');
DELETE FROM usage_events WHERE resource = 'scheduled_events_per_month';
ALTER TABLE limit_plans DISABLE TRIGGER limit_plans_immutable;
ALTER TABLE offer_versions DISABLE TRIGGER offer_versions_immutable;
DELETE FROM limit_plans WHERE offer_id = 'helvetly-v1.5' OR limit_key IN ('scheduling', 'scheduled_events_per_month');
DELETE FROM offer_versions WHERE id = 'helvetly-v1.5';
ALTER TABLE offer_versions ENABLE TRIGGER offer_versions_immutable;
ALTER TABLE limit_plans ENABLE TRIGGER limit_plans_immutable;
DELETE FROM limits WHERE key IN ('scheduling', 'scheduled_events_per_month');
DROP TABLE scheduling_booking_links;
DROP TABLE scheduling_reminders;
DROP TABLE scheduling_requests;
DROP TABLE scheduling_occurrence_entries;
DROP TABLE scheduling_occurrences;
DROP TABLE scheduling_events;
DROP TABLE scheduling_event_types;
DROP TABLE scheduling_availability_overrides;
DROP TABLE scheduling_availability;
DROP TABLE scheduling_hosts;
DROP TABLE scheduling_holidays;
DROP TABLE scheduling_settings;
ALTER TABLE clients DROP COLUMN time_zone;
