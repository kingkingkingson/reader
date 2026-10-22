package reader

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func recoveryRequest(t *testing.T, s *Server) []Annotation {
	t.Helper()
	out := request(t, s, "POST", "/api/documents/doc/annotations/recover", strings.NewReader(`{}`))
	if out.Code != 200 {
		t.Fatalf("recover: %d %s", out.Code, out.Body.String())
	}
	out = request(t, s, "GET", "/api/documents/doc/annotations", nil)
	var items []Annotation
	if out.Code != 200 || json.Unmarshal(out.Body.Bytes(), &items) != nil {
		t.Fatal(out.Body.String())
	}
	return items
}

func TestRecoverHistoricalTranslationAndSplitLegacy(t *testing.T) {
	s, _, m := completedTranslationFixture(t)
	b := m.Blocks[0]
	a := Annotation{ID: "old", DocumentID: "doc", Kind: "highlight", Quote: "重要", Note: "保留笔记", Color: "#e6b94c", CreatedAt: "2026-01-01"}
	a.Location = json.RawMessage(`{"type":"pdf","page":1,"quote":"First sentence.","rects":[{"x":0.1,"y":0.1,"width":0.2,"height":0.1}],"translation":{"blockId":"` + b.ID + `","sourceHash":"` + translationHash(b.Text) + `","sentenceIndexes":[0],"start":2,"end":4},"sentenceLink":{"origin":"translation","parts":[{"blockId":"` + b.ID + `","sourceHash":"` + translationHash(b.Text) + `","sentenceIndex":0,"source":"First sentence.","target":"这是重要的结论。"}]}}`)
	if _, err := s.Store.DB.Exec("INSERT INTO annotations VALUES(?,?,?)", a.ID, a.DocumentID, jsonText(a)); err != nil {
		t.Fatal(err)
	}
	tx := newTranslation(b)
	tx.Status = "complete"
	tx.Sentences = []TranslationSentence{{Source: "First sentence.", Target: "这是一项重要的结论。"}, {Source: "Second sentence.", Target: "另一句。"}}
	if err := s.saveTranslation("doc", tx); err != nil {
		t.Fatal(err)
	}
	items := recoveryRequest(t, s)
	if len(items) != 2 {
		t.Fatalf("want two independent sides, got %+v", items)
	}
	var source, translated int
	for _, item := range items {
		var loc map[string]json.RawMessage
		_ = json.Unmarshal(item.Location, &loc)
		if len(loc["sentenceLink"]) != 0 {
			t.Fatal("legacy link retained")
		}
		if len(loc["translation"]) == 0 {
			source++
			if item.Quote != "First sentence." {
				t.Fatal(item.Quote)
			}
		} else {
			translated++
			if !strings.Contains(string(item.Location), `"matchedQuote":"重要"`) {
				t.Fatal(string(item.Location))
			}
		}
		if item.Note != a.Note || item.CreatedAt != a.CreatedAt {
			t.Fatal("metadata lost")
		}
	}
	if source != 1 || translated != 1 {
		t.Fatal(source, translated)
	}
	if again := recoveryRequest(t, s); len(again) != 2 {
		t.Fatal("migration not idempotent")
	}
}

