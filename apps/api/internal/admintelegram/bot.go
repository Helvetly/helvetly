package admintelegram

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/store"
)

// Bot answers the operator's read-only questions in the admin chat. It long-polls Telegram's getUpdates (no public
// endpoint) while it holds the database lease, so only one instance polls during a blue/green deploy. Messages from
// any other chat are ignored and logged without their text.
type Bot struct {
	api    string // https://api.telegram.org/bot<token>/
	chatID int64
	client *http.Client
	db     *store.Store
	log    *slog.Logger
	holder string
	now    func() time.Time

	// Limits, when set, gives a workspace's caps (Unlimited = -1) for /workspace.
	Limits Limits
	// Model, when set, routes free-text questions to a command (nil: they get /help).
	Model   aimodel.Provider
	Version string
	started time.Time

	registered bool
	rate       rateLimit
}

// Limits are a workspace's storage cap and both AI pools' monthly tokens, -1 when unlimited.
type Limits func(ctx context.Context, workspaceID string) (storage, heidiTokens, automationTokens int64, err error)

const (
	leaseTTL     = 90 * time.Second
	pollSeconds  = 25
	standbyDelay = 30 * time.Second // another instance polls, or Telegram answered 409
)

func NewBot(token string, chatID int64, db *store.Store, log *slog.Logger) *Bot {
	return &Bot{
		api:    "https://api.telegram.org/bot" + token + "/",
		chatID: chatID,
		client: &http.Client{
			Timeout:       (pollSeconds + 15) * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		db:      db,
		log:     log,
		holder:  rand.Text(),
		now:     time.Now,
		started: time.Now(),
		rate:    rateLimit{max: 20, window: time.Minute},
	}
}

func (b *Bot) Run(ctx context.Context) {
	defer func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		defer cancel()
		if err := b.db.ReleaseAdminBot(ctx, b.holder); err != nil {
			b.log.Warn("admin Telegram bot: release lease", "error", err)
		}
	}()
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			timer.Reset(b.tick(ctx))
		}
	}
}

// tick polls once while this instance holds the lease and answers what came; it returns the wait before the next.
func (b *Bot) tick(ctx context.Context) time.Duration {
	offset, ok, err := b.db.ClaimAdminBot(ctx, b.holder, leaseTTL)
	if err != nil {
		if ctx.Err() == nil {
			b.log.Warn("admin Telegram bot: lease", "error", err)
		}
		return time.Minute
	}
	if !ok {
		b.registered = false
		return standbyDelay
	}
	if !b.registered {
		if err := b.registerCommands(ctx); err != nil {
			b.log.Warn("admin Telegram bot: setMyCommands", "error", err)
		} else {
			b.registered = true
		}
	}
	var updates []update
	err = b.call(ctx, "getUpdates", map[string]any{"offset": offset, "timeout": pollSeconds, "allowed_updates": []string{"message"}}, &updates)
	if err != nil {
		if ctx.Err() != nil {
			return 0
		}
		var e *apiError
		if errors.As(err, &e) && e.code == http.StatusConflict {
			// Another poller or a webhook holds the bot: wait instead of spinning.
			b.log.Warn("admin Telegram bot: getUpdates conflict; another poller or a webhook is active")
			return standbyDelay
		}
		b.log.Warn("admin Telegram bot: getUpdates", "error", err)
		if errors.As(err, &e) && e.retryAfter > 0 {
			return e.retryAfter
		}
		return 10 * time.Second
	}
	for _, u := range updates {
		offset = max(offset, u.ID+1)
		b.handle(ctx, u)
	}
	if len(updates) > 0 {
		if err := b.db.SaveAdminBotOffset(ctx, b.holder, offset); err != nil {
			b.log.Warn("admin Telegram bot: save offset", "error", err)
		}
	}
	return 0
}

type update struct {
	ID      int64 `json:"update_id"`
	Message *struct {
		Chat struct {
			ID int64 `json:"id"`
		} `json:"chat"`
		Text string `json:"text"`
	} `json:"message"`
}

