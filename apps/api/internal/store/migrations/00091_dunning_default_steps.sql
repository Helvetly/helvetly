-- +goose Up
-- Settings saves materialised the default steps with null names. Older saves also wrote null text.
-- Keep the old cadence where an open invoice is waiting for its second or final notice. The
-- hourly job computes that date from the last recorded send and the workspace's current steps.
UPDATE invoice_settings AS s
SET settings = jsonb_set(jsonb_set(settings, '{dunning,steps,1,days}', '10'), '{dunning,steps,2,days}', '10')
WHERE settings #> '{dunning,steps}' IN (
    '[
        {"name":null,"timing":"after_due","days":10,"fee":"0.00","qr_bill":true},
        {"name":null,"timing":"after_previous","days":14,"fee":"0.00","qr_bill":true},
        {"name":null,"timing":"after_previous","days":14,"fee":"0.00","qr_bill":true}
    ]'::jsonb,
    '[
        {"name":null,"timing":"after_due","days":10,"fee":"0.00","qr_bill":true,"text":null},
        {"name":null,"timing":"after_previous","days":14,"fee":"0.00","qr_bill":true,"text":null},
        {"name":null,"timing":"after_previous","days":14,"fee":"0.00","qr_bill":true,"text":null}
    ]'::jsonb
)
AND NOT EXISTS (
    SELECT 1
    FROM dunning_notices AS n
    JOIN invoices AS i ON i.id = n.invoice_id
    WHERE n.workspace_id = s.workspace_id AND i.status = 'open'
    GROUP BY n.invoice_id
    HAVING max(n.level) < 3
);

-- +goose Down
-- A saved 10-day sequence may be intentional, so a rollback must keep it.
SELECT 1;
