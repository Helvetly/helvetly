-- +goose Up
ALTER TABLE heidi_memory DROP COLUMN reply_style;

-- +goose Down
ALTER TABLE heidi_memory ADD COLUMN reply_style text NOT NULL DEFAULT 'auto'
    CHECK (reply_style IN ('auto', 'brief', 'detailed'));
