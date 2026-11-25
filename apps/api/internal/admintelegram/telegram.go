// Package admintelegram delivers the operator's queued alerts to a private Telegram chat.
package admintelegram

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"helvetly.com/api/internal/store"
)

type Sender struct {
	endpoint string
	chatID   int64
	client   *http.Client
}

func New(token string, chatID int64) *Sender {
	return &Sender{
		endpoint: "https://api.telegram.org/bot" + token + "/sendMessage",
		chatID:   chatID,
		client: &http.Client{
			Timeout: 8 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (s *Sender) send(ctx context.Context, message string) (time.Duration, error) {
	payload, err := json.Marshal(struct {
		ChatID int64  `json:"chat_id"`
		Text   string `json:"text"`
	}{s.chatID, "Helvetly\n" + message})
	if err != nil {
		return 0, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.endpoint, bytes.NewReader(payload))
	if err != nil {
		return 0, errors.New("invalid Telegram request")
	}

	req.Header.Set("Content-Type", "application/json")
	res, err := s.client.Do(req)
	if err != nil {
		// The transport's error can include the bot token in the request URL.
		return 0, errors.New("Telegram request failed")
	}
	defer res.Body.Close()

	var result struct {
		OK         bool `json:"ok"`
		Parameters struct {
			RetryAfter int `json:"retry_after"`
		} `json:"parameters"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(nil, res.Body, 64<<10)).Decode(&result); err != nil || !result.OK || res.StatusCode != http.StatusOK {
		return time.Duration(max(0, min(result.Parameters.RetryAfter, 86400))) * time.Second, fmt.Errorf("Telegram delivery failed (HTTP %d)", res.StatusCode)
	}

	return 0, nil
}

func (s *Sender) Run(ctx context.Context, db *store.Store, log *slog.Logger) {
	timer := time.NewTimer(0)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			delay, err := s.deliver(ctx, db)
			if err != nil && ctx.Err() == nil {
				log.WarnContext(ctx, "admin Telegram alert", "error", err)
			}

			timer.Reset(max(delay, 3*time.Second))
		}
	}
}

func (s *Sender) deliver(ctx context.Context, db *store.Store) (time.Duration, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	id, message, err := db.ClaimAdminAlert(ctx)
	if errors.Is(err, store.ErrNotFound) {
		return 0, nil
	}
	if err != nil {
		return time.Minute, err
	}

	delay, err := s.send(ctx, message)
	if err != nil {
		delay = max(delay, time.Minute)
		return delay, errors.Join(err, db.RetryAdminAlert(ctx, id, delay))
	}

	return 0, db.CompleteAdminAlert(ctx, id)
}
