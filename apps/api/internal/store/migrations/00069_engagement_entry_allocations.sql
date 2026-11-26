-- +goose Up
CREATE TABLE engagement_entry_allocations (
    entry_id text NOT NULL REFERENCES engagement_entries(id) ON DELETE CASCADE,
    invoice_id text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    quantity bigint NOT NULL CHECK (quantity > 0),
    historical_estimate boolean NOT NULL DEFAULT false,
    PRIMARY KEY (entry_id, invoice_id)
);
CREATE INDEX engagement_entry_allocations_invoice ON engagement_entry_allocations(invoice_id);

-- The old picker filled the newest entries first. Only the oldest selected entry could be partial.
-- Read its quantity from an untouched draft or identifiable generated lines. If those no longer
-- identify the work, keep the old reservation and expose that uncertainty instead of billing it again.
WITH linked AS (
    SELECT en.id, en.invoice_id, en.quantity, e.billing, i.status = 'draft' AND i.created_at = i.updated_at AS untouched,
           to_char(en.date, 'DD.MM.YYYY') || coalesce(' · ' || en.note, '') ||
             CASE WHEN en.client_performance_on_invoice THEN coalesce(' · ' || en.client_performance, '') ELSE '' END AS entry_text,
           ' · ' || to_char(i.service_date, 'DD.MM.YYYY') || ' – ' || to_char(i.service_date_end, 'DD.MM.YYYY') AS period_text,
           row_number() OVER entry_order AS pos,
           count(*) OVER (PARTITION BY en.invoice_id) AS entries,
           sum(en.quantity) OVER (PARTITION BY en.invoice_id) AS total
    FROM engagement_entries en JOIN engagements e ON e.id = en.engagement_id JOIN invoices i ON i.id = en.invoice_id
    WINDOW entry_order AS (PARTITION BY en.invoice_id ORDER BY en.date, en.created_at, en.id)
), billed AS (
    SELECT l.invoice_id, count(*) AS lines, sum(l.quantity) AS qty, min(l.description) AS description
    FROM invoice_lines l JOIN (SELECT DISTINCT invoice_id FROM linked) x ON x.invoice_id = l.invoice_id GROUP BY l.invoice_id
), evidence AS (
    SELECT x.*, b.qty,
           x.untouched OR b.lines = 1 AND right(b.description, length(x.period_text)) = x.period_text OR
           b.lines = x.entries AND bool_and(CASE WHEN x.pos = 1 THEN right(l.description, length(x.entry_text) + 3) = ' · ' || x.entry_text
                                                 ELSE l.quantity = x.quantity AND l.description = x.entry_text END IS TRUE)
                                   OVER (PARTITION BY x.invoice_id) AS identifiable
    FROM linked x LEFT JOIN billed b ON b.invoice_id = x.invoice_id
    LEFT JOIN invoice_lines l ON l.invoice_id = x.invoice_id AND l.position = x.pos
), allocations AS (
    SELECT *, billing = 'advance' AND pos = 1 AS can_be_partial,
           coalesce(identifiable AND qty BETWEEN total - quantity + 1 AND total, false) AS known
    FROM evidence
)
INSERT INTO engagement_entry_allocations (entry_id, invoice_id, quantity, historical_estimate)
SELECT id, invoice_id, CASE WHEN can_be_partial AND known THEN qty - total + quantity ELSE quantity END,
       can_be_partial AND NOT known
FROM allocations;

ALTER TABLE engagement_entries DROP COLUMN invoice_id;

-- +goose Down
-- Multiple allocations cannot be represented by the old schema.
-- +goose StatementBegin
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM engagement_entry_allocations a JOIN engagement_entries e ON e.id = a.entry_id
               GROUP BY a.entry_id HAVING count(*) > 1 OR bool_or(a.quantity <> e.quantity)) THEN
        RAISE EXCEPTION 'Cannot downgrade partial or multiple invoice allocations';
    END IF;
END $$;
-- +goose StatementEnd
ALTER TABLE engagement_entries ADD COLUMN invoice_id text REFERENCES invoices(id) ON DELETE SET NULL;
UPDATE engagement_entries e SET invoice_id = a.invoice_id FROM engagement_entry_allocations a WHERE a.entry_id = e.id;
DROP TABLE engagement_entry_allocations;
