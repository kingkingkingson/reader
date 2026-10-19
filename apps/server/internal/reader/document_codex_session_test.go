package reader

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func runPersistentDocumentProcess() {
	url := ""
	for _, arg := range os.Args {
		if v, ok := strings.CutPrefix(arg, "mcp_servers.reader_document.url="); ok {
			url, _ = strconv.Unquote(v)
		}
	}
	enc := json.NewEncoder(os.Stdout)
	scan := bufio.NewScanner(os.Stdin)
	scan.Buffer(make([]byte, 4096), maxProviderFrame)
	work, _ := os.Getwd()
	file := filepath.Join(work, "native-state.json")
	thread := "thread-" + filepath.Base(work)
	type nativeState struct {
		Turn     int
		Head     int
		Remember string
		Source   string
	}
	load := func() nativeState {
		var state nativeState
		b, _ := os.ReadFile(file)
		_ = json.Unmarshal(b, &state)
		return state
	}
	save := func(state nativeState) { _ = os.WriteFile(file, []byte(jsonText(state)), 0600) }
	for scan.Scan() {
		var r codexRPCMessage
		if json.Unmarshal(scan.Bytes(), &r) != nil {
			os.Exit(2)
		}
		f, e := os.OpenFile(os.Getenv("READER_CONVERSATION_CAPTURE"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
		if e != nil {
			os.Exit(3)
		}
		_ = json.NewEncoder(f).Encode(map[string]any{"pid": os.Getpid(), "method": r.Method, "params": r.Params})
		f.Close()
		reply := func(v any) { _ = enc.Encode(map[string]any{"id": r.ID, "result": v}) }
		switch r.Method {
		case "initialize":
			reply(map[string]any{})
		case "model/list":
			reply(map[string]any{"data": []any{map[string]any{"model": "test", "isDefault": true}}})
		case "config/read":
			servers := map[string]any{}
			if url != "" {
				servers["reader_document"] = map[string]any{"enabled": true, "url": url}
			}
			reply(map[string]any{"config": map[string]any{"mcp_servers": servers, "features": map[string]bool{}, "model_context_window": 64000}})
		case "thread/start":
			save(nativeState{})
			reply(map[string]any{"thread": map[string]any{"id": thread, "ephemeral": false}, "model": "test"})
		case "thread/resume":
			var p struct {
				Thread string `json:"threadId"`
			}
			_ = json.Unmarshal(r.Params, &p)
			if p.Thread != thread {
				os.Exit(4)
			}
			reply(map[string]any{"thread": map[string]any{"id": thread}, "model": "test"})
		case "thread/turns/list":
			state := load()
			data := []any{}
			if state.Head > 0 {
				data = append(data, map[string]any{"id": fmt.Sprintf("turn-%d", state.Head)})
			}
			reply(map[string]any{"data": data})
		case "thread/revert":
			state := load()
			var p struct {
				Before string `json:"beforeTurnId"`
			}
			_ = json.Unmarshal(r.Params, &p)
			head, _ := strconv.Atoi(strings.TrimPrefix(p.Before, "turn-"))
			state.Head = head - 1
			save(state)
			reply(map[string]any{"thread": map[string]any{"id": thread}})
		case "mcpServerStatus/list":
			tools := map[string]any{}
			for _, d := range documentToolDefinitions {
				tools[d.Name] = map[string]any{}
			}
			reply(map[string]any{"data": []any{map[string]any{"name": "reader_document", "tools": tools}}})
		case "turn/start":
			state := load()
			state.Turn++
			state.Head = state.Turn
			turn := fmt.Sprintf("turn-%d", state.Turn)
			var p struct {
				Input []struct {
					Text string `json:"text"`
				} `json:"input"`
			}
			_ = json.Unmarshal(r.Params, &p)
			input := ""
			for _, x := range p.Input {
				input += x.Text
			}
			if strings.Contains(input, "CIVET-42") {
				state.Remember = "CIVET-42"
			}
			reply(map[string]any{"turn": map[string]any{"id": turn}})
			notify := func(method string, params map[string]any) {
				params["threadId"] = thread
				params["turnId"] = turn
				_ = enc.Encode(map[string]any{"method": method, "params": params})
			}
			notify("item/started", map[string]any{"item": map[string]string{"id": "commentary", "type": "agentMessage", "phase": "commentary"}})
			notify("item/agentMessage/delta", map[string]any{"itemId": "commentary", "delta": "private planning prose"})
			if state.Source == "" || strings.HasSuffix(input, "verify-again") {
				body := jsonText(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": "read_passage", "arguments": map[string]string{"blockId": os.Getenv("READER_DOCUMENT_TEST_BLOCK")}}})
				request, _ := http.NewRequest("POST", url, strings.NewReader(body))
				request.Header.Set("Authorization", "Bearer "+os.Getenv("READER_DOCUMENT_MCP_TOKEN"))
				request.Header.Set("Content-Type", "application/json")
				request.Header.Set("Accept", "application/json, text/event-stream")
				request.Header.Set("MCP-Protocol-Version", "2025-11-25")
				response, e := http.DefaultClient.Do(request)
				if e != nil {
					os.Exit(5)
				}
				raw, _ := io.ReadAll(response.Body)
				response.Body.Close()
				if !strings.Contains(string(raw), "COBALT-19") {
					os.Exit(6)
				}
				state.Source = "S2"
			}
			if state.Turn == 10 {
				notify("item/started", map[string]any{"item": map[string]string{"id": "compact", "type": "contextCompaction"}})
				notify("item/completed", map[string]any{"item": map[string]string{"id": "compact", "type": "contextCompaction"}})
			}
			text := state.Remember + " COBALT-19 [" + state.Source + "]."
			status := "completed"
			if strings.HasSuffix(input, "cancel-test") {
				status = "failed"
			}
			notify("item/started", map[string]any{"item": map[string]string{"id": "answer", "type": "agentMessage", "phase": "final_answer"}})
			notify("item/agentMessage/delta", map[string]any{"itemId": "answer", "delta": state.Remember + " "})
			notify("item/agentMessage/delta", map[string]any{"itemId": "answer", "delta": "COBALT-19 [" + state.Source + "]."})
			notify("item/completed", map[string]any{"item": map[string]string{"id": "answer", "type": "agentMessage", "phase": "final_answer", "text": text}})
			notify("thread/tokenUsage/updated", map[string]any{"tokenUsage": map[string]any{"modelContextWindow": 64000, "total": TokenCounts{InputTokens: int64(state.Turn * 20), OutputTokens: int64(state.Turn * 10), TotalTokens: int64(state.Turn * 30)}}})
			save(state)
			notify("turn/completed", map[string]any{"turn": map[string]string{"id": turn, "status": status}})
		}
	}
}
func TestCodexConversationRetainsThreadAndSources(t *testing.T) {
	s, a := prepareConversationFixture(t)
	fakeAgent(t, "codex", "document-conversation")
	capture := filepath.Join(t.TempDir(), "capture.jsonl")
	t.Setenv("READER_CONVERSATION_CAPTURE", capture)
	t.Setenv("READER_DOCUMENT_TEST_BLOCK", a.corpus.Passages[1].ID)
	for i := 0; i < 13; i++ {
		prompt := fmt.Sprintf("继续第 %d 个问题", i)
		if i == 0 {
			prompt = "记住 CIVET-42"
		}
		if i == 11 {
			prompt = "verify-again"
		}
		out := conversationRequest(t, s, "codex", prompt)
		if strings.Count(out.Body.String(), "event: done") != 1 || !strings.Contains(out.Body.String(), "CIVET-42") || strings.Contains(out.Body.String(), "private planning prose") {
			t.Fatalf("turn %d: %s", i, out.Body.String())
		}
		if i == 9 && !strings.Contains(out.Body.String(), "正在整理对话上下文") {
			t.Fatal("native compact event was lost")
		}
		if i == 10 {
			s.Close()
			s = NewServer(s.Store, "test-secret", "")
			t.Cleanup(s.Close)
		}
	}
	// A failed native turn stays uncommitted locally. The next turn resumes the
	// same persistent thread and reverts only the uncommitted native turn.
	out := conversationRequest(t, s, "codex", "cancel-test")
	if strings.Contains(out.Body.String(), "event: done") {
		t.Fatal("failed turn saved")
	}
	out = conversationRequest(t, s, "codex", "继续解释")
	if !strings.Contains(out.Body.String(), "event: done") || !strings.Contains(out.Body.String(), "CIVET-42") {
		t.Fatal(out.Body.String())
	}
	_, _ = s.Store.DB.Exec(`CREATE TRIGGER fail_conversation_save BEFORE INSERT ON messages WHEN json_extract(NEW.body,'$.role')='assistant' BEGIN SELECT RAISE(ABORT,'save failed'); END`)
	out = conversationRequest(t, s, "codex", "save-failure")
	if strings.Contains(out.Body.String(), "event: done") {
		t.Fatal("unsaved answer acknowledged")
	}
	_, _ = s.Store.DB.Exec("DROP TRIGGER fail_conversation_save")
	out = conversationRequest(t, s, "codex", "继续上次的解释")
	if !strings.Contains(out.Body.String(), "event: done") {
		t.Fatal("failed save poisoned native continuation", out.Body.String())
	}
	data, _ := os.ReadFile(capture)
	starts, resumes, reverts := 0, 0, 0
	turns := []string{}
	scan := bufio.NewScanner(strings.NewReader(string(data)))
	scan.Buffer(make([]byte, 4096), maxProviderFrame)
	for scan.Scan() {
		var e struct {
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		_ = json.Unmarshal(scan.Bytes(), &e)
		switch e.Method {
		case "thread/start":
			starts++
			if strings.Contains(string(e.Params), `"ephemeral":true`) {
				t.Fatal("persistent thread marked ephemeral")
			}
		case "thread/resume":
			resumes++
		case "thread/revert":
			reverts++
		case "turn/start":
			turns = append(turns, string(e.Params))
		}
	}
	if starts != 1 || resumes < 2 || reverts != 2 || len(turns) != 17 {
		t.Fatal("thread recreated per question", starts, resumes, reverts, len(turns))
	}
	if strings.Contains(turns[1], "用户问题：记住 CIVET-42") || !strings.Contains(turns[1], "继续第 1 个问题") {
		t.Fatal("native history resent instead of appended", turns[1])
	}
	var messages int
	_ = s.Store.DB.QueryRow("SELECT count(*) FROM messages WHERE document_id='doc'").Scan(&messages)
	if messages != 32 {
		t.Fatal("history or failed-turn boundary lost", messages)
	}
}