func insertRecoveryMark(t *testing.T, s *Server, b PDFBlock, quote, source string) Annotation {
	t.Helper()
	a := Annotation{ID: id(), DocumentID: "doc", Kind: "highlight", Quote: quote, Note: "note", Color: "#e6b94c", CreatedAt: now()}
	a.Location = json.RawMessage(jsonText(map[string]any{"type": "pdf", "page": 1, "translation": translationMark{translationMarkRange: translationMarkRange{BlockID: b.ID, SourceHash: translationHash(b.Text), SentenceIndexes: []int{0}, Start: 0, End: 2, SourceText: source}}}))
	if _, err := s.Store.DB.Exec("INSERT INTO annotations VALUES(?,?,?)", a.ID, a.DocumentID, jsonText(a)); err != nil {
		t.Fatal(err)
	}
	return a
}
func recoveredMark(t *testing.T, a Annotation) translationMark {
	t.Helper()
	var loc struct {
		Mark translationMark `json:"translation"`
	}
	if err := json.Unmarshal(a.Location, &loc); err != nil {
		t.Fatal(err)
	}
	return loc.Mark
}
func TestRecoverySplitsSourceSentenceAndFallsBackToWholeSentence(t *testing.T) {
	s, _, m := completedTranslationFixture(t)
	b := m.Blocks[0]
	insertRecoveryMark(t, s, b, "找不到的词", b.Text)
	tx := newTranslation(b)
	tx.Status = "complete"
	tx.Sentences = []TranslationSentence{{Source: "First sentence.", Target: "新的一句。"}, {Source: "Second sentence.", Target: "另外一句。"}}
	if err := s.saveTranslation("doc", tx); err != nil {
		t.Fatal(err)
	}
	items := recoveryRequest(t, s)
	if len(items) != 1 {
		t.Fatal(items)
	}
	mark := recoveredMark(t, items[0])
	if !mark.WholeSentence || !equalIndexes(mark.SentenceIndexes, []int{0, 1}) {
		t.Fatalf("%+v", mark)
	}
}
func TestRecoveryDeletesOnlyOrphanedTranslationAndSkipsChecked(t *testing.T) {
	s, _, m := completedTranslationFixture(t)
	a := insertRecoveryMark(t, s, m.Blocks[0], "旧译文", "")
	recoveryRequest(t, s)
	var checked bool
	if err := s.Store.DB.QueryRow("SELECT checked FROM annotation_recovery WHERE document_id='doc'").Scan(&checked); err != nil || !checked {
		t.Fatal(err, checked)
	}
	orphan := a
	orphan.ID = "orphan"
	orphan.Location = json.RawMessage(`{"type":"pdf","page":99,"translation":{"blockId":"gone","sourceHash":"gone","sentenceIndexes":[0],"start":0,"end":2}}`)
	source := a
	source.ID = "source"
	source.Location = json.RawMessage(`{"type":"pdf","page":99,"quote":"source"}`)
	for _, item := range []Annotation{orphan, source} {
		if _, err := s.Store.DB.Exec("INSERT INTO annotations VALUES(?,?,?)", item.ID, item.DocumentID, jsonText(item)); err != nil {
			t.Fatal(err)
		}
	}
	if items := recoveryRequest(t, s); len(items) != 3 {
		t.Fatal("checked document was scanned again", items)
	}
	out := request(t, s, "POST", "/api/documents/doc/annotations/recover", strings.NewReader(`{"force":true}`))
	if out.Code != 200 {
		t.Fatal(out.Body.String())
	}
	items := recoveryRequest(t, s)
	if len(items) != 2 {
		t.Fatal(items)
	}
	for _, item := range items {
		if item.ID == "orphan" {
			t.Fatal("orphan retained")
		}
	}
}
func TestRecoveryRefusesRetranslatingOrIncompleteData(t *testing.T) {
	s, _, m := completedTranslationFixture(t)
	insertRecoveryMark(t, s, m.Blocks[0], "旧译文", "")
	assistanceRequest(t, s, "retranslate")
	out := request(t, s, "POST", "/api/documents/doc/annotations/recover", strings.NewReader(`{}`))
	if out.Code != 200 || !strings.Contains(out.Body.String(), `"checked":false`) {
		t.Fatal(out.Code, out.Body.String())
	}
	var count int
	_ = s.Store.DB.QueryRow("SELECT count(*) FROM annotations").Scan(&count)
	if count != 1 {
		t.Fatal("annotation deleted while retranslating")
	}
}
func TestRecoveryAndRetranslationAreMutuallyExclusive(t *testing.T) {
	s, _, _ := completedTranslationFixture(t)
	lock := s.annotationRecoveryLock("doc")
	lock.Lock()
	defer lock.Unlock()
	for _, route := range []struct{ url, body string }{{"annotations/recover", `{}`}, {"assistance", `{"action":"retranslate"}`}} {
		out := request(t, s, "POST", "/api/documents/doc/"+route.url, strings.NewReader(route.body))
		if out.Code != 409 {
			t.Fatal(out.Code, out.Body.String())
		}
	}
}
func TestRecoveryCancelledTransactionDoesNotPartiallyMigrate(t *testing.T) {
	s, _, m := completedTranslationFixture(t)
	insertRecoveryMark(t, s, m.Blocks[0], "旧译文", "")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	tx, err := s.Store.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	translations := m.translationItems()
	err = s.recoverAnnotationRows(ctx, tx, "doc", m, translations)
	_ = tx.Rollback()
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	var count int
	_ = s.Store.DB.QueryRow("SELECT count(*) FROM annotations").Scan(&count)
	if count != 1 {
		t.Fatal(count)
	}
	var checked bool
	_ = s.Store.DB.QueryRow("SELECT checked FROM annotation_recovery WHERE document_id='doc'").Scan(&checked)
	if checked {
		t.Fatal("cancelled check marked complete")
	}
}
func TestRecoveryCapturesOldContextBeforeRetranslation(t *testing.T) {
	s, _, m := completedTranslationFixture(t)
	insertRecoveryMark(t, s, m.Blocks[0], "旧译文", "")
	assistanceRequest(t, s, "retranslate")
	out := request(t, s, "GET", "/api/documents/doc/annotations", nil)
	var items []Annotation
	_ = json.Unmarshal(out.Body.Bytes(), &items)
	mark := recoveredMark(t, items[0])
	if mark.SourceText != m.Blocks[0].Text || mark.TargetText != "旧译文" {
		t.Fatalf("%+v", mark)
	}
}
func TestRecoveryMatchesQuotesWithThresholdAndStrictShortWords(t *testing.T) {
	for _, test := range []struct{ quote, target, want string }{
		{"重要", "这是一项重要的重要结论", "重要"},
		{"abcd", "xxabceyy", "abce"},
		{"abcde", "abXYe", "abXYe"},
		{"abcde", "aXYZf", ""},
		{"安全性", "安定性", ""},
		{"12345", "12346", ""},
		{"Ａ B", "A　B", "A　B"},
	} {
		if got := matchRecoveryQuote(context.Background(), test.quote, test.target); got != test.want {
			t.Errorf("%q in %q = %q want %q", test.quote, test.target, got, test.want)
		}
	}
}

