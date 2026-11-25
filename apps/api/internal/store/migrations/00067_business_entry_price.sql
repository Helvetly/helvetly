-- +goose Up
-- Publish a new offer so existing workspaces and Stripe subscriptions keep their original terms.
SELECT pg_advisory_xact_lock(hashtextextended('offers', 0));

INSERT INTO offer_versions (id, schema_version, checksum, document, published_at)
SELECT 'helvetly-v2', schema_version, '070ed184950760ace7879c66ed260a4098e558b09139b3d1d84d7ca9acf007fc',
    jsonb_set(
        jsonb_set(document, '{offer_id}', '"helvetly-v2"'),
        '{billing,plans,business}',
        (document #> '{billing,plans,business}') || '{"month_minor": 9900, "year_minor": 95100}'
    ),
    now()
FROM offer_versions
WHERE id = 'helvetly-v1'
    AND id = (SELECT id FROM offer_versions ORDER BY published_at DESC, id DESC LIMIT 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
SELECT v.id, p.plan_id, p.limit_key, p.state, p.value, p.per_additional_paid_seat
FROM limit_plans p CROSS JOIN offer_versions v
WHERE p.offer_id = 'helvetly-v1' AND v.id = 'helvetly-v2' AND v.published_at = now();

INSERT INTO offer_audit (actor, action, target, before, after, reason)
SELECT 'migration 00067', 'offer.publish', new.id,
    jsonb_build_object('offer_id', old.id, 'checksum', old.checksum),
    jsonb_build_object('offer_id', new.id, 'checksum', new.checksum),
    'Business starts at 99 per month or 951 per year for five people'
FROM offer_versions old CROSS JOIN offer_versions new
WHERE old.id = 'helvetly-v1' AND new.id = 'helvetly-v2' AND new.published_at = now();

-- +goose Down
-- Published offers remain available to workspaces that adopted them.
SELECT 1;
