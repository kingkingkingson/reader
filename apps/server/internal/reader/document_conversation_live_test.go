package reader

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

func TestLiveContinuousDocumentConversation(t *testing.T) {
	provider := os.Getenv("READER_TEST_CONVERSATION_PROVIDER")
	if provider != "codex" && provider != "api" {
		t.Skip("set READER_TEST_CONVERSATION_PROVIDER=codex or api; original synthetic text only")
	}
	s, a := prepareConversationFixture(t)
	config := AIConfig{Primary: provider, Models: map[string]string{}, Capabilities: map[string]Capability{}}
	if provider == "api" {
		raw, err := os.ReadFile(os.Getenv("READER_TEST_DOCUMENT_API_CONFIG"))
		if err != nil {
			t.Fatal("Reader API connection unavailable")
		}
		var saved savedConfig
		if json.Unmarshal(raw, &saved) != nil {
			t.Fatal("invalid Reader API config")
		}
		config.API = saved.Config.API
		if config.API.URL != "https://api.deepseek.com" && config.API.URL != "https://api.deepseek.com/v1" {
			t.Fatal("expected official DeepSeek endpoint")
		}
		model := "deepseek-v4-pro"
		config.Models[provider] = model
		config.APIModels = []string{model}
		config.Capabilities[apiCapabilityKey(model)] = Capability{Text: true, Tools: "passed", ToolSchemaVersion: documentToolSchemaVersion, Fingerprint: configPrint(config, apiCapabilityKey(model))}
	} else {
		config.Capabilities[provider] = Capability{Text: true, Fingerprint: configPrint(config, provider)}
	}
	if err := s.writeAIConfig(config); err != nil {
		t.Fatal(err)
	}
	questions := []string{"请记住口令 LANTERN-72841，后面都用中文回答。请读原文确认 cobalt 协议的 nonce，并给出处。", "只复述我上轮要求记住的口令。", "继续上次的讨论：口令是什么？cobalt 协议只适用于什么交易？请引用原文。"}
	firstThread := ""
	for i, q := range questions {
		start := time.Now()
		out := conversationRequest(t, s, provider, q)
		if !strings.Contains(out.Body.String(), "event: done") {
			t.Fatal(out.Body.String())
		}
		history, err := s.Store.chatHistory("doc")
		if err != nil {
			t.Fatal(err)
		}
		answer := history[len(history)-1]
		if i > 0 && !strings.Contains(answer.Content, "LANTERN-72841") {
			t.Fatal("prior-turn requirement lost", answer.Content)
		}
		var raw string
		if err = s.Store.DB.QueryRow("SELECT body FROM document_conversations WHERE document_id='doc' AND provider=?", provider).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var state documentConversation
		_ = json.Unmarshal([]byte(raw), &state)
		if provider == "codex" {
			if i == 0 {
				firstThread = state.NativeThread
			}
			if state.NativeThread != firstThread {
				t.Fatal("thread changed between questions")
			}
		}
		usage, _ := s.Store.scopedUsageReport("doc", true)
		cached := "unknown"
		if usage.Total.CachedInputTokens != nil {
			cached = fmt.Sprint(*usage.Total.CachedInputTokens)
		}
		t.Logf("provider=%s turn=%d elapsed=%s history=%d compactions=%d model-calls=%d input=%d cached=%v output=%d", provider, i+1, time.Since(start).Round(time.Millisecond), len(history), state.Compactions, len(usage.Calls), usage.Total.InputTokens, cached, usage.Total.OutputTokens)
		if i == 1 {
			if provider == "api" {
				ctx, cancel := context.WithTimeout(t.Context(), 3*time.Minute)
				req, e := s.apiAgentAdapter(config, taskChat).resolve(ctx, false)
				if e != nil {
					cancel()
					t.Fatal(e)
				}
				a.ctx = ctx
				a.provider = provider
				a.conversation = &state
				a.contextTokens = 8192
				a.needsCompaction = true
				a.usageSink = s.processingUsageSink("doc", "chat", "live-compact")
				next, e := compactAPIConversation(ctx, config.API, req, a, state.Messages)
				if e != nil {
					cancel()
					t.Fatal(e)
				}
				state.Messages = next
				if e = saveDocumentConversation(ctx, s.Store.DB, "doc", provider, state); e != nil {
					cancel()
					t.Fatal(e)
				}
				cancel()
				t.Logf("live API checkpoint persisted: compactions=%d", state.Compactions)
			}
			s.Close()
			s = NewServer(s.Store, "test-secret", "")
			t.Cleanup(s.Close)
		}
	}
}
