package reader

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const handoffTestThread = "01900000-0000-7000-8000-000000000001"
const handoffTestFork = "01900000-0000-7000-8000-000000000002"

func handoffFixture(t *testing.T) *Server {
	t.Helper()
	s, _ := originalDocumentFixture(t)
	d, _ := s.Store.Document("doc")
	if err := os.WriteFile(s.Store.File(d), []byte("original EPUB bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, m := range []Message{{ID: "question", DocumentID: "doc", Role: "user", Content: "继续解释 COBALT-19"}, {ID: "answer", DocumentID: "doc", Role: "assistant", Content: "之前的回答"}} {
		if err := s.Store.saveMessage(m); err != nil {
			t.Fatal(err)
		}
	}
	c := documentConversation{ID: "reader-conversation", ConnectionKey: "codex-native-v1", NativeThread: handoffTestThread, NativeCommitted: "committed-turn", LastMessageID: "answer"}
	if err := saveDocumentConversation(t.Context(), s.Store.DB, "doc", "codex", c); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestCodexHandoffCopiesCommittedContextWithoutMutatingReader(t *testing.T) {
	fakeAgent(t, "codex", "codex-handoff")
	capture := filepath.Join(t.TempDir(), "rpc.jsonl")
	t.Setenv("READER_HANDOFF_CAPTURE", capture)
	s := handoffFixture(t)
	before, _ := s.Store.chatHistory("doc")
	w := request(t, s, "POST", "/api/documents/doc/codex-handoff", nil)
	if w.Code != 200 {
		t.Fatalf("handoff: %d %s", w.Code, w.Body.String())
	}
	var result struct {
		ThreadID  string `json:"threadId"`
		URL       string `json:"url"`
		Directory string `json:"directory"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.ThreadID != handoffTestFork || result.URL != "codex://threads/"+handoffTestFork {
		t.Fatalf("bad result: %+v", result)
	}
	for file, want := range map[string]string{"source.epub": "original EPUB bytes", "document.json": "COBALT-19", "conversation.json": "之前的回答", "READING_CONTEXT.md": "单向"} {
		data, err := os.ReadFile(filepath.Join(result.Directory, file))
		if err != nil || !strings.Contains(string(data), want) {
			t.Fatalf("%s: %s %v", file, data, err)
		}
	}
	data, _ := os.ReadFile(capture)
	if strings.Contains(string(data), `"method":"turn/start"`) || strings.Contains(string(data), `"method":"thread/resume"`) {
		t.Fatal("handoff must not generate or resume the original")
	}
	var fork map[string]any
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		var rpc struct {
			Method string
			Params map[string]any
		}
		_ = json.Unmarshal([]byte(line), &rpc)
		if rpc.Method == "thread/fork" {
			fork = rpc.Params
		}
	}
	if fork["threadId"] != handoffTestThread || fork["lastTurnId"] != "committed-turn" || fork["cwd"] != result.Directory || fork["ephemeral"] != false {
		t.Fatalf("fork: %+v", fork)
	}
	if !strings.Contains(fork["baseInstructions"].(string), "READING_CONTEXT.md") {
		t.Fatal("Reader tool instructions survived")
	}
	w = request(t, s, "POST", "/api/documents/doc/codex-handoff", nil)
	if w.Code != 200 {
		t.Fatalf("retry: %d %s", w.Code, w.Body.String())
	}
	data, _ = os.ReadFile(capture)
	if strings.Count(string(data), `"method":"thread/fork"`) != 1 {
		t.Fatal("retry forked a duplicate")
	}
	if strings.Count(string(data), `"method":"thread/name/set"`) != 1 {
		t.Fatal("reopening overwrote the Codex title")
	}
	after, _ := s.Store.chatHistory("doc")
	c, _ := s.Store.documentConversation(t.Context(), "doc", "codex", "codex-native-v1")
	if jsonText(before) != jsonText(after) || c.NativeThread != handoffTestThread || c.NativeCommitted != "committed-turn" {
		t.Fatal("modified Reader conversation")
	}
}

func TestCodexHandoffRetryAfterNamingFailureKeepsForkAndSnapshot(t *testing.T) {
	fakeAgent(t, "codex", "codex-handoff")
	capture := filepath.Join(t.TempDir(), "rpc.jsonl")
	t.Setenv("READER_HANDOFF_CAPTURE", capture)
	t.Setenv("READER_HANDOFF_FAIL_NAME", "1")
	s := handoffFixture(t)
	w := request(t, s, "POST", "/api/documents/doc/codex-handoff", nil)
	if w.Code != 502 {
		t.Fatalf("failure: %d %s", w.Code, w.Body.String())
	}
	t.Setenv("READER_HANDOFF_FAIL_NAME", "")
	w = request(t, s, "POST", "/api/documents/doc/codex-handoff", nil)
	if w.Code != 200 {
		t.Fatalf("retry: %d %s", w.Code, w.Body.String())
	}
	data, _ := os.ReadFile(capture)
	if strings.Count(string(data), `"method":"thread/fork"`) != 1 {
		t.Fatal("naming failure lost the fork")
	}
	var result codexHandoff
	_ = json.Unmarshal(w.Body.Bytes(), &result)
	// An exported source is an independent file, not a link into the library.
	d, _ := s.Store.Document("doc")
	_ = os.Remove(s.Store.File(d))
	data, err := os.ReadFile(filepath.Join(result.Directory, "source.epub"))
	if err != nil || string(data) != "original EPUB bytes" {
		t.Fatalf("snapshot lost with original: %v", err)
	}
}

func TestCodexHandoffCanceledCopyDoesNotPublishPartialSource(t *testing.T) {
	root := t.TempDir()
	source, target := filepath.Join(root, "source"), filepath.Join(root, "target")
	if err := os.WriteFile(source, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := copyHandoffSource(ctx, source, target); err == nil {
		t.Fatal("canceled copy succeeded")
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatal("published incomplete snapshot")
	}
	if _, err := os.Stat(target + ".tmp"); !os.IsNotExist(err) {
		t.Fatal("left temporary source")
	}
}

func TestCodexHandoffRejectsMissingConversationAndConcurrentTurn(t *testing.T) {
	s := handoffFixture(t)
	s.aiMu.Lock()
	w := request(t, s, "POST", "/api/documents/doc/codex-handoff", nil)
	s.aiMu.Unlock()
	if w.Code != 409 {
		t.Fatalf("busy: %d", w.Code)
	}
	_, _ = s.Store.DB.Exec("DELETE FROM document_conversations")
	w = request(t, s, "POST", "/api/documents/doc/codex-handoff", nil)
	if w.Code != 409 {
		t.Fatalf("missing: %d %s", w.Code, w.Body.String())
	}
	w = request(t, s, "POST", "/api/documents/missing/codex-handoff", nil)
	if w.Code != 404 {
		t.Fatalf("deleted: %d", w.Code)
	}
}

func runCodexHandoffProcess() {
	enc := json.NewEncoder(os.Stdout)
	scan := bufio.NewScanner(os.Stdin)
	for scan.Scan() {
		var r codexRPCMessage
		if json.Unmarshal(scan.Bytes(), &r) != nil {
			os.Exit(2)
		}
		f, err := os.OpenFile(os.Getenv("READER_HANDOFF_CAPTURE"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
		if err != nil {
			os.Exit(3)
		}
		_, _ = f.Write(append(append([]byte{}, scan.Bytes()...), '\n'))
		_ = f.Close()
		switch r.Method {
		case "thread/name/set":
			if os.Getenv("READER_HANDOFF_FAIL_NAME") != "" {
				_ = enc.Encode(map[string]any{"id": r.ID, "error": map[string]any{"code": -32000, "message": "failed"}})
			} else {
				_ = enc.Encode(map[string]any{"id": r.ID, "result": map[string]any{}})
			}
		case "initialize":
			_ = enc.Encode(map[string]any{"id": r.ID, "result": map[string]any{}})
		case "initialized":
		case "thread/fork":
			_ = enc.Encode(map[string]any{"id": r.ID, "result": map[string]any{"thread": map[string]any{"id": handoffTestFork}}})
		default:
			os.Exit(4)
		}
	}
}
