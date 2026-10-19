package reader

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDeepSeekReasoningStreamsSeparatelyFromAnswer(t *testing.T) {
	s, _ := prepareConversationFixture(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			respond(w, 200, map[string]any{"data": []any{map[string]string{"id": "test"}}})
			return
		}
		writeConversationReply(w, "最终答案", "先核对原文，再回答。")
	}))
	defer upstream.Close()
	configureDocumentAPI(t, s, upstream.URL)
	out := conversationRequest(t, s, "api", "请解释")
	if !strings.Contains(out.Body.String(), "event: reasoning") {
		t.Fatal("thinking deltas never reached the renderer", out.Body.String())
	}
	history, _ := s.Store.chatHistory("doc")
	raw := jsonText(history[len(history)-1])
	if !strings.Contains(raw, `"reasoning"`) || !strings.Contains(raw, "先核对原文") || strings.Contains(history[len(history)-1].Content, "先核对原文") {
		t.Fatal("thinking not saved separately", raw)
	}
	if strings.Contains(jsonText(conversationHistory(history)), "先核对原文") {
		t.Fatal("displayed thinking duplicated into question history")
	}
}
