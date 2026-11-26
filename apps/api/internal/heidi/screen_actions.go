// The model chooses one control offered by the current browser turn. Only the browser can activate it.
package heidi

import (
	"encoding/json"
	"regexp"
	"slices"
	"strings"

	"helvetly.com/api/internal/aimodel"
)

var controlID = regexp.MustCompile(`^(click|fill|select)\.[a-zA-Z][a-zA-Z0-9]{0,95}$`)

func offeredControls(raw string) ([]string, bool) {
	if raw == "" {
		return nil, true
	}
	controls := strings.Split(raw, ",")
	if len(controls) > 128 {
		return nil, false
	}
	for _, control := range controls {
		if path, ok := strings.CutPrefix(control, "open."); ok {
			if !pagePath.MatchString(path) || screen(path) == "" {
				return nil, false
			}
		} else if !controlID.MatchString(control) {
			return nil, false
		}
	}
	return controls, true
}

func (s *Service) screenAction(generate func(string, string, *aimodel.Schema) (ProviderReply, error), controls []string) (turn, error) {
	choices := append(slices.Clone(controls), "none")
	schema := objectSchema("heidi_screen_action", map[string]any{
		"control": map[string]any{"type": "string", "enum": choices}, "answer": stringField, "value": stringField, "row": stringField,
	})
	reply, err := generate("screen", `Help with the requested task in the signed-in interface. The control enum contains the pages and named controls offered by the current browser. open. paths navigate, click. activates a control, fill. enters text, select. chooses the exact visible option. Use a control only if it directly serves the current request. For a record-specific control in a list return the exact visible record name or number from the request in row. For fill or select return the exact requested value; otherwise leave value empty. Open the relevant page first when necessary. If no matching control is available, choose none and explain the next manual step or ask a question. In answer explain what the person can do using the offered action, in the user's language. Never claim it already happened. Never request secrets.`, schema)
	if err != nil {
		return turn{}, err
	}
	var p struct{ Control, Answer, Value, Row string }
	if json.Unmarshal([]byte(reply.Text), &p) != nil || strings.TrimSpace(p.Answer) == "" || !slices.Contains(choices, p.Control) || len(p.Value) > 1000 || len(p.Row) > 256 {
		return turn{}, invalid("The screen action could not be identified.")
	}
	t := turn{Text: p.Answer, Model: true}
	if p.Control != "none" {
		if !(strings.HasPrefix(p.Control, "fill.") || strings.HasPrefix(p.Control, "select.")) && p.Value != "" {
			return turn{}, invalid("This screen control does not accept a value.")
		}
		t.Actions = []Action{{ID: "screen_action", Control: p.Control, Value: p.Value, Row: p.Row}}
	}
	return t, nil
}
