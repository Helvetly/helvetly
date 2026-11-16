package workspaces

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

const (
	// maxCompanyRunes is the company name's limit in the invoice settings.
	maxCompanyRunes = 70
	// maxSuggestionRunes keeps a workspace name short enough for the switcher.
	maxSuggestionRunes = 40
	// suggestionMaxOutput bounds the one call. Input is bounded by bytes, an upper bound on tokens (a token is at
	// least one byte): instructions + schema + 70 runes of at most 4 bytes stay under suggestionMaxInput (checked in
	// the tests). On gpt-6-luna (regional rates 110000 / 550000 micro-USD per million) the worst case is
	// 1024 x 0.11 + 512 x 0.55 = about 395 micro-USD (under $0.0004), once per workspace.
	suggestionMaxOutput = 512
	suggestionMaxInput  = 1024
	suggestionTimeout   = 20 * time.Second
	// suggestionsPerDay caps new one-time uses by one person: workspaces are cheap to make.
	suggestionsPerDay = 5
)

const suggestionInstructions = "You name workspaces. Given only a company name, reply with a short, natural workspace name for it, " +
	"at most 40 characters: usually the company name without its legal form (AG, GmbH, Sàrl, Ltd, Inc). " +
	"Use only the given text. Reply as JSON with the field name."

var suggestionSchema = &aimodel.Schema{Name: "workspace_name", JSON: map[string]any{
	"type":                 "object",
	"properties":           map[string]any{"name": map[string]any{"type": "string"}},
	"required":             []string{"name"},
	"additionalProperties": false,
}}

// SetNamer gives the service the model for the one-time name suggestion: a provider pinned to the cheapest model
// (aimodel.DefaultModel), not the operator's Heidi model. Nil (no key) leaves the suggestion off.
func (s *Service) SetNamer(p aimodel.Provider) { s.namer = p }

type suggestionOut struct {
	Name        string `json:"name"`
	CompanyName string `json:"company_name"`
}

// suggestName is the one-time, per-request-consented AI suggestion of a workspace name from the company name.
// It also needs the person's own AI approval in this workspace (auth.RequireAIConsent), checked before the use is
// taken. It is a complimentary call outside the plan's token pool: the workspace's row in
// workspace_name_suggestions is taken before the model is asked, so the single use holds across retries, reloads
// and concurrent requests. Once the provider is reached the use stays spent whatever the outcome; before that
// (provider off, invalid input, no consent or approval, not the owner, already set up) nothing is spent.
func (s *Service) suggestName(w http.ResponseWriter, r *http.Request, sess store.Session) {
	if err := s.suggest(w, r, sess); err != nil {
		s.auth.WriteError(w, r, err)
	}
}