func TestRecoveryReparsedBlockUsesSourceEvidenceAndKeepsSingleSides(t *testing.T) {
	s, _, m := completedTranslationFixture(t)
	old := m.Blocks[0]
	insertRecoveryMark(t, s, old, "旧词", "First sentence.")
	source := Annotation{ID: "source-only", DocumentID: "doc", Kind: "highlight", Quote: "First sentence.", Location: json.RawMessage(`{"type":"pdf","page":1,"quote":"First sentence."}`)}
	_, err := s.Store.DB.Exec("INSERT INTO annotations VALUES(?,?,?)", source.ID, source.DocumentID, jsonText(source))
	if err != nil {
		t.Fatal(err)
	}
	m.Blocks[0].ID = "p1-b9"
	if err = os.WriteFile(filepath.Join(s.analysisDir("doc"), "manifest.json"), []byte(jsonText(m)), 0600); err != nil {
		t.Fatal(err)
	}
	current := newTranslation(m.Blocks[0])
	current.Status = "complete"
	current.Sentences = []TranslationSentence{{Source: "First sentence.", Target: "新的表达。"}, {Source: "Second sentence.", Target: "第二句。"}}
	if err = s.saveTranslation("doc", current); err != nil {
		t.Fatal(err)
	}
	items := recoveryRequest(t, s)
	if len(items) != 2 {
		t.Fatal(items)
	}
	for _, item := range items {
		if item.ID != source.ID {
			mark := recoveredMark(t, item)
			if mark.BlockID != "p1-b9" || !mark.WholeSentence || !equalIndexes(mark.SentenceIndexes, []int{0}) {
				t.Fatalf("%+v", mark)
			}
		}
	}
	reopened, err := OpenStore(s.Store.Root)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.DB.Close()
	again := recoveryRequest(t, NewServer(reopened, "test-secret", ""))
	if len(again) != 2 {
		t.Fatal(again)
	}
	var checked bool
	if err = reopened.DB.QueryRow("SELECT checked FROM annotation_recovery WHERE document_id='doc'").Scan(&checked); err != nil || !checked {
		t.Fatal(err, checked)
	}
}
func TestRecoveryLegacySourceOriginKeepsOriginalIdentity(t *testing.T) {
	s, _, m := completedTranslationFixture(t)
	b := m.Blocks[0]
	a := Annotation{ID: "source-origin", DocumentID: "doc", Kind: "note", Quote: "First sentence.", Note: "my note", Color: "#e6b94c", CreatedAt: now()}
	a.Location = json.RawMessage(jsonText(map[string]any{"type": "pdf", "page": 1, "sentenceLink": legacySentenceLink{Origin: "source", Parts: []legacySentencePart{{BlockID: b.ID, SourceHash: translationHash(b.Text), SentenceIndex: 0, Source: "First sentence.", Target: "第一句。"}}}}))
	_, err := s.Store.DB.Exec("INSERT INTO annotations VALUES(?,?,?)", a.ID, a.DocumentID, jsonText(a))
	if err != nil {
		t.Fatal(err)
	}
	items := recoveryRequest(t, s)
	if len(items) != 2 {
		t.Fatal(items)
	}
	for _, item := range items {
		if item.ID == a.ID {
			if strings.Contains(string(item.Location), "translation") || item.Quote != a.Quote {
				t.Fatal(item)
			}
		} else {
			if !recoveredMark(t, item).WholeSentence || item.Quote != "第一句。" || item.Note != a.Note {
				t.Fatal(item)
			}
		}
	}
}
func TestRecoveryLeavesMissingUnparsedPagesUntouched(t *testing.T) {
	s, _, m := completedTranslationFixture(t)
	a := insertRecoveryMark(t, s, m.Blocks[0], "quote", "")
	a.Location = json.RawMessage(`{"type":"pdf","page":99,"translation":{"blockId":"missing","sourceHash":"missing","sentenceIndexes":[0],"start":0,"end":2}}`)
	_, err := s.Store.DB.Exec("UPDATE annotations SET body=? WHERE id=?", jsonText(a), a.ID)
	if err != nil {
		t.Fatal(err)
	}
	m.ParsedPages = []int{1}
	if err = os.WriteFile(filepath.Join(s.analysisDir("doc"), "manifest.json"), []byte(jsonText(m)), 0600); err != nil {
		t.Fatal(err)
	}
	out := request(t, s, "POST", "/api/documents/doc/annotations/recover", strings.NewReader(`{}`))
	if out.Code != 500 {
		t.Fatal(out.Code, out.Body.String())
	}
	var count int
	_ = s.Store.DB.QueryRow("SELECT count(*) FROM annotations").Scan(&count)
	if count != 1 {
		t.Fatal("unparsed page treated as orphan")
	}
}

