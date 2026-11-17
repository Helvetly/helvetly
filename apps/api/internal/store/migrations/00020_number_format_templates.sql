-- +goose Up
-- Invoice number formats become templates with {…} placeholders, so a workspace can write its own.
UPDATE invoice_settings SET settings = jsonb_set(settings, '{number_format}', to_jsonb(CASE settings->>'number_format'
    WHEN 'YYYY/NNN' THEN '{YYYY}/{NNN}' WHEN 'NNN/YYYY' THEN '{NNN}/{YYYY}' WHEN 'RE-YYYY-NNN' THEN 'RE-{YYYY}-{NNN}'
    ELSE '{YYYY}-{NNN}' END))
WHERE settings ? 'number_format';

-- +goose Down
UPDATE invoice_settings SET settings = jsonb_set(settings, '{number_format}', to_jsonb(CASE settings->>'number_format'
    WHEN '{YYYY}/{NNN}' THEN 'YYYY/NNN' WHEN '{NNN}/{YYYY}' THEN 'NNN/YYYY' WHEN 'RE-{YYYY}-{NNN}' THEN 'RE-YYYY-NNN'
    ELSE 'YYYY-NNN' END))
WHERE settings ? 'number_format';
