package reader

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestJournalRankParsesCurrentMultiSubjectResponse(t *testing.T) {
	// A small subset of an actual 2026-10-12 easyScholar response for JMLR.
	raw := []byte(`{"code":200,"msg":"SUCCESS","data":{"officialRank":{"all":{"sciif":"6.8","sci":"Q1","sciUp":"计算机科学4区","sciUpSmall":"自动化与控制系统4区/计算机：人工智能4区。","sciif5":"10.5","jci":"0.94"}},"customRank":{"rankInfo":[],"rank":[]}}}`)
	result, err := parseJournalRank(raw)
	if err != nil || result.Status != "found" || len(result.Badges) != 7 {
		t.Fatalf("parse result: %+v, %v", result, err)
	}
	var small []string
	for _, badge := range result.Badges {
		if badge.Key == "sciUpSmall" {
			small = append(small, badge.Value)
		}
		if badge.Year != "" {
			t.Fatalf("invented data year: %+v", badge)
		}
	}
	if len(small) != 2 || small[0] != "自动化与控制系统4区" || small[1] != "计算机：人工智能4区" {
		t.Fatalf("subjects: %q", small)
	}
}

func TestJournalRankParsesCustomDatasetWithoutOfficialRanks(t *testing.T) {
	raw := []byte(`{"code":200,"msg":"SUCCESS","data":{"officialRank":{"all":null},"customRank":{"rankInfo":[{"uuid":"1614919989423271936","abbName":"CCF","oneRankText":"A","twoRankText":"B"}],"rank":["1614919989423271936&&&1"]}}}`)
	result, err := parseJournalRank(raw)
	if err != nil || result.Status != "found" || len(result.Badges) != 1 {
		t.Fatalf("custom result: %+v, %v", result, err)
	}
	badge := result.Badges[0]
	if badge.Key != "custom:1614919989423271936" || badge.Name != "CCF" || badge.Value != "A" {
		t.Fatalf("custom badge: %+v", badge)
	}
}

func TestJournalRankConfigDefaultsAndNeverReturnsKey(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	s := NewServer(store, "test-secret", "")
	w := request(t, s, "GET", "/api/journal-ranks/config", nil)
	var config journalRankConfig
	if json.Unmarshal(w.Body.Bytes(), &config) != nil || !config.Enabled || config.HasKey || config.FilterMode != "include" || len(config.Selected) == 0 {
		t.Fatalf("bad default: %s", w.Body.String())
	}
	w = request(t, s, "PUT", "/api/journal-ranks/config", strings.NewReader(`{"enabled":true,"filterMode":"exclude","selected":["sciif","sciUpSmall"],"key":"private-test-key"}`))
	if w.Code != 200 || strings.Contains(w.Body.String(), "private-test-key") {
		t.Fatalf("secret exposed: %d %s", w.Code, w.Body.String())
	}
	w = request(t, s, "PUT", "/api/journal-ranks/config", strings.NewReader(`{"enabled":false,"selected":["sciif"]}`))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	config, key, err := s.journalConfig()
	if err != nil || config.Enabled || !config.HasKey || key != "private-test-key" || config.FilterMode != "exclude" || len(config.Selected) != 1 {
		t.Fatalf("key-only settings lost: %+v %v", config, err)
	}
	w = request(t, s, "PUT", "/api/journal-ranks/config", strings.NewReader(`{"enabled":true,"filterMode":"invalid","selected":[]}`))
	if w.Code != 400 {
		t.Fatalf("invalid filter mode accepted: %d %s", w.Code, w.Body.String())
	}
}