func TestRecoveryReanchorsWhenOnlyEarlierSentenceLengthChanges(t *testing.T) {
	s, _, m := completedTranslationFixture(t)
	b := m.Blocks[0]
	a := insertRecoveryMark(t, s, b, "重要", "Second sentence.")
	var loc map[string]json.RawMessage
	_ = json.Unmarshal(a.Location, &loc)
	mark := recoveredMark(t, a)
	mark.Start, mark.End = 2, 4
	mark.SentenceIndexes = []int{1}
	mark.TargetText = "重要"
	loc["translation"] = json.RawMessage(jsonText(mark))
	a.Location = json.RawMessage(jsonText(loc))
	_, err := s.Store.DB.Exec("UPDATE annotations SET body=? WHERE id=?", jsonText(a), a.ID)
	if err != nil {
		t.Fatal(err)
	}
	current := newTranslation(b)
	current.Status = "complete"
	current.Sentences = []TranslationSentence{{Source: "First sentence.", Target: "第一句现在变得更长。"}, {Source: "Second sentence.", Target: "重要"}}
	if err = s.saveTranslation("doc", current); err != nil {
		t.Fatal(err)
	}
	items := recoveryRequest(t, s)
	mark = recoveredMark(t, items[0])
	if !mark.Recovered || mark.MatchedQuote != "重要" || !equalIndexes(mark.SentenceIndexes, []int{1}) {
		t.Fatalf("old paragraph offsets survived: %+v", mark)
	}
}
func TestRecoveryUndoRestoringStaleMarkResetsCheck(t *testing.T) {
	s, _, m := completedTranslationFixture(t)
	a := insertRecoveryMark(t, s, m.Blocks[0], "旧译文", "")
	out := undoRequest(t, s, "client", "DELETE", "/api/documents/doc/annotations/"+a.ID, nil)
	if out.Code != 204 {
		t.Fatal(out.Code, out.Body.String())
	}
	recoveryRequest(t, s)
	undoLast(t, s, "client")
	var checked bool
	if err := s.Store.DB.QueryRow("SELECT checked FROM annotation_recovery WHERE document_id='doc'").Scan(&checked); err != nil || checked {
		t.Fatal("undo did not reset check", err, checked)
	}
	items := recoveryRequest(t, s)
	if len(items) != 1 || !recoveredMark(t, items[0]).Recovered {
		t.Fatal(items)
	}
}

