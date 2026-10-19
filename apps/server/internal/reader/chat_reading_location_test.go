package reader

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChatReadingLocationValidation(t *testing.T) {
	s, _ := prepareConversationFixture(t)
	for _, location := range []string{
		`{"type":"pdf","page":1}`, `{"type":"epub","href":"../outside"}`,
		`{"type":"epub","href":"a.xhtml","progression":2}`, `null`,
		`{"type":"epub","href":"a.xhtml","locator":"invalid"}`,
		`{"type":"epub","href":"a.xhtml","extra":"` + strings.Repeat("x", 16384) + `"}`,
	} {
		out := request(t, s, "POST", "/api/documents/doc/chat", strings.NewReader(`{"provider":"api","prompt":"这里是什么","context":"","readingLocation":`+location+`}`))
		if out.Code != http.StatusBadRequest {
			t.Fatalf("accepted invalid reading location: %d", out.Code)
		}
	}
	history, _ := s.Store.chatHistory("doc")
	if len(history) != 0 {
		t.Fatal("invalid position saved a message")
	}
}

func TestDocumentReadingLocationIsNavigationUntilToolRead(t *testing.T) {
	_, a := prepareConversationFixture(t)
	position := json.RawMessage(`{"type":"epub","href":"b.xhtml#end","progression":0.7,"locator":"{}"}`)
	in := AIInput{Chat: &chatInput{Title: "test", Question: "这里的实验是什么", ReadingLocation: position}}
	a.provider = "api"
	if _, err := a.beginConversation(t.Context(), in, "test"); err != nil {
		t.Fatal(err)
	}
	prompt := a.conversationInput(in, true)
	if !strings.Contains(prompt, `"sectionId":"b.xhtml"`) || strings.Contains(prompt, "37 transactions") || strings.Contains(prompt, "COBALT-19") || len(a.Evidence) != 0 {
		t.Fatal("navigation attached original text or counted as evidence", prompt)
	}
	if _, err := a.call(t.Context(), "read_passage", readingLocationSelector(position)); err != nil {
		t.Fatal(err)
	}
	if len(a.Evidence) == 0 || !strings.Contains(jsonText(a.Evidence), "37 transactions") {
		t.Fatal("could not read the captured chapter")
	}
	for _, e := range a.Evidence {
		if !strings.Contains(string(e.Location), "b.xhtml") {
			t.Fatal("read another chapter")
		}
	}
	if string(readingLocationSelector(json.RawMessage(`{"type":"pdf","page":13}`))) != `{"fromPage":13,"toPage":13}` {
		t.Fatal("PDF snapshot did not map to the exact page")
	}
}

func TestAPIReadingPositionPersistsAndKeepsToollessFallback(t *testing.T) {
	for _, tools := range []bool{true, false} {
		t.Run(map[bool]string{true: "agent", false: "text-only"}[tools], func(t *testing.T) {
			s, _ := prepareConversationFixture(t)
			calls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "GET" {
					respond(w, 200, map[string]any{"data": []any{map[string]string{"id": "test"}}})
					return
				}
				var payload struct {
					Messages []toolCompletionMessage `json:"messages"`
				}
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Error(err)
					return
				}
				calls++
				text := jsonText(payload.Messages)
				if !strings.Contains(text, "导航信息") || !strings.Contains(text, `b.xhtml`) {
					t.Error("sending position missing")
				}
				if strings.Contains(text, "37 transactions") == tools {
					t.Error("agent auto-attached source or text-only fallback lost current chapter")
				}
				writeConversationReply(w, "已收到问题", "")
			}))
			defer upstream.Close()
			configureDocumentAPI(t, s, upstream.URL)
			if !tools {
				config := s.aiConfig()
				capability := config.Capabilities["api:test"]
				capability.Tools = "unsupported"
				config.Capabilities["api:test"] = capability
				if err := s.writeAIConfig(config); err != nil {
					t.Fatal(err)
				}
			}
			out := request(t, s, "POST", "/api/documents/doc/chat", strings.NewReader(`{"provider":"api","prompt":"这里讲了什么","context":"","readingLocation":{"type":"epub","href":"b.xhtml#end","progression":0.7}}`))
			if strings.Count(out.Body.String(), "event: done") != 1 || calls != 1 {
				t.Fatal("request failed", out.Body.String(), calls)
			}
			history, err := s.Store.chatHistory("doc")
			if err != nil || len(history) != 2 || history[0].Context != "" || len(history[0].References) > 0 || !strings.Contains(string(history[0].ReadingLocation), "b.xhtml#end") {
				t.Fatal("position was not stored independently", history, err)
			}
			mirror := conversationHistory(history)
			if !strings.Contains(jsonText(mirror), "b.xhtml#end") {
				t.Fatal("provider handoff lost previous question's position")
			}
		})
	}
}
