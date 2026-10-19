package reader

import (
	"testing"
)

func TestDocumentContextSources(t *testing.T) {
	if n := codexConfiguredWindow([]byte(`{"config":{"model_context_window":872000,"model_auto_compact_token_limit":800000,"unrelated_secret":"must-not-persist"}}`)); n != 872000 {
		t.Fatal(n)
	}
	if n := codexConfiguredWindow([]byte(`{"config":{"model_auto_compact_token_limit":800000}}`)); n != 0 {
		t.Fatal("compact threshold substituted for context window")
	}
	for _, tc := range []struct {
		reported, manual, want int
		source                 string
	}{
		{872000, 0, 872000, "codex_config"}, {872000, 32768, 32768, "manual_cap+codex_config"}, {16384, 65536, 16384, "codex_config"}, {0, 32768, 32768, "manual"}, {0, 0, 65536, "fallback_estimate"},
	} {
		n, source := resolveDocumentContext(tc.reported, tc.manual, "codex_config")
		if n != tc.want || source != tc.source {
			t.Fatal(tc, n, source)
		}
	}
	_, a := originalDocumentFixture(t)
	if err := a.prepareReading(t.Context(), AIInput{Prompt: "question"}); err != nil {
		t.Fatal(err)
	}
	a.updateContextWindow(872000, 0, "codex_config")
	if a.contextTokens != 872000 || a.sourceTokens < 600000 {
		t.Fatal("config ignored", a.contextTokens, a.sourceTokens)
	}
	a.updateContextWindow(256000, 12000, "codex_runtime")
	if a.contextTokens != 256000 || a.runtimeUsedTokens != 12000 || a.contextSource != "codex_runtime" {
		t.Fatal("runtime window ignored")
	}
}
func TestAPIContextMetadata(t *testing.T) {
	models, err := decodeAPIModels([]byte(`{"data":[{"id":"deepseek-v4-pro","context_window":1048576,"max_output_tokens":393216},{"id":"openrouter/model","context_length":256000,"top_provider":{"context_length":128000,"max_completion_tokens":16000}},{"id":"standard"}]}`))
	if err != nil || len(models) != 3 {
		t.Fatal(err)
	}
	if models[0].ContextWindow != 1048576 || models[0].MaxOutputTokens != 393216 || models[1].ContextWindow != 128000 || models[2].ContextWindow != 0 {
		t.Fatalf("model metadata lost: %+v", models)
	}
}