func TestRecoveryCheckedFastPathAndBusyLocksDoNotWait(t *testing.T) {
	s, _, _ := completedTranslationFixture(t)
	recoveryRequest(t, s)
	s.annotationMu.Lock()
	s.translationMu.Lock()
	// Release after a deadline even if the handler regresses to blocking locks.
	done := make(chan struct{})
	out := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "http://127.0.0.1:17840/api/documents/doc/annotations/recover", strings.NewReader(`{}`))
	r.Header.Set("Authorization", "Bearer "+s.Token)
	go func() { s.Handler().ServeHTTP(out, r); close(done) }()
	waited := false
	select {
	case <-done:
	case <-time.After(time.Second):
		waited = true
	}
	s.translationMu.Unlock()
	s.annotationMu.Unlock()
	<-done
	if waited || out.Code != 200 {
		t.Fatal("checked fast path waited for mutation locks", out.Code)
	}
	_, err := s.Store.DB.Exec("UPDATE annotation_recovery SET checked=0 WHERE document_id='doc'")
	if err != nil {
		t.Fatal(err)
	}
	for _, lock := range []*sync.Mutex{&s.annotationMu, &s.translationMu} {
		lock.Lock()
		out = httptest.NewRecorder()
		done = make(chan struct{})
		r = httptest.NewRequest("POST", "http://127.0.0.1:17840/api/documents/doc/annotations/recover", strings.NewReader(`{}`))
		r.Header.Set("Authorization", "Bearer "+s.Token)
		go func() { s.Handler().ServeHTTP(out, r); close(done) }()
		waited = false
		select {
		case <-done:
		case <-time.After(time.Second):
			waited = true
		}
		lock.Unlock()
		<-done
		if waited || out.Code != 409 {
			t.Fatal("busy lock queued check", out.Code)
		}
	}
}
