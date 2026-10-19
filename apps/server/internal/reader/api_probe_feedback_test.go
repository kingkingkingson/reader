package reader

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestAPIProbeTimeoutOverride(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			fmt.Fprint(w, `{"data":[]}`)
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-time.After(1100 * time.Millisecond):
			writeAPIReply(w, "READER_OK")
		}
	}))
	defer upstream.Close()
	s := testServer(t)
	c := s.aiConfig()
	c.API = APIConnection{URL: upstream.URL}
	if err := s.writeAIConfig(c); err != nil {
		t.Fatal(err)
	}
	for _, seconds := range []string{"1", "2"} {
		w := request(t, s, "POST", "/api/ai/test/api?model=test&capability=text&timeoutSeconds="+seconds, nil)
		var cap Capability
		if err := json.Unmarshal(w.Body.Bytes(), &cap); err != nil {
			t.Fatal(err)
		}
		if w.Code != 200 || cap.Text != (seconds == "2") {
			t.Fatalf("timeout=%s: %s", seconds, w.Body.String())
		}
		if seconds == "1" && !strings.Contains(cap.Error, "超时") {
			t.Fatal(cap.Error)
		}
	}
}

func TestAPIProbeRejectsInvalidTimeout(t *testing.T) {
	s := testServer(t)
	for _, value := range []string{"-1", "601", "1.5", "invalid"} {
		w := request(t, s, "POST", "/api/ai/test/api?model=test&capability=text&timeoutSeconds="+value, nil)
		if w.Code != 400 {
			t.Fatalf("timeout=%s: status=%d %s", value, w.Code, w.Body.String())
		}
	}
	for _, value := range []string{"", "0", "600"} {
		w := request(t, s, "POST", "/api/ai/test/api?model=test&capability=text&timeoutSeconds="+value, nil)
		if w.Code != 200 {
			t.Fatalf("valid timeout=%s: %s", value, w.Body.String())
		}
	}
}

func TestAPIProbeFirstOutput(t *testing.T) {
	var fail atomic.Bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			time.Sleep(200 * time.Millisecond)
			fmt.Fprint(w, `{"data":[]}`)
			return
		}
		if fail.Load() {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\"}}]}\n\n")
		w.(http.Flusher).Flush()
		time.Sleep(50 * time.Millisecond)
		fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"Checking\"}}]}\n\n")
		w.(http.Flusher).Flush()
		time.Sleep(200 * time.Millisecond)
		writeAPIReply(w, "READER_OK")
	}))
	defer upstream.Close()
	s := testServer(t)
	c := s.aiConfig()
	c.API = APIConnection{URL: upstream.URL}
	if err := s.writeAIConfig(c); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	w := request(t, s, "POST", "/api/ai/test/api?model=test&capability=text", nil)
	elapsed := time.Since(started).Milliseconds()
	var text map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &text); err != nil {
		t.Fatal(err)
	}
	first, ok := text["textFirstOutputMs"].(float64)
	if w.Code != 200 || text["text"] != true || !ok || first < 20 || float64(elapsed)-first < 300 {
		t.Fatalf("first output must exclude catalog lookup and wait for content, elapsed=%d: %s", elapsed, w.Body.String())
	}
	w = request(t, s, "POST", "/api/ai/test/api?model=test&capability=vision", nil)
	var vision map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &vision)
	if vision["textFirstOutputMs"] != first || vision["visionFirstOutputMs"] == nil {
		t.Fatalf("stage timings lost: %s", w.Body.String())
	}
	fail.Store(true)
	w = request(t, s, "POST", "/api/ai/test/api?model=test&capability=text", nil)
	var failed map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &failed)
	if failed["textFirstOutputMs"] != nil || failed["visionFirstOutputMs"] != nil {
		t.Fatalf("stale timings retained: %s", w.Body.String())
	}
}

func TestAnthropicProbeFirstThinkingOutput(t *testing.T) {
	for _, tt := range []struct {
		name                    string
		initial, timeout, empty bool
	}{
		{name: "thinking-delta"},
		{name: "thinking-start", initial: true},
		{name: "thinking-then-timeout", timeout: true},
		{name: "empty-then-timeout", timeout: true, empty: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "GET" {
					fmt.Fprint(w, `{"data":[]}`)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				prefix, rest, _ := strings.Cut(anthropicTestWire("READER_OK"), "\n\n")
				fmt.Fprint(w, prefix+"\n\ndata: {\"type\":\"ping\"}\n\n")
				w.(http.Flusher).Flush()
				time.Sleep(100 * time.Millisecond)
				thought := "private thought"
				if tt.empty {
					thought = " "
				}
				if tt.initial {
					fmt.Fprintf(w, "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"thinking\",\"thinking\":%q}}\n\n", thought)
				} else {
					fmt.Fprint(w, "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}\n\n")
					fmt.Fprintf(w, "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":%q}}\n\n", thought)
				}
				fmt.Fprint(w, "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"signature_delta\",\"signature\":\"private signature\"}}\n\n")
				w.(http.Flusher).Flush()
				if tt.timeout {
					<-r.Context().Done()
					return
				}
				time.Sleep(200 * time.Millisecond)
				fmt.Fprint(w, "data: {\"type\":\"content_block_stop\",\"index\":1}\n\n"+rest)
			}))
			defer upstream.Close()
			s := testServer(t)
			c := s.aiConfig()
			c.API = APIConnection{URL: upstream.URL, Protocol: "anthropic"}
			if err := s.writeAIConfig(c); err != nil {
				t.Fatal(err)
			}
			started := time.Now()
			w := request(t, s, "POST", "/api/ai/test/api?model=test&capability=text&timeoutSeconds=1", nil)
			elapsed := time.Since(started).Milliseconds()
			var cap Capability
			if err := json.Unmarshal(w.Body.Bytes(), &cap); err != nil {
				t.Fatal(err)
			}
			if w.Code != 200 || cap.Text == tt.timeout {
				t.Fatalf("unexpected probe outcome: %s", w.Body.String())
			}
			if tt.empty {
				if cap.TextFirstOutputMs != nil {
					t.Fatalf("empty events counted as output: %s", w.Body.String())
				}
			} else if cap.TextFirstOutputMs == nil || *cap.TextFirstOutputMs < 50 || elapsed-*cap.TextFirstOutputMs < 150 {
				t.Fatalf("expected first thinking before answer/timeout, elapsed=%d: %s", elapsed, w.Body.String())
			}
			if tt.timeout && !strings.Contains(cap.Error, "超时") {
				t.Fatalf("missing timeout: %s", w.Body.String())
			}
			if strings.Contains(w.Body.String(), "private") {
				t.Fatal("probe leaked thinking")
			}
		})
	}
}
