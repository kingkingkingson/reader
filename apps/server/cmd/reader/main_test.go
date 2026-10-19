package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var testDocuments = []document{
	{ID: "aaaa1111000000000000000000000001", Type: "pdf", Title: "Oze: Concurrency Control", Library: "papers", Tags: []string{"db"}, Folders: []string{"systems/storage"}, ReadingStatus: "reading", Metadata: metadata{Date: "2025-03", Venue: "VLDB", Creators: []creator{{Given: "Ada", Family: "Lovelace"}}}},
	{ID: "aaaa2222000000000000000000000002", Type: "pdf", Title: "Concurrency Notes", Library: "papers", ReadingStatus: "unread"},
	{ID: "bbbb3333000000000000000000000003", Type: "epub", Title: "阅读的结构", Library: "books", ReadingStatus: "read"},
}

// fakeReader serves the API the command line uses and records requests.
func fakeReader(t *testing.T) (dir string, requests *[]*http.Request) {
	t.Helper()
	seen := []*http.Request{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			w.WriteHeader(401)
			return
		}
		seen = append(seen, r)
		reply := func(v any) { _ = json.NewEncoder(w).Encode(v) }
		switch {
		case r.URL.Path == "/api/documents" && r.Method == "GET":
			reply(testDocuments)
		case r.URL.Path == "/api/documents" && r.Method == "POST":
			file, header, _ := r.FormFile("file")
			data := make([]byte, 16)
			n, _ := file.Read(data)
			switch {
			case strings.HasPrefix(string(data[:n]), "long"):
				w.WriteHeader(409)
				reply(map[string]any{"error": "这份 PDF 有 80 页，篇幅较大", "code": "large-paper", "pages": 80})
			case header.Filename == "known.pdf":
				reply(testDocuments[1])
			default:
				w.WriteHeader(201)
				reply(document{ID: "cccc4444000000000000000000000004", Type: "pdf", Title: r.FormValue("library") + ":" + header.Filename, Library: r.FormValue("library")})
			}
		case strings.HasSuffix(r.URL.Path, "/text"):
			reply(documentText{DocumentID: testDocuments[0].ID, Type: "pdf", Units: 3, Parsed: true, Blocks: []textBlock{
				{ID: "p2-b1", Unit: 2, Label: "paragraph_title", Text: "Evaluation", Translation: "评估"},
				{ID: "p2-b2", Unit: 2, Label: "text", Text: "Oze wins.", Translation: ""},
				{ID: "p2-b3", Unit: 2, Label: "text", Text: "ada@example.com", Translation: "ada@example.com"},
				{ID: "p3-b1", Unit: 3, Label: "table", Text: "Table 1: Results.", Translation: "表 1：结果。"},
			}})
		case r.URL.Path == "/api/search":
			reply([]searchHit{{DocumentID: testDocuments[0].ID, Title: "Oze", Type: "pdf", Unit: 2, BlockID: "p2-b2", Side: "translation", Excerpt: "…胜出…"}})
		case strings.HasSuffix(r.URL.Path, "/annotations"):
			reply([]annotation{
				{ID: "1", Kind: "highlight", Location: json.RawMessage(`{"type":"pdf","page":4}`), Quote: "important\nline"},
				{ID: "2", Kind: "question", Location: json.RawMessage(`{"type":"pdf","page":5}`), Note: "Why?", AnswerID: "m1"},
			})
		case strings.HasSuffix(r.URL.Path, "/messages"):
			reply([]map[string]string{{"id": "m1", "content": "Because."}})
		default:
			w.WriteHeader(404)
			reply(map[string]string{"error": "文档不存在"})
		}
	}))
	t.Cleanup(server.Close)
	dir = t.TempDir()
	data, _ := json.Marshal(discovery{URL: server.URL, Token: "secret", Version: "test"})
	if err := os.WriteFile(filepath.Join(dir, "server.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("READER_DATA", dir)
	return dir, &seen
}

func runCLI(t *testing.T, args ...string) (string, error) {
	t.Helper()
	var out bytes.Buffer
	err := run(args, &out)
	return out.String(), err
}
func exitCode(err error) int {
	var exit exitError
	if errors.As(err, &exit) {
		return exit.code
	}
	if err != nil {
		return 1
	}
	return 0
}

func TestOptionsMayFollowArguments(t *testing.T) {
	fs := flag.NewFlagSet("t", flag.ContinueOnError)
	pages := fs.String("pages", "", "")
	asJSON := fs.Bool("json", false, "")
	args, err := parseInterleaved(fs, []string{"doc", "--pages", "3-5", "more", "--json", "--", "--literal"})
	if err != nil || *pages != "3-5" || !*asJSON || strings.Join(args, " ") != "doc more --literal" {
		t.Fatalf("%v %q %v %v", err, *pages, *asJSON, args)
	}
}

func TestParseRange(t *testing.T) {
	for raw, want := range map[string][2]int{"3": {3, 3}, "3-5": {3, 5}, " 2-": {2, 0}} {
		from, to, err := parseRange(raw)
		if err != nil || from != want[0] || to != want[1] {
			t.Fatalf("%q: %d %d %v", raw, from, to, err)
		}
	}
	for _, raw := range []string{"", "0", "5-3", "a-b", "-2"} {
		if _, _, err := parseRange(raw); exitCode(err) != 2 {
			t.Fatalf("%q accepted", raw)
		}
	}
}

func TestDocumentReferences(t *testing.T) {
	fakeReader(t)
	for ref, title := range map[string]string{"aaaa1111": "Oze: Concurrency Control", "bbbb3333000000000000000000000003": "阅读的结构", "oze": "Oze: Concurrency Control", "阅读": "阅读的结构"} {
		out, err := runCLI(t, "show", ref, "--json")
		if err != nil || !strings.Contains(out, `"title": "`+title+`"`) {
			t.Fatalf("%s: %v %s", ref, err, out)
		}
	}
	_, err := runCLI(t, "show", "aaaa")
	if err == nil || !strings.Contains(err.Error(), "2 份文档") || !strings.Contains(err.Error(), "aaaa2222") {
		t.Fatalf("ambiguous prefix: %v", err)
	}
	if _, err = runCLI(t, "show", "concurrency"); err == nil {
		t.Fatal("ambiguous title accepted")
	}
	if _, err = runCLI(t, "show", "missing"); exitCode(err) != 1 {
		t.Fatalf("missing document: %v", err)
	}
	if _, err = runCLI(t, "show"); exitCode(err) != 2 {
		t.Fatalf("missing argument: %v", err)
	}
}

func TestListFilters(t *testing.T) {
	fakeReader(t)
	cases := []struct {
		want string
		args []string
	}{
		{"aaaa1111 aaaa2222 bbbb3333", []string{"list"}},
		{"aaaa1111 aaaa2222", []string{"list", "--library", "papers"}},
		{"bbbb3333", []string{"list", "--type", "epub"}},
		{"aaaa1111", []string{"list", "--tag", "DB", "--status", "reading"}},
		{"aaaa1111", []string{"list", "--folder", "systems"}},
		{"aaaa2222", []string{"list", "--query", "notes"}},
		{"aaaa1111", []string{"list", "--query", "concurrency", "--limit", "1"}},
	}
	for _, c := range cases {
		out, err := runCLI(t, c.args...)
		if err != nil {
			t.Fatal(err)
		}
		got := []string{}
		for _, line := range strings.Split(out, "\n") {
			if fields := strings.Fields(line); len(fields) > 0 && len(fields[0]) == 8 {
				got = append(got, fields[0])
			}
		}
		if strings.Join(got, " ") != c.want {
			t.Fatalf("%v: %v\n%s", c.args, got, out)
		}
	}
	out, _ := runCLI(t, "list", "--library", "papers")
	if !strings.Contains(out, "Oze: Concurrency Control（Ada Lovelace，2025，VLDB）  #db") || !strings.Contains(out, "共 2 份") {
		t.Fatalf("%s", out)
	}
	if _, err := runCLI(t, "list", "--library", "films"); exitCode(err) != 2 {
		t.Fatal("unknown library accepted")
	}
}

func TestReadFormatsPagesAndTranslations(t *testing.T) {
	_, requests := fakeReader(t)
	out, err := runCLI(t, "read", "oze", "--pages", "2-", "--side", "both")
	if err != nil {
		t.Fatal(err)
	}
	last := (*requests)[len(*requests)-1].URL.Query()
	if last.Get("from") != "2" || last.Has("to") || last.Get("side") != "both" {
		t.Fatalf("query: %v", last)
	}
	for _, want := range []string{"# Oze: Concurrency Control", "## 第 2 页", "### Evaluation\n\n译：评估", "Oze wins.", "## 第 3 页", "[表格] Table 1: Results.", "（1 段尚未翻译）"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in\n%s", want, out)
		}
	}
	if strings.Count(out, "ada@example.com") != 1 {
		t.Fatalf("unchanged translation printed twice:\n%s", out)
	}
	out, _ = runCLI(t, "read", "oze", "--side", "translation")
	if strings.Contains(out, "Oze wins.") || !strings.Contains(out, "### 评估") {
		t.Fatalf("translation side:\n%s", out)
	}
	if _, err = runCLI(t, "read", "阅读", "--pages", "1"); exitCode(err) != 2 {
		t.Fatal("pages accepted for an EPUB")
	}
	if _, err = runCLI(t, "read", "oze", "--chapters", "1"); exitCode(err) != 2 {
		t.Fatal("chapters accepted for a PDF")
	}
	if _, err = runCLI(t, "read", "oze", "--side", "all"); exitCode(err) != 2 {
		t.Fatal("unknown side accepted")
	}
}

