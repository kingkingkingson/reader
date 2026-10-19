package reader

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// textFixture is a parsed two-page paper with a page number, a figure and one
// translated paragraph.
func textFixture(t *testing.T) *Server {
	t.Helper()
	s := testServer(t)
	if _, err := s.Store.DB.Exec("INSERT INTO documents(id,type,title,author,size,created_at,last_opened_at,library) VALUES('doc','pdf','Concurrency Control','',1,?,?,'papers')", now(), now()); err != nil {
		t.Fatal(err)
	}
	block := func(id string, page int, label, text string) PDFBlock {
		b := PDFBlock{ID: id, Page: page, Label: label, Text: text}
		b.Bounds.X, b.Bounds.Y, b.Bounds.Width, b.Bounds.Height = .1, .3, .6, .1
		return b
	}
	number := block("p1-b3", 1, "number", "1")
	figure := block("p2-b2", 2, "chart", "axis labels")
	figure.Image, figure.Caption = "assets/p2-b2.png", "Figure 1: Throughput under contention."
	m := layoutManifest{Pages: 2, Blocks: []PDFBlock{
		block("p1-b1", 1, "paragraph_title", "Introduction"),
		block("p1-b2", 1, "text", "Long-running transactions block short ones."),
		number,
		block("p2-b1", 2, "text", "We evaluate Oze on TPC-C."),
		figure,
	}}
	dir := s.analysisDir("doc")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(m)
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	source := "Long-running transactions block short ones."
	if err := s.saveTranslation("doc", TranslationBlock{BlockID: "p1-b2", SourceHash: translationHash(source), Status: "complete", Sentences: []TranslationSentence{{Source: source, Target: "长事务会阻塞短事务。"}}}); err != nil {
		t.Fatal(err)
	}
	return s
}

func decodeBody[T any](t *testing.T, body []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("%v: %s", err, body)
	}
	return v
}

func TestDocumentTextReadsParsedPagesInOrder(t *testing.T) {
	s := textFixture(t)
	w := request(t, s, "GET", "/api/documents/doc/text", nil)
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	text := decodeBody[documentText](t, w.Body.Bytes())
	if !text.Parsed || text.Units != 2 || len(text.Blocks) != 4 {
		t.Fatalf("unexpected text: %+v", text)
	}
	if text.Blocks[0].Text != "Introduction" || text.Blocks[3].Text != "Figure 1: Throughput under contention." {
		t.Fatalf("figures read their caption, page numbers are dropped: %+v", text.Blocks)
	}
	if text.Blocks[1].Translation != "" {
		t.Fatal("source side included a translation")
	}

	w = request(t, s, "GET", "/api/documents/doc/text?from=1&to=1&side=both", nil)
	text = decodeBody[documentText](t, w.Body.Bytes())
	if len(text.Blocks) != 2 || text.Blocks[1].Translation != "长事务会阻塞短事务。" || text.Blocks[1].Text == "" {
		t.Fatalf("page range or translation missing: %+v", text.Blocks)
	}
	w = request(t, s, "GET", "/api/documents/doc/text?side=translation&from=2", nil)
	text = decodeBody[documentText](t, w.Body.Bytes())
	for _, b := range text.Blocks {
		if b.Unit != 2 || b.Text != "" {
			t.Fatalf("translation side kept source text or other pages: %+v", b)
		}
	}
	for _, bad := range []string{"?side=all", "?from=0", "?from=3&to=2", "?to=x"} {
		if w := request(t, s, "GET", "/api/documents/doc/text"+bad, nil); w.Code != 400 {
			t.Fatalf("%s: %d", bad, w.Code)
		}
	}
}

func TestDocumentTextReportsUnparsedPDF(t *testing.T) {
	s := testServer(t)
	if _, err := s.Store.DB.Exec("INSERT INTO documents(id,type,title,author,size,created_at,last_opened_at,library) VALUES('raw','pdf','Raw','',1,?,?,'papers')", now(), now()); err != nil {
		t.Fatal(err)
	}
	w := request(t, s, "GET", "/api/documents/raw/text", nil)
	text := decodeBody[documentText](t, w.Body.Bytes())
	if w.Code != 200 || text.Parsed || len(text.Blocks) != 0 {
		t.Fatalf("%d %+v", w.Code, text)
	}
	if w := request(t, s, "GET", "/api/documents/missing/text", nil); w.Code != 404 {
		t.Fatalf("missing document: %d", w.Code)
	}
}

