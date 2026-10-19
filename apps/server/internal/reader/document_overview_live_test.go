package reader

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

// Opt-in, original synthetic text only. Never alter the user's Reader config.
func TestLiveOverviewThenOriginal(t *testing.T) {
	provider := os.Getenv("READER_TEST_OVERVIEW_PROVIDER")
	if provider != "codex" && provider != "api" {
		t.Skip("set READER_TEST_OVERVIEW_PROVIDER=codex or api")
	}
	s, a := originalDocumentFixture(t)
	config := AIConfig{Primary: provider, Models: map[string]string{}, Capabilities: map[string]Capability{}}
	if provider == "api" {
		data, err := os.ReadFile(os.Getenv("READER_TEST_DOCUMENT_API_CONFIG"))
		if err != nil {
			t.Fatal("existing Reader API connection unavailable")
		}
		var saved savedConfig
		if json.Unmarshal(data, &saved) != nil {
			t.Fatal("invalid Reader config")
		}
		config.API = saved.Config.API
		if config.API.URL != "https://api.deepseek.com" && config.API.URL != "https://api.deepseek.com/v1" {
			t.Fatal("expected official DeepSeek connection")
		}
		model := "deepseek-v4-pro"
		config.Models[provider] = model
		config.APIModels = []string{model}
		key := apiCapabilityKey(model)
		config.Capabilities[key] = Capability{Text: true, Tools: "passed", ToolSchemaVersion: documentToolSchemaVersion, Fingerprint: configPrint(config, key)}
	} else {
		config.Capabilities[provider] = Capability{Text: true, Fingerprint: configPrint(config, provider)}
	}
	if err := s.writeAIConfig(config); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 8*time.Minute)
	defer cancel()
	job := overviewTestJob(t, s)
	start := time.Now()
	if err := s.compileOverview(ctx, job, s.generationService(config)); err != nil {
		t.Fatal(err)
	}
	overview, err := s.currentOverview(ctx, a.corpus)
	if err != nil || overview == nil || overview.CompiledPassages != len(a.corpus.Passages) {
		t.Fatal("overview missing", err)
	}
	t.Logf("overview provider=%s elapsed=%s coverage=%d/%d", provider, time.Since(start).Round(time.Millisecond), overview.CompiledPassages, overview.TotalPassages)
	for _, question := range []string{"这篇文章大致讲什么？简洁介绍即可。", "请核对原文：cobalt 协议的精确 nonce、适用条件和实验交易数量分别是什么？请引用原文。"} {
		callCtx, stop := context.WithTimeout(ctx, 3*time.Minute)
		a.ctx = callCtx
		input := AIInput{Prompt: question, Chat: &chatInput{DocumentID: "doc", Question: question, Agent: a}}
		started := time.Now()
		var output strings.Builder
		emit := func(e ProviderEvent) error { output.WriteString(e.Text); return nil }
		var result GenerateResult
		if provider == "codex" {
			result, err = streamCodexDocumentChat(callCtx, s.Store.Root, "", input, emit)
		} else {
			req, e := s.apiAgentAdapter(config, taskChat).resolve(callCtx, false)
			if e != nil {
				stop()
				t.Fatal(e)
			}
			result, err = streamAPIDocumentChat(callCtx, config.API, req, input, emit)
		}
		if err != nil {
			stop()
			t.Fatal(err)
		}
		if result.Text != output.String() {
			stop()
			t.Fatal("stream mismatch")
		}
		if strings.Contains(question, "nonce") && (!strings.Contains(result.Text, "COBALT-19") || !strings.Contains(result.Text, "37") || len(a.Evidence) == 0) {
			stop()
			t.Fatal("specific claim did not read original", result.Text)
		}
		if _, e := a.references(result.Text); e != nil {
			stop()
			t.Fatal(e)
		}
		t.Logf("question=%s elapsed=%s tools=%d originals=%d window=%d source=%s", question, time.Since(started).Round(time.Millisecond), len(a.Traces), len(a.Evidence), a.contextTokens, a.contextSource)
		stop()
	}
}