func (s *Service) suggest(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var in struct {
		CompanyName string `json:"company_name"`
		Consent     *bool  `json:"consent"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	if sess.Role != "owner" {
		return errOwnerOnly
	}
	if in.Consent == nil || !*in.Consent {
		return auth.Error(http.StatusBadRequest, "invalid_request", "Allow sending the company name to OpenAI to get a suggestion.",
			map[string]any{"fields": map[string]string{"consent": "required"}})
	}
	company := strings.TrimSpace(in.CompanyName)
	if company == "" || !utf8.ValidString(company) || utf8.RuneCountInString(company) > maxCompanyRunes || strings.ContainsFunc(company, unicode.IsControl) {
		return auth.Error(http.StatusBadRequest, "invalid_request", "Enter the company name first (up to 70 characters).",
			map[string]any{"fields": map[string]string{"company_name": "invalid"}})
	}
	if s.namer == nil {
		return auth.Error(http.StatusConflict, "ai_not_configured", "Name suggestions are not available on this server.", nil)
	}
	if !s.limit.Allow(r) {
		return auth.Error(http.StatusTooManyRequests, "rate_limited", "Wait a moment before asking again.", nil)
	}
	ctx, now, card := r.Context(), s.now(), s.namer.Card()
	var row store.NameSuggestion
	var outcome store.NameSuggestionOutcome
	err := s.db.Tx(ctx, func(q store.Q) (err error) {
		// The request's narrow consent covers only the company name; the person's general AI approval is required too
		// and is never granted here.
		if err := auth.RequireAIConsent(ctx, q, sess.Workspace.ID, sess.User.ID); err != nil {
			return err
		}
		row, outcome, err = q.ReserveNameSuggestion(ctx, store.NameSuggestion{WorkspaceID: sess.Workspace.ID, RequestedBy: sess.User.ID,
			CompanyName: company, RateCard: card.Version, Model: card.Model}, suggestionsPerDay, now)
		return err
	})
	if err != nil {
		return err
	}
	switch outcome {
	case store.NameNoWorkspace:
		return auth.ErrNotFound
	case store.NameOnboarded:
		return auth.Error(http.StatusConflict, "already_set_up", "This workspace is already set up.", nil)
	case store.NameLimited:
		return auth.Error(http.StatusTooManyRequests, "rate_limited", "Too many suggestions today. Enter a name yourself.", nil)
	case store.NameExisting:
		return s.answerExisting(w, row, company)
	}
	row = s.askModel(ctx, row, company, card)
	if row.Status != "done" {
		return auth.Error(http.StatusBadGateway, "ai_unavailable", "Couldn't suggest a name. Enter one yourself.", nil)
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": suggestionOut{Name: row.Suggestion, CompanyName: row.CompanyName}})
	return nil
}

// answerExisting is the idempotent answer for a use already taken: the stored suggestion for the same company name,
// never a second call.
func (s *Service) answerExisting(w http.ResponseWriter, row store.NameSuggestion, company string) error {
	switch {
	case row.Status == "reserved":
		return auth.Error(http.StatusConflict, "suggestion_pending", "A suggestion is on its way. Wait a moment.", nil)
	case row.Status == "done" && row.CompanyName == company:
		auth.WriteJSON(w, http.StatusOK, map[string]any{"data": suggestionOut{Name: row.Suggestion, CompanyName: row.CompanyName}})
		return nil
	}
	return auth.Error(http.StatusConflict, "suggestion_used", "The one-time suggestion has been used. Enter a name yourself.", nil)
}

// askModel makes the single call and records its outcome. The call runs to its own end even when the client has gone,
// so a started generation is never lost and the stored result answers the next request; its own timeout bounds it.
func (s *Service) askModel(ctx context.Context, row store.NameSuggestion, company string, card aimodel.RateCard) store.NameSuggestion {
	call, cancel := context.WithTimeout(context.WithoutCancel(ctx), suggestionTimeout)
	defer cancel()
	reply, err := s.namer.Answer(call, aimodel.Request{Instructions: suggestionInstructions, Message: company,
		Schema: suggestionSchema, MaxOutputTokens: suggestionMaxOutput})
	row.Status = "unaccounted"
	if reply.Tokens != nil && *reply.Tokens >= 0 {
		row.Status = "failed" // the provider reported its usage: a known outcome, but nothing usable unless the answer is good
		if u := reply.Usage; u != nil && u.Input >= 0 && u.Output >= 0 && u.CachedInput >= 0 && u.CachedInput <= u.Input {
			cost := card.Cost(u.Input-u.CachedInput, u.CachedInput, u.Output)
			row.InputTokens, row.OutputTokens, row.CostMicros = &u.Input, &u.Output, &cost
		}
		if err == nil {
			if name, ok := cleanSuggestion(reply.Text); ok {
				row.Status, row.Suggestion = "done", name
			}
		}
	}
	// Settled outside the request's context, so a cancelled client still leaves the record.
	settle, stop := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer stop()
	if serr := s.db.Tx(settle, func(q store.Q) error { return q.SettleNameSuggestion(settle, row, s.now()) }); serr != nil {
		s.log.ErrorContext(settle, "settle name suggestion", "workspace", row.WorkspaceID, "error", serr)
		row.Status = "unaccounted" // never shown as a result that was not stored
	}
	return row
}

var spaces = regexp.MustCompile(`\s+`)

// cleanSuggestion reads the model's JSON, then trims, collapses spaces and strips surrounding quotes; false when the
// result is not a usable workspace name (empty, over 40 characters, control characters).
func cleanSuggestion(text string) (string, bool) {
	var out struct {
		Name string `json:"name"`
	}
	if json.Unmarshal([]byte(text), &out) != nil {
		return "", false
	}
	name := spaces.ReplaceAllString(strings.TrimSpace(out.Name), " ")
	name = strings.TrimSpace(strings.Trim(name, "\"'“”‘’«»"))
	if name == "" || utf8.RuneCountInString(name) > maxSuggestionRunes || validName(name) == "" {
		return "", false
	}
	return name, true
}
