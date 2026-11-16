package heidi

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestChatStreamSendsKeepAliveWhileTheModelWorks(t *testing.T) {
	s, mux, _, _ := fixture(t)
	s.keepAlive = 5 * time.Millisecond
	tokens := int64(3)
	s.provider = &testProvider{input: 10, answer: func(context.Context, ProviderRequest) (ProviderReply, error) {
		time.Sleep(60 * time.Millisecond) // a slow model call: the stream would otherwise be silent
		return ProviderReply{Text: "Explanation.", Tokens: &tokens}, nil
	}}
	w := chat(t, mux, "slow", "Explain this accounting term")
	body := w.Body.String()
	status := strings.Index(body, `"type":"status"`)
	ping := strings.Index(body, ": ping\n\n")
	text := strings.Index(body, `"type":"text"`)
	if w.Code != 200 || status < 0 || ping < status || text < ping || !strings.Contains(body, `"type":"done"`) {
		t.Fatalf("stream: %d %q", w.Code, body)
	}
}

func TestKeepAliveWaitsForTheStreamToStart(t *testing.T) {
	// Before the first event an error is still a JSON response, so no comment may commit the SSE headers.
	w := httptest.NewRecorder()
	st := &stream{w: w}
	stop := st.keepAlive(time.Millisecond)
	time.Sleep(20 * time.Millisecond)
	stop()
	if w.Body.Len() != 0 || w.Header().Get("Content-Type") != "" {
		t.Fatalf("unstarted stream wrote %q %v", w.Body, w.Header())
	}
}
