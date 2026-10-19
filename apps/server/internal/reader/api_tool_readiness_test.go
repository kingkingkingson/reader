package reader

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDocumentChatChecksMissingToolCapabilityOnce(t *testing.T) {
	s, _ := pageImageFixture(t, true)
	probes, reads := 0, 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			respond(w, 200, map[string]any{"data": []any{map[string]string{"id": "test"}}})
			return
		}
		var p struct {
			Messages []toolCompletionMessage `json:"messages"`
			Tools    []any                   `json:"tools"`
		}
		_ = json.NewDecoder(r.Body).Decode(&p)
		if strings.Contains(jsonText(p.Messages), "Call reader_probe once") {
			if p.Messages[len(p.Messages)-1].Role == "tool" {
				writeConversationReply(w, p.Messages[len(p.Messages)-1].Content.(string), "")
				return
			}
			probes++
			writeToolReply(w, "reader_probe", `{}`)
			return
		}
		if !strings.Contains(jsonText(p.Tools), "read_pdf_pages") {
			writeConversationReply(w, "NO_TOOLS", "")
			return
		}
		if p.Messages[len(p.Messages)-1].Content == "再解释一次" {
			writeConversationReply(w, "说明 [S2]", "")
			return
		}
		if len(p.Messages[len(p.Messages)-1].PageImages) == 0 && !strings.Contains(jsonText(p.Messages), "image_url") {
			reads++
			writeToolReply(w, "read_pdf_pages", `{"pages":[2]}`)
			return
		}
		writeConversationReply(w, "第二页图像说明 [S2]", "")
	}))
	defer upstream.Close()
	c := AIConfig{Primary: "api", API: APIConnection{URL: upstream.URL}, Models: map[string]string{"api": "test"}, APIModels: []string{"test"}, Capabilities: map[string]Capability{}}
	passModels(&c, map[string]bool{"test": true}) // Legacy configuration: text/vision passed, no tool result.
	if err := s.writeAIConfig(c); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		out := conversationRequest(t, s, "api", "第二页的图讲的是什么")
		if !strings.Contains(out.Body.String(), "event: done") || strings.Contains(out.Body.String(), "NO_TOOLS") {
			t.Fatalf("document chat silently ran without tools: %s", out.Body.String())
		}
	}
	if probes != 1 || reads != 1 {
		t.Fatal("missing probe cache or visual read", probes, reads)
	}
	if c = s.aiConfig(); c.Capabilities["api:test"].Tools != "passed" {
		t.Fatal("tool check not persisted")
	}
}

func TestMultimodalToolRequestDoesNotUseTextOnlyBodyLimit(t *testing.T) {
	called := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; writeConversationReply(w, "ok", "") }))
	defer upstream.Close()
	request := completionRequest{Model: "vision", Vision: true, PageImageData: func(documentPageImage) ([]byte, error) { return []byte(strings.Repeat("x", 4<<20)), nil }}
	messages := []toolCompletionMessage{{Role: "user", Content: "page", PageImages: []documentPageImage{{Page: 1, SourceID: "S1"}}}}
	if _, err := toolCompletion(t.Context(), APIConnection{URL: upstream.URL}, request, messages, nil); err != nil || !called {
		t.Fatal("valid image payload rejected by text-only ceiling", err)
	}
}
