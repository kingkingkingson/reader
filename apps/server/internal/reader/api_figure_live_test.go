package reader

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestLiveDeepSeekNaturalFigureQuestion(t *testing.T) {
	if os.Getenv("READER_TEST_DEEPSEEK_FIGURE") != "1" {
		t.Skip("opt-in DeepSeek natural figure question with configured API")
	}
	raw, err := os.ReadFile(os.Getenv("READER_TEST_DOCUMENT_API_CONFIG"))
	if err != nil {
		t.Fatal("Reader API config unavailable")
	}
	var saved savedConfig
	if json.Unmarshal(raw, &saved) != nil {
		t.Fatal("invalid config")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("READER_NODE", node)
	t.Setenv("READER_PROCESSOR", os.Getenv("READER_TEST_PAGE_PROCESSOR"))
	s, _ := pageImageFixture(t, false)
	if library := os.Getenv("READER_TEST_PAPER_LIBRARY"); library != "" {
		id := os.Getenv("READER_TEST_PAPER_ID")
		decoded, decodeErr := hex.DecodeString(id)
		if decodeErr != nil || len(decoded) != 16 {
			t.Fatal("invalid test paper id")
		}
		pdf, err := os.ReadFile(filepath.Join(library, "papers", id+".pdf"))
		if err != nil {
			t.Fatal(err)
		}
		manifest, err := os.ReadFile(filepath.Join(library, "cache", id, "analysis", "manifest.json"))
		if err != nil {
			t.Fatal(err)
		}
		d, _ := s.Store.Document("doc")
		if err = os.WriteFile(s.Store.File(d), pdf, 0600); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(s.analysisDir("doc"), "manifest.json"), manifest, 0600); err != nil {
			t.Fatal(err)
		}
	}
	c := AIConfig{Primary: "api", API: saved.Config.API, Models: map[string]string{"api": "deepseek-flash"}, APIModels: []string{"deepseek-flash"}, Capabilities: map[string]Capability{}}
	passModels(&c, map[string]bool{"deepseek-flash": true}) // No prefilled tools result.
	if err = s.writeAIConfig(c); err != nil {
		t.Fatal(err)
	}
	out := conversationRequest(t, s, "api", "第二页的图讲的是什么")
	if !strings.Contains(out.Body.String(), "event: done") {
		t.Fatal(out.Body.String())
	}
	if !strings.Contains(out.Body.String(), "event: reasoning") {
		t.Fatal("DeepSeek thinking was not streamed")
	}
	history, _ := s.Store.chatHistory("doc")
	answer := history[len(history)-1]
	if answer.Reasoning == "" {
		t.Fatal("thinking was not persisted")
	}
	var runRaw string
	_ = s.Store.DB.QueryRow("SELECT body FROM chat_agent_runs WHERE json_extract(body,'$.messageId')=?", answer.ID).Scan(&runRaw)
	var run struct {
		Mode     string              `json:"mode"`
		Tools    []documentToolTrace `json:"tools"`
		Evidence []documentEvidence  `json:"evidence"`
	}
	_ = json.Unmarshal([]byte(runRaw), &run)
	viewed := false
	for _, e := range run.Evidence {
		if e.PageImage != nil && e.PageImage.Page == 2 {
			viewed = true
		}
	}
	if run.Mode != "agent" || !viewed {
		t.Fatal("natural figure question did not trigger image read", run.Mode, jsonText(run.Tools), answer.Content)
	}
	var names []string
	for _, call := range run.Tools {
		names = append(names, call.Tool)
	}
	t.Logf("mode=%s tools=%v reasoningBytes=%d citations=%s", run.Mode, names, len(answer.Reasoning), answer.References)
	t.Log("answer:", answer.Content)
}
