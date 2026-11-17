-- Heidi's monthly AI allowance is for Heidi alone. AI import and the automatic filing of documents spend a separate
-- pool, the automation pool, with its own token allowance and cost guard (ai_automation_tokens_per_month,
-- ai_automation_cost_usd_micros). heidi_usage and ai_calls gain the pool: usage, reservations, the uncertain month and
-- the one call in flight are per pool. Calls already made move with their kind (heidi stays heidi, anything else is
-- automation), and the months they were counted in are split the same way.
-- Every published offer gets the new limits at Heidi's values (an owner-approved addition: no workspace loses
-- anything, and AI import stops using Heidi's allowance); helvetly-v1.2 carries them in its document and goes on sale.

-- +goose Up
ALTER TABLE heidi_usage ADD COLUMN pool text NOT NULL DEFAULT 'heidi' CHECK (pool IN ('heidi', 'automation'));
ALTER TABLE heidi_usage DROP CONSTRAINT heidi_usage_pkey, ADD PRIMARY KEY (workspace_id, period, pool);
ALTER TABLE heidi_usage ALTER COLUMN pool DROP DEFAULT;

ALTER TABLE ai_calls ADD COLUMN pool text NOT NULL DEFAULT 'heidi' CHECK (pool IN ('heidi', 'automation'));
UPDATE ai_calls SET pool = 'automation' WHERE kind <> 'heidi';
ALTER TABLE ai_calls ALTER COLUMN pool DROP DEFAULT;
DROP INDEX ai_calls_in_flight;
-- One provider call in flight per workspace and pool, across months.
CREATE UNIQUE INDEX ai_calls_in_flight ON ai_calls (workspace_id, pool) WHERE status = 'reserved';

-- What each automation call added to its month (budget.go: settle, expireStale), moved out of the shared row.
INSERT INTO heidi_usage (workspace_id, period, pool, tokens_used, tokens_reserved, cost_micros, cost_reserved_micros, uncertain, updated_at)
SELECT workspace_id, period, 'automation',
    coalesce(sum(total_tokens) FILTER (WHERE status IN ('settled', 'cost_pending')), 0),
    coalesce(sum(reserved_tokens) FILTER (WHERE status IN ('reserved', 'uncertain')), 0),
    coalesce(sum(cost_micros) FILTER (WHERE status = 'settled'), 0),
    coalesce(sum(reserved_micros) FILTER (WHERE status <> 'settled'), 0),
    bool_or(status = 'uncertain'), now()
FROM ai_calls WHERE pool = 'automation' GROUP BY workspace_id, period;
UPDATE heidi_usage h SET tokens_used = greatest(h.tokens_used - a.tokens_used, 0),
    tokens_reserved = greatest(h.tokens_reserved - a.tokens_reserved, 0),
    cost_micros = greatest(h.cost_micros - a.cost_micros, 0),
    cost_reserved_micros = greatest(h.cost_reserved_micros - a.cost_reserved_micros, 0),
    -- the month stays blocked for Heidi only if a Heidi call (or an operator) blocked it
    uncertain = h.uncertain AND (NOT a.uncertain OR EXISTS (SELECT 1 FROM ai_calls c WHERE c.workspace_id = h.workspace_id
        AND c.period = h.period AND c.pool = 'heidi' AND c.status = 'uncertain'))
FROM heidi_usage a WHERE a.pool = 'automation' AND h.pool = 'heidi' AND a.workspace_id = h.workspace_id AND a.period = h.period;

UPDATE limits SET description = 'Model tokens Heidi uses per calendar month' WHERE key = 'ai_tokens_per_month';
UPDATE limits SET position = position + 2
WHERE position > (SELECT position FROM limits WHERE key = 'ai_cost_usd_micros');
INSERT INTO limits (key, kind, unit, scope, period, requires_features, allow_unlimited, position, description)
SELECT 'ai_automation_tokens_per_month', 'period_counter', 'token', 'workspace', 'calendar_month_utc', '{ai_import}'::text[], false,
    position + 1, 'Model tokens AI import and automatic document filing use per calendar month'
FROM limits WHERE key = 'ai_cost_usd_micros'
UNION ALL
SELECT 'ai_automation_cost_usd_micros', 'cost_budget', 'USD_micro', 'workspace', 'calendar_month_utc', '{}'::text[], false,
    position + 2, 'The internal model cost guard of AI import and automatic filing, in micro-USD'
FROM limits WHERE key = 'ai_cost_usd_micros';

-- The offers published before: the new limits at Heidi's values. Values join an offer only when it is published, so
-- the guard is lifted for this one addition.
ALTER TABLE limit_plans DISABLE TRIGGER limit_plans_published_now;
INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
SELECT offer_id, plan_id, CASE limit_key WHEN 'ai_tokens_per_month' THEN 'ai_automation_tokens_per_month'
    ELSE 'ai_automation_cost_usd_micros' END, state, value, per_additional_paid_seat
FROM limit_plans WHERE limit_key IN ('ai_tokens_per_month', 'ai_cost_usd_micros');
ALTER TABLE limit_plans ENABLE TRIGGER limit_plans_published_now;

