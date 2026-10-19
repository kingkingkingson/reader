package networkprobe

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestHTTPProxyAndRedirect(t *testing.T) {
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.String() != "http://unresolved.invalid/test" || r.Method != "HEAD" || r.Header.Get("Authorization") != "" {
			t.Errorf("unexpected probe: %s %s", r.Method, r.URL)
		}
		w.Header().Set("Location", "https://do-not-follow.invalid/")
		w.WriteHeader(http.StatusFound)
	}))
	defer proxy.Close()
	u, _ := url.Parse(proxy.URL)
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = http.ProxyURL(u)
	defer transport.CloseIdleConnections()
	result := probe(context.Background(), "http://unresolved.invalid/test", transport)
	if !result.Connected || result.Route != "proxy" || result.Status != 302 {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestInvalidProxyHasUnknownRoute(t *testing.T) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = func(*http.Request) (*url.URL, error) { return nil, errors.New("invalid proxy") }
	result := probe(context.Background(), "https://chatgpt.com/robots.txt", transport)
	if result.Connected || result.Route != "unknown" || result.Message == "" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestHTTPSConnectReachesOrigin(t *testing.T) {
	origin := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "HEAD" || r.Header.Get("Authorization") != "" {
			t.Errorf("unexpected request: %s", r.Method)
		}
		w.WriteHeader(http.StatusForbidden)
	}))
	defer origin.Close()
	var connects atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "CONNECT" {
			t.Errorf("expected CONNECT, got %s", r.Method)
			w.WriteHeader(500)
			return
		}
		connects.Add(1)
		upstream, err := net.Dial("tcp", strings.TrimPrefix(origin.URL, "https://"))
		if err != nil {
			t.Error(err)
			return
		}
		defer upstream.Close()
		downstream, buffered, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer downstream.Close()
		_, _ = buffered.WriteString("HTTP/1.1 200 Connection established\r\n\r\n")
		_ = buffered.Flush()
		go func() { _, _ = io.Copy(upstream, buffered) }()
		_, _ = io.Copy(downstream, upstream)
	}))
	defer proxy.Close()
	u, _ := url.Parse(proxy.URL)
	transport := origin.Client().Transport.(*http.Transport).Clone()
	transport.Proxy = http.ProxyURL(u)
	defer transport.CloseIdleConnections()
	result := probe(context.Background(), "https://example.com/check", transport)
	if !result.Connected || result.Status != 403 || result.Route != "proxy" || connects.Load() != 1 {
		t.Fatalf("unexpected result: %+v, CONNECT count %d", result, connects.Load())
	}
}

func TestProxyAuthenticationAndTimeout(t *testing.T) {
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(407) }))
	defer proxy.Close()
	u, _ := url.Parse(proxy.URL)
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = http.ProxyURL(u)
	defer transport.CloseIdleConnections()
	for _, target := range []string{"http://example.com", "https://example.com"} {
		result := probe(context.Background(), target, transport)
		if result.Connected || !strings.Contains(result.Message, "身份认证") {
			t.Fatalf("unexpected result: %+v", result)
		}
	}
	hanging := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer hanging.Close()
	transport.Proxy = nil
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	result := probe(ctx, hanging.URL, transport)
	if result.Connected || !strings.Contains(result.Message, "超时") {
		t.Fatalf("unexpected result: %+v", result)
	}
}

// Fresh processes exercise Go's cached environment proxy resolver just as the
// desktop's probe subprocess does, without leaking one test's env into another.
func TestEnvironmentAndLoopback(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	defer origin.Close()
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(401) }))
	defer proxy.Close()
	for _, test := range []struct {
		target, route string
		status        int
	}{
		{"http://example.com", "proxy", 401}, {origin.URL, "direct", 204},
	} {
		cmd := exec.Command(os.Args[0], "-test.run=^TestProbeChild$")
		for _, entry := range os.Environ() {
			key := strings.ToLower(strings.SplitN(entry, "=", 2)[0])
			if key == "http_proxy" || key == "https_proxy" || key == "all_proxy" || key == "no_proxy" || key == "request_method" {
				continue
			}
			cmd.Env = append(cmd.Env, entry)
		}
		cmd.Env = append(cmd.Env, "READER_PROBE_TEST="+test.target, "HTTP_PROXY="+proxy.URL, "HTTPS_PROXY="+proxy.URL, "NO_PROXY=localhost,127.0.0.1,::1")
		output, err := cmd.Output()
		if err != nil {
			t.Fatal(err)
		}
		var result Result
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("%s: %v", output, err)
		}
		if !result.Connected || result.Route != test.route || result.Status != test.status {
			t.Fatalf("unexpected result: %+v", result)
		}
	}
}

func TestProbeChild(t *testing.T) {
	target := os.Getenv("READER_PROBE_TEST")
	if target == "" {
		return
	}
	_ = json.NewEncoder(os.Stdout).Encode(probe(context.Background(), target, http.DefaultTransport.(*http.Transport).Clone()))
	os.Exit(0)
}
