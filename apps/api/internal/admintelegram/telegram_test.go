package admintelegram

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

func TestQueuedAlertRetriesThenCompletes(t *testing.T) {
	db, pool := storetest.New(t)
	ctx := context.Background()

	if err := db.QueueAdminAlert(ctx, "disabled"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := db.ClaimAdminAlert(ctx); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("disabled integration queued an alert: %v", err)
	}

	db.EnableAdminAlerts()
	rollback := errors.New("roll back")
	err := db.Tx(ctx, func(q store.Q) error {
		if err := q.QueueAdminAlert(ctx, "rolled back"); err != nil {
			return err
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatal(err)
	}
	if err := db.QueueAdminAlert(ctx, "Nowa rejestracja"); err != nil {
		t.Fatal(err)
	}

	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ChatID int64  `json:"chat_id"`
			Text   string `json:"text"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || r.Method != "POST" || body.ChatID != 123456789012 || body.Text != "Helvetly\nNowa rejestracja" {
			t.Errorf("invalid Telegram request: %v, %#v", err, body)
		}
		w.Header().Set("Content-Type", "application/json")
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"ok":false,"parameters":{"retry_after":90}}`))
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	s := New("123:test-token", 123456789012)
	s.endpoint = server.URL

	if delay, err := s.deliver(ctx, db); delay != 90*time.Second || err == nil {
		t.Fatalf("first attempt: delay = %v, err = %v", delay, err)
	}
	if _, _, err := db.ClaimAdminAlert(ctx); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("retried too soon: %v", err)
	}

	if _, err := pool.Exec(ctx, `UPDATE admin_alerts SET ready_at = now()`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.deliver(ctx, db); err != nil {
		t.Fatal(err)
	}
	var remaining int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM admin_alerts`).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("queue contains %d alerts, err = %v", remaining, err)
	}
}