-- helvetly-v1.2: helvetly-v1.1 with the two records after ai_cost_usd_micros (copies of Heidi's, under the new keys),
-- both pooled by paid seat, the cost guard internal. Its checksum is Offer.Checksum of this document.
INSERT INTO offer_versions (id, schema_version, checksum, published_at, document)
SELECT 'helvetly-v1.2', schema_version, '7a15e8765497a7d5cb67641c1010eb3760879e01d2fee0007e2e82f8c83af28c', now(),
    jsonb_set(jsonb_set(jsonb_set(jsonb_set(document, '{offer_id}', '"helvetly-v1.2"'),
        '{records}', (SELECT jsonb_agg(e ORDER BY n, sub) FROM (
            SELECT r AS e, n, 0 AS sub FROM jsonb_array_elements(document->'records') WITH ORDINALITY AS t (r, n)
            UNION ALL
            SELECT jsonb_set(r, '{key}', CASE r->>'key' WHEN 'ai_tokens_per_month' THEN '"ai_automation_tokens_per_month"'
                    ELSE '"ai_automation_cost_usd_micros"' END::jsonb),
                (SELECT n FROM jsonb_array_elements(document->'records') WITH ORDINALITY AS c (r, n) WHERE r->>'key' = 'ai_cost_usd_micros'),
                CASE r->>'key' WHEN 'ai_tokens_per_month' THEN 1 ELSE 2 END
            FROM jsonb_array_elements(document->'records') AS t (r) WHERE r->>'key' IN ('ai_tokens_per_month', 'ai_cost_usd_micros')) x)),
        '{usage_policy,pooled_by_paid_seat_keys}',
        document->'usage_policy'->'pooled_by_paid_seat_keys' || '["ai_automation_tokens_per_month", "ai_automation_cost_usd_micros"]'::jsonb),
        '{public_pricing,internal_only_keys}',
        document->'public_pricing'->'internal_only_keys' || '["ai_automation_cost_usd_micros"]'::jsonb)
FROM offer_versions WHERE id = 'helvetly-v1.1';

INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
SELECT 'helvetly-v1.2', plan_id, limit_key, state, value, per_additional_paid_seat FROM limit_plans WHERE offer_id = 'helvetly-v1.1';

INSERT INTO offer_audit (actor, action, target, after, reason)
VALUES ('migration 00018', 'offer.publish', 'helvetly-v1.2', jsonb_build_object('offer_id', 'helvetly-v1.2', 'checksum', '7a15e8765497a7d5cb67641c1010eb3760879e01d2fee0007e2e82f8c83af28c'),
    'AI import and filing get their own monthly AI pool, apart from Heidi''s, approved by the owner');

-- +goose Down
-- Published rows refuse changes; a rollback is the one time they may be removed.
UPDATE billing_checkouts SET offer_id = 'helvetly-v1.1' WHERE offer_id = 'helvetly-v1.2';
UPDATE workspace_billing SET offer_id = 'helvetly-v1.1' WHERE offer_id = 'helvetly-v1.2';
DELETE FROM limit_workspaces WHERE offer_id = 'helvetly-v1.2' OR limit_key IN ('ai_automation_tokens_per_month', 'ai_automation_cost_usd_micros');
ALTER TABLE limit_plans DISABLE TRIGGER limit_plans_immutable;
ALTER TABLE offer_versions DISABLE TRIGGER offer_versions_immutable;
DELETE FROM limit_plans WHERE offer_id = 'helvetly-v1.2' OR limit_key IN ('ai_automation_tokens_per_month', 'ai_automation_cost_usd_micros');
DELETE FROM offer_versions WHERE id = 'helvetly-v1.2';
ALTER TABLE offer_versions ENABLE TRIGGER offer_versions_immutable;
ALTER TABLE limit_plans ENABLE TRIGGER limit_plans_immutable;
DELETE FROM limits WHERE key IN ('ai_automation_tokens_per_month', 'ai_automation_cost_usd_micros');
UPDATE limits SET position = position - 2 WHERE position > (SELECT position FROM limits WHERE key = 'ai_cost_usd_micros');
UPDATE limits SET description = 'Model tokens Heidi and the AI import use per calendar month' WHERE key = 'ai_tokens_per_month';

-- The pools merge back into one row per month; a second call in flight is left to settle as uncertain.
INSERT INTO heidi_usage (workspace_id, period, pool, updated_at)
SELECT workspace_id, period, 'heidi', now() FROM heidi_usage WHERE pool = 'automation' ON CONFLICT DO NOTHING;
UPDATE heidi_usage h SET tokens_used = h.tokens_used + a.tokens_used, tokens_reserved = h.tokens_reserved + a.tokens_reserved,
    cost_micros = h.cost_micros + a.cost_micros, cost_reserved_micros = h.cost_reserved_micros + a.cost_reserved_micros,
    uncertain = h.uncertain OR a.uncertain
FROM heidi_usage a WHERE a.pool = 'automation' AND h.pool = 'heidi' AND a.workspace_id = h.workspace_id AND a.period = h.period;
DELETE FROM heidi_usage WHERE pool = 'automation';
ALTER TABLE heidi_usage DROP CONSTRAINT heidi_usage_pkey, ADD PRIMARY KEY (workspace_id, period);
ALTER TABLE heidi_usage DROP COLUMN pool;

UPDATE ai_calls SET status = 'uncertain' WHERE status = 'reserved' AND pool = 'automation'
    AND workspace_id IN (SELECT workspace_id FROM ai_calls WHERE status = 'reserved' AND pool = 'heidi');
DROP INDEX ai_calls_in_flight;
CREATE UNIQUE INDEX ai_calls_in_flight ON ai_calls (workspace_id) WHERE status = 'reserved';
ALTER TABLE ai_calls DROP COLUMN pool;