func TestSearchAndAnnotations(t *testing.T) {
	_, requests := fakeReader(t)
	out, err := runCLI(t, "search", "oze", "wins", "--doc", "aaaa1111", "--library", "papers", "--limit", "1")
	if err != nil {
		t.Fatal(err)
	}
	q := (*requests)[len(*requests)-1].URL.Query()
	if q.Get("q") != "oze wins" || q.Get("document") != testDocuments[0].ID || q.Get("limit") != "1" || q.Get("library") != "papers" {
		t.Fatalf("query: %v", q)
	}
	if !strings.Contains(out, "aaaa1111  Oze  第 2 页  [译文]\n    …胜出…") || !strings.Contains(out, "已达上限") {
		t.Fatalf("%s", out)
	}
	out, err = runCLI(t, "annotations", "oze")
	if err != nil || !strings.Contains(out, "[高亮] 第 4 页\n  > important\n  > line") || !strings.Contains(out, "[问题] 第 5 页\n  Why?\n  回答：Because.") {
		t.Fatalf("%v\n%s", err, out)
	}
	out, _ = runCLI(t, "annotations", "oze", "--kind", "highlight", "--json")
	var list []annotation
	if json.Unmarshal([]byte(out), &list) != nil || len(list) != 1 || list[0].Kind != "highlight" {
		t.Fatalf("%s", out)
	}
}

