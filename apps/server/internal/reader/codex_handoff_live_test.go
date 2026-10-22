package reader

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Opt-in installed-CLI contract check. All state and responses are synthetic.
// A loopback provider creates the seed turn; no real model or credentials are used.
func TestCodexHandoffInstalledCLI(t *testing.T) {
	if os.Getenv("READER_CODEX_HANDOFF_LIVE") != "1" {
		t.Skip("set READER_CODEX_HANDOFF_LIVE=1 for the offline installed-CLI check")
	}
	if _, err := exec.LookPath("codex"); err != nil {
		t.Fatal(err)
	}
	home := t.TempDir()
	t.Setenv("CODEX_HOME", home)
	t.Setenv("CODEX_SQLITE_HOME", home)
	var calls atomic.Int32
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/v1/responses" {
			http.NotFound(w, r)
			return
		}
		calls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		for _, event := range []string{
			`{"type":"response.created","response":{"id":"fixture-response"}}`,
			`{"type":"response.output_item.done","item":{"type":"message","role":"assistant","id":"fixture-message","content":[{"type":"output_text","text":"Synthetic completed answer"}]}}`,
			`{"type":"response.completed","response":{"id":"fixture-response","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}`,
		} {
			fmt.Fprintf(w, "data: %s\n\n", event)
		}
	}))
	defer model.Close()
	config := fmt.Sprintf(`model = "fixture"
model_provider = "offline"
[model_providers.offline]
name = "Offline metadata test"
base_url = "%s/v1"
wire_api = "responses"
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
`, model.URL)
	if err := os.WriteFile(filepath.Join(home, "config.toml"), []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	s := handoffFixture(t)
	seed, err := newCodexSession(t.TempDir(), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer seed.close()
	seed.persistent = true
	seed.baseInstructions = "Synthetic reading fixture"
	// generate normally verifies Reader MCP isolation; the fixture has no MCP.
	if _, err = seed.generate(ctx, AIInput{Prompt: "Synthetic reader question"}, func(string) {}); err != nil {
		t.Fatal(err)
	}
	c := documentConversation{ID: "fixture", ConnectionKey: "codex-native-v1", NativeThread: seed.threadID, NativeCommitted: seed.lastTurnID, LastMessageID: "answer"}
	if calls.Load() != 1 || c.NativeThread == "" || c.NativeCommitted == "" {
		t.Fatal("seed turn was not completed")
	}
	if err = saveDocumentConversation(ctx, s.Store.DB, "doc", "codex", c); err != nil {
		t.Fatal(err)
	}
	seed.close()
	w := request(t, s, "POST", "/api/documents/doc/codex-handoff", nil)
	if w.Code != 200 {
		t.Fatalf("handoff: %d %s", w.Code, w.Body.String())
	}
	var handoff codexHandoff
	if err = json.Unmarshal(w.Body.Bytes(), &handoff); err != nil {
		t.Fatal(err)
	}
	if handoff.ThreadID == c.NativeThread || calls.Load() != 1 {
		t.Fatal("handoff reused the original or called the provider")
	}
	reopened, err := newCodexSession(t.TempDir(), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.close()
	if err = reopened.initializeControl(ctx); err != nil {
		t.Fatal(err)
	}
	raw, err := reopened.control(ctx, "thread/resume", map[string]any{"threadId": handoff.ThreadID, "excludeTurns": true})
	if err != nil {
		t.Fatal(err)
	}
	var resumed struct {
		CWD    string `json:"cwd"`
		Thread struct {
			Path string `json:"path"`
		} `json:"thread"`
	}
	want, _ := filepath.EvalSymlinks(handoff.Directory)
	if err = json.Unmarshal(raw, &resumed); err != nil {
		t.Fatal(err)
	}
	got, _ := filepath.EvalSymlinks(resumed.CWD)
	if got != want {
		t.Fatalf("cwd not retained: %s %v", raw, err)
	}
	rollout, err := os.ReadFile(resumed.Thread.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(rollout), "READING_CONTEXT.md") {
		t.Fatal("fork lost instructions")
	}
	raw, err = reopened.control(ctx, "thread/items/list", map[string]any{"threadId": handoff.ThreadID, "limit": 50})
	if err != nil || !strings.Contains(string(raw), "Synthetic completed answer") {
		t.Fatalf("fork lost paginated history: %s %v", raw, err)
	}
	t.Log("installed Codex retained the committed fork, snapshot cwd and reading instructions after process restart; handoff made no provider request")
}
