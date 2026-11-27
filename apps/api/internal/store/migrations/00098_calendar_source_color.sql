-- A connected calendar's own colour as the provider shows it (Google's backgroundColor, Microsoft's hexColor), so
-- Settings → Scheduling can tell calendars apart; null when the provider gives none.

-- +goose Up
ALTER TABLE calendar_sources ADD COLUMN color text CHECK (color ~ '^#[0-9a-f]{6}$');

-- +goose Down
ALTER TABLE calendar_sources DROP COLUMN color;