func (b *Bot) handle(ctx context.Context, u update) {
	if u.Message == nil || u.Message.Chat.ID != b.chatID {
		chat := int64(0)
		if u.Message != nil {
			chat = u.Message.Chat.ID
		}
		b.log.Warn("admin Telegram bot: ignored an update from another chat", "update_id", u.ID, "chat_id", chat)
		return
	}
	switch b.rate.take(b.now()) {
	case rateRefused:
		return
	case rateNotify:
		b.reply(ctx, "Too many questions. Try again in a minute.")
		return
	}
	text := strings.TrimSpace(u.Message.Text)
	if text == "" {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	var answer string
	if strings.HasPrefix(text, "/") {
		answer = b.answer(ctx, text)
	} else {
		answer = b.freeText(ctx, text)
	}
	b.reply(ctx, answer)
}

// answer runs a command line ("/signups 5"); a malformed one gets its usage, a failure a short error.
func (b *Bot) answer(ctx context.Context, line string) string {
	cmd, err := parse(line)
	if err != nil {
		return esc(err.Error()) + "\n\n" + helpText
	}
	out, err := b.run(ctx, cmd)
	if errors.Is(err, store.ErrNotFound) {
		return "No workspace matches " + esc(cmd.arg) + "."
	}
	if err != nil {
		b.log.Error("admin Telegram bot: command failed", "command", cmd.name, "error", err)
		return "That failed; see the server log."
	}
	return out
}

func (b *Bot) reply(ctx context.Context, text string) {
	if len(text) > 4000 {
		text = text[:4000] + "…"
	}
	err := b.call(ctx, "sendMessage", map[string]any{"chat_id": b.chatID, "text": text, "parse_mode": "HTML",
		"link_preview_options": map[string]bool{"is_disabled": true}}, nil)
	if err != nil {
		b.log.Warn("admin Telegram bot: sendMessage", "error", err)
	}
}

func (b *Bot) registerCommands(ctx context.Context) error {
	list := make([]map[string]string, 0, len(commands))
	for _, c := range commands {
		list = append(list, map[string]string{"command": c.name, "description": c.description})
	}
	return b.call(ctx, "setMyCommands", map[string]any{"commands": list,
		"scope": map[string]any{"type": "chat", "chat_id": b.chatID}}, nil)
}

type apiError struct {
	method     string
	code       int
	retryAfter time.Duration
}

func (e *apiError) Error() string {
	return fmt.Sprintf("Telegram %s failed (HTTP %d)", e.method, e.code)
}

// call posts one Bot API method; out receives its result. Errors never carry the URL, which holds the bot token.
func (b *Bot) call(ctx context.Context, method string, body, out any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, b.api+method, bytes.NewReader(payload))
	if err != nil {
		return errors.New("invalid Telegram request")
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := b.client.Do(req)
	if err != nil {
		return errors.New("Telegram " + method + " request failed")
	}
	defer res.Body.Close()
	var result struct {
		OK         bool            `json:"ok"`
		Result     json.RawMessage `json:"result"`
		Parameters struct {
			RetryAfter int `json:"retry_after"`
		} `json:"parameters"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(nil, res.Body, 1<<20)).Decode(&result); err != nil || !result.OK || res.StatusCode != http.StatusOK {
		return &apiError{method: method, code: res.StatusCode, retryAfter: time.Duration(max(0, min(result.Parameters.RetryAfter, 3600))) * time.Second}
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(result.Result, out)
}

type rateResult int

const (
	rateAllowed rateResult = iota
	rateNotify             // the first message over the limit: say so once
	rateRefused
)

// rateLimit allows max messages per fixed window.
type rateLimit struct {
	max    int
	window time.Duration
	start  time.Time
	count  int
}

func (r *rateLimit) take(now time.Time) rateResult {
	if now.Sub(r.start) >= r.window {
		r.start, r.count = now, 0
	}
	r.count++
	switch {
	case r.count <= r.max:
		return rateAllowed
	case r.count == r.max+1:
		return rateNotify
	}
	return rateRefused
}
