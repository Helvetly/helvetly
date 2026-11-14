-- +goose Up
-- AI Act Art. 50(2): output of the AI model is marked machine-readably. Heidi's assistant messages carry
-- payload.generated_by ("model" | "helvetly"); earlier ones cannot be told apart and are marked "helvetly".
-- Every AI-import record is the model's extraction.
UPDATE heidi_messages SET payload = payload || '{"generated_by": "helvetly"}'
WHERE payload->>'role' = 'assistant' AND NOT payload ? 'generated_by';
ALTER TABLE import_records ADD COLUMN generated_by text NOT NULL DEFAULT 'model' CHECK (generated_by IN ('model', 'helvetly'));

-- +goose Down
ALTER TABLE import_records DROP COLUMN generated_by;
UPDATE heidi_messages SET payload = payload - 'generated_by';
