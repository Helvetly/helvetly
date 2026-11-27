package admintelegram

import (
	"context"
	"encoding/json"
	"slices"

	"helvetly.com/api/internal/aimodel"
)

// The model only picks one of the commands and its argument (a strict JSON schema); it never sees the data, and the
// command runs through the same parsing as a typed one. Its tokens count against the operator's own daily cap
// (operator_ai_usage), never a workspace's pools.
const (
	operatorDailyTokens = 100_000
	routeMaxOutput      = 100
	maxQuestion         = 500
)

var routeInstructions = `You route questions from the operator of the Helvetly business software to exactly one read-only command.
Commands: stats (overview), users (users, sign-ups, active people), workspaces (created, deleted), paid (paying workspaces,
plans, trials, past due, cancellations, seats, MRR, ARR), signups (latest sign-ups; argument: how many, 1-25, or empty),
workspace (one workspace; argument: its id, portal slug or a member's email), usage (storage, AI tokens and cost, emails,
top workspaces), health (version, uptime, database connections, queues, failures), help (anything else).
Answer with the command and its argument ("" when none). Never invent an argument the question does not give.`

func routeSchema() *aimodel.Schema {
	names := []string{}
	for _, c := range commands {
		names = append(names, c.name)
	}
	return &aimodel.Schema{Name: "operator_command", JSON: map[string]any{
		"type": "object",
		"properties": map[string]any{
			"command":  map[string]any{"type": "string", "enum": names},
			"argument": map[string]any{"type": "string"},
		},
		"required":             []string{"command", "argument"},
		"additionalProperties": false,
	}}
}

func (b *Bot) freeText(ctx context.Context, text string) string {
	if b.Model == nil {
		return helpText
	}
	cmd, err := b.route(ctx, text)
	if err != nil {
		b.log.Warn("admin Telegram bot: free-text routing", "error", err)
		return "I could not answer that. " + helpText
	}
	if cmd == "" {
		return "Today's AI allowance for the bot is used up.\n\n" + helpText
	}
	return b.answer(ctx, cmd)
}

// route asks the model for a command line; "" when today's operator allowance cannot take the call.
func (b *Bot) route(ctx context.Context, text string) (string, error) {
	if r := []rune(text); len(r) > maxQuestion {
		text = string(r[:maxQuestion])
	}
	req := aimodel.Request{Instructions: routeInstructions, Message: text, Schema: routeSchema(), MaxOutputTokens: routeMaxOutput}
	input, err := b.Model.InputTokens(ctx, req)
	if err != nil {
		return "", err
	}
	reserved := input + routeMaxOutput
	now := b.now()
	ok, err := b.db.ReserveOperatorAI(ctx, now, reserved, operatorDailyTokens)
	if err != nil || !ok {
		return "", err
	}
	reply, err := b.Model.Answer(ctx, req)
	card := b.Model.Card()
	used, cost := reserved, card.WorstCost(reserved)
	if reply.Tokens != nil {
		used = *reply.Tokens
	}
	if u := reply.Usage; u != nil {
		cost = card.Cost(u.Input-u.CachedInput, u.CachedInput, u.Output)
	}
	if err := b.db.SettleOperatorAI(context.WithoutCancel(ctx), now, reserved, used, cost); err != nil {
		b.log.Warn("admin Telegram bot: settle AI usage", "error", err)
	}
	if err != nil {
		return "", err
	}
	var pick struct{ Command, Argument string }
	if err := json.Unmarshal([]byte(reply.Text), &pick); err != nil || !slices.ContainsFunc(commands, func(c struct{ name, args, description string }) bool {
		return c.name == pick.Command
	}) {
		return "/help", nil
	}
	return "/" + pick.Command + " " + pick.Argument, nil
}
