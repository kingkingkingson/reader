package reader

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func TestAPICompactionCheckpointBudget(t *testing.T) {
	for _, tc := range []struct {
		name           string
		window, output int
		images         bool
		wantError      bool
	}{
		{"room-for-detailed-handoff", 65536, 8000, false, false},
		{"small-window", 8192, 500, false, false},
		{"fresh-images-keep-their-space", 65536, 500, true, false},
		{"reject-oversized-checkpoint", 262144, 10001, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, a := prepareConversationFixture(t)
			a.contextTokens = tc.window
			a.needsCompaction = true
			question := "KEEP_THIS_QUESTION"
			if tc.images {
				question += strings.Repeat("问", 6500)
				a.canViewPages = true
			}
			messages := []toolCompletionMessage{{Role: "system", Content: "阅读规则"}, {Role: "user", Content: strings.Repeat("旧", tc.window/2)}, {Role: "assistant", Content: "已经确认的结论"}, {Role: "user", Content: question}}
			if tc.images {
				call := completionToolCall{ID: "pages", Type: "function"}
				call.Function.Name = "read_pdf_pages"
				call.Function.Arguments = `{"pages":[1,2,3,4]}`
				messages = append(messages, toolCompletionMessage{Role: "assistant", Calls: []completionToolCall{call}}, toolCompletionMessage{Role: "tool", CallID: call.ID, Content: "四页原图"}, toolCompletionMessage{Role: "user", Content: "工具页面资料", PageImages: []documentPageImage{{Page: 1}, {Page: 2}, {Page: 3}, {Page: 4}}})
			}
			a.conversation = &documentConversation{Messages: messages}
			before := jsonText(messages)
			calls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var payload struct {
					Messages []toolCompletionMessage `json:"messages"`
				}
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Error(err)
					return
				}
				calls++
				prompt := payload.Messages[0].Content.(string)
				match := regexp.MustCompile(`不超过约([0-9]+) tokens`).FindStringSubmatch(prompt)
				if len(match) != 2 {
					t.Error("checkpoint has no explicit budget")
					return
				}
				budget, _ := strconv.Atoi(match[1])
				if budget <= 0 || budget > 10000 {
					t.Error("invalid checkpoint cap", budget)
				}
				if tc.name == "room-for-detailed-handoff" && budget != 10000 {
					t.Error("summary still capped too tightly", budget)
				}
				if (tc.window == 8192 || tc.images) && budget >= 10000 {
					t.Error("budget ignored retained context", budget)
				}
				if strings.Contains(jsonText(payload.Messages), "KEEP_THIS_QUESTION") {
					t.Error("current question entered old-history summary")
				}
				writeConversationReply(w, strings.Repeat("结", tc.output), "")
			}))
			defer upstream.Close()
			next, err := compactAPIConversation(t.Context(), APIConnection{URL: upstream.URL}, completionRequest{Model: "test"}, a, messages)
			if calls == 0 {
				t.Fatal("summary never requested", err)
			}
			if (err != nil) != tc.wantError {
				t.Fatal("unexpected compact result", err)
			}
			if jsonText(messages) != before || jsonText(a.conversation.Messages) != before {
				t.Fatal("input history mutated")
			}
			if tc.wantError {
				if a.conversation.Compactions != 0 {
					t.Fatal("failed checkpoint committed")
				}
				return
			}
			if !strings.Contains(jsonText(next), "KEEP_THIS_QUESTION") || conversationTokens(next) >= a.inputTokenLimit() {
				t.Fatal("current work lost or compacted window over budget")
			}
			if tc.images && len(next[len(next)-1].PageImages) != 4 {
				t.Fatal("fresh images were discarded")
			}
		})
	}
}

func TestToollessEvidenceStaysWithCurrentQuestion(t *testing.T) {
	s, _ := prepareConversationFixture(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			respond(w, 200, map[string]any{"data": []any{map[string]string{"id": "test"}}})
			return
		}
		var p struct {
			Messages []toolCompletionMessage `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&p)
		last := p.Messages[len(p.Messages)-1]
		text, _ := last.Content.(string)
		if last.Role != "user" || !strings.Contains(text, "KEEP_THIS_QUESTION") || !strings.Contains(text, "本轮补充原文") {
			t.Error("source envelope displaced the current question", text)
		}
		writeConversationReply(w, "已回答", "")
	}))
	defer upstream.Close()
	configureDocumentAPI(t, s, upstream.URL)
	c := s.aiConfig()
	cap := c.Capabilities["api:test"]
	cap.Tools = "unsupported"
	c.Capabilities["api:test"] = cap
	if err := s.writeAIConfig(c); err != nil {
		t.Fatal(err)
	}
	if out := conversationRequest(t, s, "api", "KEEP_THIS_QUESTION cobalt"); !strings.Contains(out.Body.String(), "event: done") {
		t.Fatal(out.Body.String())
	}
}
