package portal

import (
	"strings"
	"testing"
)

// quote adds a quote of wsp_a; number nil for a draft, pdfKey nil for none.
func (e *env) quote(id, client, status, issued, validUntil string, number, pdfKey any) {
	e.exec(`INSERT INTO quotes (id, workspace_id, client_id, number, status, issue_date, valid_until, currency, language, vat_mode,
		note, discount_percent, lines, subtotal, discount_amount, net_total, vat_total, total, rounding_amount, vat_breakdown,
		pdf_key, created_at, updated_at)
		VALUES ($1,'wsp_a',$2,$3,$4,$5,$6,'CHF','de','exclusive','internal only',0,'[]',10000,0,10000,810,10810,0,'[]',$7,now(),now())`,
		id, client, number, status, issued, validUntil, pdfKey)
}

func TestQuotesOwnSentOnly(t *testing.T) {
	e := newEnv(t)
	e.quote("quo_sent", "cli_1", "sent", "2026-01-05", "2099-01-05", "Q-2026-001", "quotes/sent.pdf")
	e.quote("quo_old", "cli_1", "sent", "2020-01-05", "2020-02-05", "Q-2020-001", "quotes/old.pdf")
	e.quote("quo_draft", "cli_1", "draft", "2026-01-05", "2099-01-05", nil, nil)
	e.quote("quo_other", "cli_2", "sent", "2026-01-05", "2099-01-05", "Q-2026-002", "quotes/other.pdf")
	e.files.objects["quotes/sent.pdf"] = []byte("%PDF-quote")
	c, csrf := e.signIn("ana@acme.ch")

	res, body := e.get(c, "/quotes")
	if res.StatusCode != 200 || !strings.Contains(body, "quo_sent") || strings.Contains(body, "quo_draft") ||
		strings.Contains(body, "quo_other") || strings.Contains(body, "internal only") || !strings.Contains(body, `"status":"expired"`) ||
		!strings.Contains(body, `"total":"108.10"`) {
		t.Fatalf("list: %d %s", res.StatusCode, body)
	}
	if res, body := e.get(c, "/quotes/quo_sent/pdf"); res.StatusCode != 200 || body != "%PDF-quote" ||
		!strings.Contains(res.Header.Get("Content-Disposition"), "Offerte-Q-2026-001.pdf") {
		t.Fatalf("pdf: %d %q", res.StatusCode, body)
	}

	for _, tc := range []struct {
		name, path string
		csrf       string
		status     int
		code       string
	}{
		{"no csrf", "/quotes/quo_sent/accept", "", 403, "csrf_failed"},
		{"draft", "/quotes/quo_draft/accept", csrf, 404, "not_found"},
		{"other client", "/quotes/quo_other/accept", csrf, 404, "not_found"},
		{"expired", "/quotes/quo_old/accept", csrf, 409, "invalid_state"},
		{"accept", "/quotes/quo_sent/accept", csrf, 200, ""},
		{"answered", "/quotes/quo_sent/decline", csrf, 409, "invalid_state"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			res, out := e.do("POST", tc.path, map[string]any{"note": "Gerne"}, c, tc.csrf)
			code := ""
			if errBody, ok := out["error"].(map[string]any); ok {
				code, _ = errBody["code"].(string)
			}
			if res.StatusCode != tc.status || code != tc.code {
				t.Fatalf("%d %s, want %d %s: %v", res.StatusCode, code, tc.status, tc.code, out)
			}
		})
	}
	var status, by, note string
	if err := e.raw.QueryRow(t.Context(), `SELECT status, decided_by, decision_note FROM quotes WHERE id = 'quo_sent'`).Scan(&status, &by, &note); err != nil ||
		status != "accepted" || by != "client" || note != "Gerne" {
		t.Fatalf("stored: %s %s %s %v", status, by, note, err)
	}
}
