package heidi

import (
	"context"
	"helvetly.com/api/internal/aimodel"

	"net/http"
	"strings"
	"testing"
)

func TestScreenActionOffersOnlyControlsFromThisTurn(t *testing.T) {
	for _, raw := range []string{"open.//other", "open./api/v1/documents", "click.a[0]", strings.Repeat("click.edit,", 129)} {
		if _, ok := offeredControls(raw); ok {
			t.Errorf("accepted %q", raw)
		}
	}
	controls, ok := offeredControls("open./settings/scheduling,fill.name,click.save")
	if !ok {
		t.Fatal("valid controls refused")
	}
	for _, item := range []struct {
		target string
		valid  bool
	}{{"fill.name", true}, {"open./settings/api", false}} {
		reply := func(_, _ string, _ *aimodel.Schema) (ProviderReply, error) {
			return ProviderReply{Text: `{"control":"` + item.target + `","answer":"Review the action.","value":"","row":""}`}, nil
		}
		got, err := new(Service).screenAction(reply, controls)
		if (err == nil) != item.valid || item.valid && (len(got.Actions) != 1 || got.Actions[0].Control != item.target) {
			t.Errorf("%s: %+v %v", item.target, got, err)
		}
	}
}

func TestExplicitImportInAnotherLanguageAndOrdinaryAttachmentReading(t *testing.T) {
	s, mux, p, _ := modelFixture(t)
	s.SetAPI(http.NotFoundHandler())
	p.scope = func(r ProviderRequest) (ProviderReply, error) {
		if len(r.Files) != 0 {
			t.Fatal("classifier received the attachment")
		}
		op := "none"
		if strings.Contains(r.Message, "インポート") {
			op = "review_attached_import"
		}
		return ProviderReply{Text: `{"in_scope":true,"reason":"attached record","operation":"` + op + `","read_file":false}`, Tokens: new(int64(1))}, nil
	}
	p.answer = func(_ context.Context, r ProviderRequest) (ProviderReply, error) {
		if strings.Contains(r.Message, "インポート") {
			if len(r.Files) != 0 {
				t.Fatal("sent unnecessary file to model for import review")
			}
			return ProviderReply{Text: "インポートする種類を選んでください。", Tokens: new(int64(1))}, nil
		}
		if len(r.Files) != 1 || r.Files[0].ContentType != "text/plain" || !strings.Contains(string(r.Files[0].Bytes), "Acme,10") {
			t.Fatalf("missing CSV text: %+v", r.Files)
		}
		return ProviderReply{Text: "Acme heeft 10 lessen.", Tokens: new(int64(1))}, nil
	}
	for i, tc := range []struct{ message, want string }{{"このファイルをインポートしてください", `"intent":"import"`}, {"Explain the important amounts in this file", "Acme heeft 10 lessen."}} {
		w := chat(t, mux, "chat"+string(rune('a'+i)), tc.message, "name,amount\nAcme,10\n")
		if w.Code != 200 || !strings.Contains(w.Body.String(), tc.want) {
			t.Errorf("%d %s", w.Code, w.Body)
		}
	}
}
