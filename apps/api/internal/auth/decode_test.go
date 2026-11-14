package auth

import (
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeRequiresEndOfBody(t *testing.T) {
	s := &Service{log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	for _, body := range []string{`{}]`, `{} }`, `{} {}`, `{}garbage`, `{}` + strings.Repeat(" ", 64<<10)} {
		t.Run(body[:min(15, len(body))], func(t *testing.T) {
			r := httptest.NewRequest("POST", "/", strings.NewReader(body))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			var out struct{}
			if s.Decode(w, r, &out) || w.Code != 400 {
				t.Fatalf("invalid body accepted: status %d", w.Code)
			}
		})
	}
	r := httptest.NewRequest("POST", "/", strings.NewReader("{} \r\n\t"))
	r.Header.Set("Content-Type", "application/json")
	if !s.Decode(httptest.NewRecorder(), r, &struct{}{}) {
		t.Fatal("valid trailing whitespace refused")
	}
}