func TestImportReportsEachFile(t *testing.T) {
	_, requests := fakeReader(t)
	dir := t.TempDir()
	write := func(name, content string) string {
		path := filepath.Join(dir, name)
		_ = os.WriteFile(path, []byte(content), 0600)
		return path
	}
	fresh, known, long, text := write("fresh.pdf", "%PDF"), write("known.pdf", "%PDF"), write("long.pdf", "long"), write("notes.txt", "x")
	out, err := runCLI(t, "import", fresh, known, long, text, filepath.Join(dir, "gone.pdf"))
	if exitCode(err) != 1 || !strings.Contains(err.Error(), "3 个文件导入失败") {
		t.Fatalf("%v", err)
	}
	for _, want := range []string{"已导入  cccc4444  papers:fresh.pdf", "已存在  aaaa2222  Concurrency Notes（论文库）", "80 页", "--allow-large", "notes.txt：只支持 PDF 和 EPUB", "gone.pdf：无法读取文件"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in\n%s", want, out)
		}
	}
	// Only the three PDFs reached Reader.
	uploads := 0
	for _, r := range *requests {
		if r.Method == "POST" {
			uploads++
		}
	}
	if uploads != 3 {
		t.Fatalf("%d uploads", uploads)
	}
	out, err = runCLI(t, "import", "--library", "books", "--allow-large", fresh, "--json")
	var results []importResult
	if err != nil || json.Unmarshal([]byte(out), &results) != nil || results[0].Status != "imported" || results[0].Document.Title != "books:fresh.pdf" {
		t.Fatalf("%v %s", err, out)
	}
}

func TestConnectionFailures(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("READER_DATA", dir)
	if _, err := runCLI(t, "list"); exitCode(err) != 3 {
		t.Fatalf("no discovery file: %v", err)
	}
	write := func(d discovery) {
		data, _ := json.Marshal(d)
		_ = os.WriteFile(filepath.Join(dir, "server.json"), data, 0600)
	}
	closed := httptest.NewServer(http.NotFoundHandler())
	closed.Close()
	write(discovery{URL: closed.URL, Token: "secret"})
	if _, err := runCLI(t, "list"); exitCode(err) != 3 {
		t.Fatalf("stale discovery file: %v", err)
	}
	write(discovery{URL: "http://example.com", Token: "secret"})
	if _, err := runCLI(t, "list"); err == nil || !strings.Contains(err.Error(), "不是本机地址") {
		t.Fatalf("remote address accepted: %v", err)
	}
	fakeReader(t)
	data, _ := os.ReadFile(filepath.Join(os.Getenv("READER_DATA"), "server.json"))
	var d discovery
	_ = json.Unmarshal(data, &d)
	d.Token = "old"
	write(d)
	t.Setenv("READER_DATA", dir)
	if _, err := runCLI(t, "list"); exitCode(err) != 3 || !strings.Contains(err.Error(), "过期") {
		t.Fatalf("stale token: %v", err)
	}
	if out, err := runCLI(t, "help"); err != nil || !strings.Contains(out, "reader <命令>") {
		t.Fatal("help needs no running Reader")
	}
	if _, err := runCLI(t, "launch"); exitCode(err) != 2 {
		t.Fatal("unknown command accepted")
	}
}