func TestJournalRankRequestsRespectGlobalRateLimit(t *testing.T) {
	var mu sync.Mutex
	var starts []time.Time
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		starts = append(starts, time.Now())
		mu.Unlock()
		if r.URL.Query().Get("secretKey") != "test-key" {
			t.Error("key missing")
		}
		if r.URL.Query().Get("publicationName") == "" {
			t.Error("name missing")
		}
		_, _ = w.Write([]byte(`{"code":200,"msg":"SUCCESS","data":{"officialRank":{"all":{"sci":"Q2"}}}}`))
	}))
	defer upstream.Close()
	previous := journalRankURL
	journalRankURL = upstream.URL
	defer func() { journalRankURL = previous }()
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	s := NewServer(store, "test-secret", "")
	var wg sync.WaitGroup
	for _, name := range []string{"Nature", "Applied Economics"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.fetchJournalRank(context.Background(), name, "test-key", 20*time.Second); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	mu.Lock()
	defer mu.Unlock()
	if len(starts) != 2 || starts[1].Sub(starts[0]) < 500*time.Millisecond {
		t.Fatalf("request starts too close: %v", starts)
	}
}

func TestJournalRankRequestTimeoutStartsAfterRateWait(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"code":200,"msg":"SUCCESS","data":{"officialRank":{"all":{"sci":"Q1"}}}}`))
	}))
	defer upstream.Close()
	previous := journalRankURL
	journalRankURL = upstream.URL
	defer func() { journalRankURL = previous }()
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	s := NewServer(store, "test-secret", "")
	s.journalRankLast = time.Now().Add(200 * time.Millisecond)
	result, err := s.fetchJournalRank(context.Background(), "Nature", "test-key", 500*time.Millisecond)
	if err != nil || result.Status != "found" {
		t.Fatalf("queued request spent upstream timeout before sending: %+v, %v", result, err)
	}
}

func TestJournalRankEndpointCachesByVenueAndStopsWhenDisabled(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = w.Write([]byte(`{"code":200,"msg":"SUCCESS","data":{"officialRank":{"all":{"sci":"Q1","sciif":"6.8"}}}}`))
	}))
	defer upstream.Close()
	previous := journalRankURL
	journalRankURL = upstream.URL
	defer func() { journalRankURL = previous }()
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	s := NewServer(store, "test-secret", "")
	for _, id := range []string{"a", "b"} {
		if _, err := store.DB.Exec("INSERT INTO documents(id,type,title,author,size,created_at,last_opened_at,library,metadata) VALUES(?,?,?,?,?,?,?,?,?)", id, "pdf", id, "", 1, now(), now(), "papers", `{"itemType":"journal","venue":"Nature"}`); err != nil {
			t.Fatal(err)
		}
	}
	if w := request(t, s, "PUT", "/api/journal-ranks/config", strings.NewReader(`{"enabled":true,"selected":["sci","sciif"],"key":"test-key"}`)); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	for _, id := range []string{"a", "b"} {
		w := request(t, s, "GET", "/api/documents/"+id+"/journal-rank", nil)
		var result journalRankResult
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || result.Status != "found" || len(result.Badges) != 2 {
			t.Fatalf("%s: %d %s", id, w.Code, w.Body.String())
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("duplicate venue queried %d times", calls.Load())
	}
	if w := request(t, s, "PUT", "/api/journal-ranks/config", strings.NewReader(`{"enabled":false,"selected":["sci"]}`)); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w := request(t, s, "GET", "/api/documents/a/journal-rank?refresh=1", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"disabled"`) || calls.Load() != 1 {
		t.Fatalf("disabled feature queried provider: %d %s", w.Code, w.Body.String())
	}
}

func TestJournalRankLive(t *testing.T) {
	key := os.Getenv("EASYSCHOLAR_SECRET_KEY")
	if key == "" {
		t.Skip("set EASYSCHOLAR_SECRET_KEY for a small live contract check")
	}
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	s := NewServer(store, "test-secret", "")
	for _, name := range []string{"Nature", "Journal of Machine Learning Research"} {
		result, err := s.fetchJournalRank(context.Background(), name, key, 20*time.Second)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if result.Status != "found" || len(result.Badges) < 4 {
			t.Fatalf("%s: incomplete result: %+v", name, result)
		}
	}
}