func TestDocumentTextReadsEPUBChapters(t *testing.T) {
	s := testServer(t)
	w := upload(t, s, "the-art-of-reading.epub", sample(t, "the-art-of-reading.epub"))
	if w.Code != 201 {
		t.Fatalf("import: %d %s", w.Code, w.Body.String())
	}
	doc := decodeBody[Document](t, w.Body.Bytes())
	w = request(t, s, "GET", "/api/documents/"+doc.ID+"/text", nil)
	text := decodeBody[documentText](t, w.Body.Bytes())
	if !text.Parsed || text.Units < 2 || len(text.Blocks) == 0 {
		t.Fatalf("%+v", text)
	}
	w = request(t, s, "GET", "/api/documents/"+doc.ID+"/text?from=2&to=2", nil)
	chapter := decodeBody[documentText](t, w.Body.Bytes())
	if len(chapter.Blocks) == 0 {
		t.Fatal("second chapter is empty")
	}
	for _, b := range chapter.Blocks {
		if b.Unit != 2 || b.Href != chapter.Blocks[0].Href {
			t.Fatalf("chapter range crossed chapters: %+v", b)
		}
	}
}

func TestLibrarySearchMatchesSourceAndTranslation(t *testing.T) {
	s := textFixture(t)
	search := func(query string) []searchHit {
		t.Helper()
		w := request(t, s, "GET", "/api/search?"+query, nil)
		if w.Code != 200 {
			t.Fatalf("%s: %d %s", query, w.Code, w.Body.String())
		}
		return decodeBody[[]searchHit](t, w.Body.Bytes())
	}
	hits := search("q=" + url.QueryEscape("oze TPC-C"))
	if len(hits) != 1 || hits[0].Unit != 2 || hits[0].BlockID != "p2-b1" || hits[0].Side != "source" || hits[0].Title != "Concurrency Control" {
		t.Fatalf("all terms, any case: %+v", hits)
	}
	hits = search("q=" + url.QueryEscape("阻塞"))
	if len(hits) != 1 || hits[0].Side != "translation" || hits[0].Excerpt != "长事务会阻塞短事务。" {
		t.Fatalf("translation hit: %+v", hits)
	}
	if hits = search("q=throughput"); len(hits) != 1 || hits[0].BlockID != "p2-b2" {
		t.Fatalf("figure caption hit: %+v", hits)
	}
	if hits = search("q=oze+missing"); len(hits) != 0 {
		t.Fatalf("a missing term still matched: %+v", hits)
	}
	if hits = search("q=transactions&library=books"); len(hits) != 0 {
		t.Fatalf("library filter ignored: %+v", hits)
	}
	if hits = search("q=e&document=doc&limit=2"); len(hits) != 2 {
		t.Fatalf("limit ignored: %+v", hits)
	}
	for _, bad := range []string{"q=", "q=a&limit=0", "q=a&limit=201", "q=a&library=films"} {
		if w := request(t, s, "GET", "/api/search?"+bad, nil); w.Code != 400 {
			t.Fatalf("%s: %d", bad, w.Code)
		}
	}
	if w := request(t, s, "GET", "/api/search?q=a&document=missing", nil); w.Code != 404 {
		t.Fatalf("missing document: %d", w.Code)
	}
}

func TestSearchExcerptKeepsContextAroundTheTerm(t *testing.T) {
	long := ""
	for range 40 {
		long += "padding "
	}
	excerpt := searchExcerpt(long+"Needle in\n  the haystack "+long, "needle")
	if []rune(excerpt)[0] != '…' || !strings.Contains(excerpt, "Needle in the haystack") {
		t.Fatalf("%q", excerpt)
	}
	if got := searchExcerpt("短文本", "文"); got != "短文本" {
		t.Fatalf("%q", got)
	}
}

func TestImportBumpsLibraryRevision(t *testing.T) {
	s := testServer(t)
	before := s.connectorRevision.Load()
	if w := upload(t, s, "reading-notes.pdf", sample(t, "reading-notes.pdf")); w.Code != 201 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	if s.connectorRevision.Load() == before {
		t.Fatal("open windows would not see the imported document")
	}
}

func TestDiscoveryFileIsPrivateAndRemovedOnlyByItsWriter(t *testing.T) {
	root := t.TempDir()
	first := Discovery{URL: "http://127.0.0.1:1", Token: "secret", PID: 1, Version: "dev"}
	remove, err := WriteDiscovery(root, first)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, DiscoveryFile)
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0077 != 0 && os.PathSeparator == '/' {
		t.Fatalf("discovery file readable by others: %v", info.Mode())
	}
	data, _ := os.ReadFile(path)
	if decodeBody[Discovery](t, data) != first {
		t.Fatalf("%s", data)
	}
	// A newer server took over; the old one must not delete its file.
	if _, err = WriteDiscovery(root, Discovery{URL: "http://127.0.0.1:2", Token: "other", PID: 2}); err != nil {
		t.Fatal(err)
	}
	remove()
	if _, err = os.Stat(path); err != nil {
		t.Fatal("removed another server's discovery file")
	}
	entries, _ := os.ReadDir(root)
	if len(entries) != 1 {
		t.Fatalf("temporary files left behind: %v", entries)
	}
}
