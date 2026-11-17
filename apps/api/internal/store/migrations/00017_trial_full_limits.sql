-- Offer helvetly-v1.1: the trial has the full limits of the plan it gives access to (Pro), not small trial allowances.
-- It is helvetly-v1 with trial.overrides emptied (everything else, prices and every plan value, is copied unchanged),
-- published as the offer on sale (the one published last). A trial takes its limits from its workspace's offer, so
-- workspaces now trialing move to it, with the values the operator set for them (limit_workspaces). Workspaces
-- with a paid subscription stay on helvetly-v1: they keep the terms they were sold.

-- +goose Up
INSERT INTO offer_versions (id, schema_version, checksum, published_at, document)
SELECT 'helvetly-v1.1', schema_version, '734ff2cd6b10b945a2dbba56499c6e2c57b9d716a133efb882ca1c5fe9d2b3d6', now(),
    jsonb_set(jsonb_set(document, '{offer_id}', '"helvetly-v1.1"'), '{trial,overrides}', '{}'::jsonb)
FROM offer_versions WHERE id = 'helvetly-v1';

INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
SELECT 'helvetly-v1.1', plan_id, limit_key, state, value, per_additional_paid_seat FROM limit_plans WHERE offer_id = 'helvetly-v1';

INSERT INTO limit_workspaces (workspace_id, offer_id, limit_key, state, value, expires_at, reason, set_by)
SELECT w.workspace_id, 'helvetly-v1.1', w.limit_key, w.state, w.value, w.expires_at, w.reason, w.set_by
FROM limit_workspaces w JOIN workspace_billing b ON b.workspace_id = w.workspace_id
WHERE b.offer_id = 'helvetly-v1' AND b.status = 'trialing' AND w.offer_id = 'helvetly-v1';

INSERT INTO offer_audit (actor, action, target, before, after, reason)
SELECT 'migration 00017', 'offer.assign', 'helvetly-v1.1', jsonb_build_object('offer_id', 'helvetly-v1', 'workspace_id', workspace_id),
    jsonb_build_object('offer_id', 'helvetly-v1.1', 'workspace_id', workspace_id), 'Trial with the full limits of its plan, approved by the owner'
FROM workspace_billing WHERE offer_id = 'helvetly-v1' AND status = 'trialing';

UPDATE workspace_billing SET offer_id = 'helvetly-v1.1' WHERE offer_id = 'helvetly-v1' AND status = 'trialing';

INSERT INTO offer_audit (actor, action, target, after, reason)
VALUES ('migration 00017', 'offer.publish', 'helvetly-v1.1', jsonb_build_object('offer_id', 'helvetly-v1.1', 'checksum', '734ff2cd6b10b945a2dbba56499c6e2c57b9d716a133efb882ca1c5fe9d2b3d6'),
    'Trial with the full limits of its plan, approved by the owner');

-- +goose Down
-- Published rows refuse changes; a rollback is the one time they may be removed.
UPDATE billing_checkouts SET offer_id = 'helvetly-v1' WHERE offer_id = 'helvetly-v1.1';
UPDATE workspace_billing SET offer_id = 'helvetly-v1' WHERE offer_id = 'helvetly-v1.1';
ALTER TABLE limit_plans DISABLE TRIGGER limit_plans_immutable;
ALTER TABLE offer_versions DISABLE TRIGGER offer_versions_immutable;
DELETE FROM limit_workspaces WHERE offer_id = 'helvetly-v1.1';
DELETE FROM limit_plans WHERE offer_id = 'helvetly-v1.1';
DELETE FROM offer_versions WHERE id = 'helvetly-v1.1';
ALTER TABLE offer_versions ENABLE TRIGGER offer_versions_immutable;
ALTER TABLE limit_plans ENABLE TRIGGER limit_plans_immutable;
