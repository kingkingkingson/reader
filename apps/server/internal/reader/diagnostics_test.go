package reader

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"reader.local/server/internal/diagnostics"
)

func TestDiagnosticsAuthenticationAndRequestCorrelation(t *testing.T) {
	s := testServer(t)
	logs, _ := diagnostics.New(filepath.Join(s.Store.Root, "logs"), "session", "test-secret")
	s.SetDiagnostics(logs)
	denied := httptest.NewRecorder()
	s.Handler().ServeHTTP(denied, httptest.NewRequest("GET", "http://127.0.0.1:17840/api/diagnostics/export", nil))
	if denied.Code != 401 {
		t.Fatal(denied.Code)
	}
	first := request(t, s, "GET", "/api/documents", nil)
	rid := first.Header().Get("X-Reader-Request-ID")
	if len(rid) != 32 {
		t.Fatal("missing request ID")
	}
	w := request(t, s, "POST", "/api/diagnostics/events", strings.NewReader(`{"level":"info","event":"api.finish","requestId":"`+rid+`","status":200}`))
	if w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	w = request(t, s, "POST", "/api/diagnostics/events", strings.NewReader(`{"level":"error","event":"bad","body":"PRIVATE"}`))
	if w.Code != 400 {
		t.Fatal("accepted unknown body")
	}
	bundle := request(t, s, "GET", "/api/diagnostics/export", nil)
	if bundle.Code != 200 {
		t.Fatal(bundle.Body.String())
	}
	z, err := zip.NewReader(bytes.NewReader(bundle.Body.Bytes()), int64(bundle.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	var all strings.Builder
	for _, f := range z.File {
		r, _ := f.Open()
		b, _ := io.ReadAll(r)
		r.Close()
		all.Write(b)
	}
	if !strings.Contains(all.String(), rid) || !strings.Contains(all.String(), "renderer.api.finish") || strings.Contains(all.String(), "test-secret") {
		t.Fatal("missing correlation or leaked credential")
	}
}

func TestDiagnosticsWrapperPreservesFlushAndCancellation(t *testing.T) {
	s := testServer(t)
	recorder := httptest.NewRecorder()
	s.diagnosticHTTP(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requestID(r.Context()) == "" {
			t.Fatal("missing context ID")
		}
		io.WriteString(w, "event: delta\ndata: {}\n\n")
		if err := http.NewResponseController(w).Flush(); err != nil {
			t.Fatal(err)
		}
	})).ServeHTTP(recorder, httptest.NewRequest("GET", "http://localhost/stream", nil))
	if !recorder.Flushed || !strings.Contains(recorder.Body.String(), "delta") {
		t.Fatal("stream wrapper broke Flush")
	}
}

func TestDiagnosticsHTTPFailureKeepsPrivateMessageInResponseOnly(t *testing.T) {
	s := testServer(t)
	logs, err := diagnostics.New(filepath.Join(s.Store.Root, "logs"), "session")
	if err != nil {
		t.Fatal(err)
	}
	s.SetDiagnostics(logs)
	// Scholar failures can contain private titles and bare hosts, neither of
	// which can safely be identified by a generic URL/credential redactor.
	message := "内部论文 Unpublished Project Nimbus 无法下载；无法连接 papers.private.corp"
	w := httptest.NewRecorder()
	s.diagnosticHTTP(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fail(w, http.StatusBadGateway, message)
	})).ServeHTTP(w, httptest.NewRequest("POST", "http://localhost/api/documents/resolve", nil))
	var response map[string]string
	if w.Code != 502 || json.Unmarshal(w.Body.Bytes(), &response) != nil || response["error"] != message {
		t.Fatal("user-visible failure response changed")
	}
	entries, err := os.ReadDir(logs.Dir)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, entry := range entries {
		data, err := os.ReadFile(filepath.Join(logs.Dir, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), "Nimbus") || strings.Contains(string(data), "papers.private.corp") || strings.Contains(string(data), "userMessage") {
			t.Fatal("user-visible message entered persistent logs")
		}
		for _, line := range bytes.Split(bytes.TrimSpace(data), []byte("\n")) {
			var event map[string]any
			if err := json.Unmarshal(line, &event); err != nil {
				t.Fatal(err)
			}
			if event["event"] == "http.failure" {
				found = true
				if event["errorCode"] != "http_502" || event["requestId"] != w.Header().Get("X-Reader-Request-ID") {
					t.Fatal("failure lost its code or request correlation")
				}
			}
		}
	}
	if !found {
		t.Fatal("failure event missing")
	}
}
