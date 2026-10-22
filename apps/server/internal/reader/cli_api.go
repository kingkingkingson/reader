package reader

import (
	"context"
	"net/http"
	"strconv"
	"strings"
)

// Plain-text access for the `reader` command line. PDFs are read from the
// layout index, so a PDF has text only after its layout has been parsed.
// EPUB text comes from the chapters. Units are pages for a PDF and reading-order
// chapters for an EPUB.

type textBlock struct {
	ID          string `json:"id"`
	Unit        int    `json:"unit"`
	Href        string `json:"href,omitempty"`
	Label       string `json:"label"`
	Text        string `json:"text"`
	Translation string `json:"translation,omitempty"`
}
type documentText struct {
	DocumentID string `json:"documentId"`
	Type       string `json:"type"`
	// Units is the page count of a PDF or the chapter count of an EPUB.
	Units int `json:"units"`
	// Parsed is false for a PDF without a layout index; it then has no text.
	Parsed bool `json:"parsed"`
	// ParsedPages lists the parsed pages of a partly parsed book; empty means all.
	ParsedPages []int       `json:"parsedPages,omitempty"`
	Blocks      []textBlock `json:"blocks"`
}

// readDocumentText returns the readable blocks of a document in reading order.
func (s *Server) readDocumentText(d Document, translations bool) (documentText, error) {
	out := documentText{DocumentID: d.ID, Type: d.Type, Blocks: []textBlock{}}
	source, err := s.readTranslationSource(d.ID)
	if err != nil {
		if d.Type == "pdf" {
			return out, nil
		}
		return out, err
	}
	switch m := source.(type) {
	case layoutManifest:
		out.Parsed = true
		out.Units = m.Pages
		out.ParsedPages = m.ParsedPages
		for _, b := range m.readingBlocks() {
			if isPDFPageDecoration(b) {
				continue
			}
			text := strings.TrimSpace(b.Text)
			if isImageAsset(b) {
				text = strings.TrimSpace(b.Caption)
			}
			if text == "" {
				continue
			}
			out.Blocks = append(out.Blocks, textBlock{ID: b.ID, Unit: b.Page, Label: b.Label, Text: text})
		}
	case epubTranslationDocument:
		out.Parsed = true
		chapter := map[string]int{}
		for _, b := range m {
			if _, ok := chapter[b.Location.Href]; !ok {
				chapter[b.Location.Href] = len(chapter) + 1
			}
			text := strings.TrimSpace(b.Text)
			if text == "" {
				continue
			}
			out.Blocks = append(out.Blocks, textBlock{ID: b.ID, Unit: chapter[b.Location.Href], Href: b.Location.Href, Label: b.Label, Text: text})
		}
		out.Units = len(chapter)
	}
	if !translations {
		return out, nil
	}
	items, err := s.translations(d.ID, source)
	if err != nil {
		return out, err
	}
	targets := map[string]string{}
	for _, t := range items {
		if t.Status != "complete" {
			continue
		}
		parts := []string{}
		for _, sentence := range t.Sentences {
			parts = append(parts, sentence.Target)
		}
		if t.FormulaMarkdown != "" {
			parts = append(parts, t.FormulaMarkdown)
		}
		targets[t.BlockID] = strings.TrimSpace(strings.Join(parts, " "))
	}
	for i := range out.Blocks {
		out.Blocks[i].Translation = targets[out.Blocks[i].ID]
	}
	return out, nil
}

func (s *Server) documentText(w http.ResponseWriter, r *http.Request) {
	d, err := s.Store.Document(r.PathValue("id"))
	if err != nil || d.DeletedAt != "" {
		fail(w, 404, "文档不存在")
		return
	}
	query := r.URL.Query()
	side := query.Get("side")
	if side == "" {
		side = "source"
	}
	if side != "source" && side != "translation" && side != "both" {
		fail(w, 400, "side 只能是 source、translation 或 both")
		return
	}
	from, to := 1, 0
	for name, target := range map[string]*int{"from": &from, "to": &to} {
		if raw := query.Get(name); raw != "" {
			n, e := strconv.Atoi(raw)
			if e != nil || n < 1 {
				fail(w, 400, "页码或章节必须是正整数")
				return
			}
			*target = n
		}
	}
	if to != 0 && to < from {
		fail(w, 400, "结束页不能小于起始页")
		return
	}
	text, err := s.readDocumentText(d, side != "source")
	if err != nil {
		fail(w, 500, "无法读取正文")
		return
	}
	blocks := []textBlock{}
	for _, b := range text.Blocks {
		if b.Unit < from || (to != 0 && b.Unit > to) {
			continue
		}
		if side == "translation" {
			b.Text = ""
		} else if side == "source" {
			b.Translation = ""
		}
		blocks = append(blocks, b)
	}
	text.Blocks = blocks
	respond(w, 200, text)
}

type searchHit struct {
	DocumentID string `json:"documentId"`
	Title      string `json:"title"`
	Type       string `json:"type"`
	Unit       int    `json:"unit"`
	Href       string `json:"href,omitempty"`
	BlockID    string `json:"blockId"`
	Side       string `json:"side"`
	Excerpt    string `json:"excerpt"`
}

// searchTerms splits a query into lowercase terms; a block must contain all.
func searchTerms(q string) []string {
	terms := []string{}
	for _, term := range strings.Fields(strings.ToLower(q)) {
		terms = append(terms, term)
	}
	return terms
}
func matchesAll(text string, terms []string) bool {
	lower := strings.ToLower(text)
	for _, term := range terms {
		if !strings.Contains(lower, term) {
			return false
		}
	}
	return true
}

// searchExcerpt keeps about 160 characters around the first term.
func searchExcerpt(text, term string) string {
	runes := []rune(text)
	start := 0
	if index := strings.Index(strings.ToLower(text), term); index >= 0 {
		// Lowercasing can change byte lengths; count runes of the original prefix.
		start = len([]rune(strings.ToLower(text)[:index])) - 50
	}
	start = max(0, min(start, len(runes)))
	end := min(len(runes), start+160)
	excerpt := strings.Join(strings.Fields(string(runes[start:end])), " ")
	if start > 0 {
		excerpt = "…" + excerpt
	}
	if end < len(runes) {
		excerpt += "…"
	}
	return excerpt
}

// searchLibrary scans the text of every document in reading order. Documents
// are scanned on demand; there is no index for PDF layout text yet.
func (s *Server) searchLibrary(ctx context.Context, docs []Document, terms []string, limit int) ([]searchHit, error) {
	hits := []searchHit{}
	for _, d := range docs {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		text, err := s.readDocumentText(d, true)
		if err != nil {
			// One unreadable document must not hide the others.
			continue
		}
		for _, b := range text.Blocks {
			for _, side := range []struct{ name, text string }{{"source", b.Text}, {"translation", b.Translation}} {
				if side.text == "" || !matchesAll(side.text, terms) {
					continue
				}
				hits = append(hits, searchHit{DocumentID: d.ID, Title: d.Title, Type: d.Type, Unit: b.Unit, Href: b.Href, BlockID: b.ID, Side: side.name, Excerpt: searchExcerpt(side.text, terms[0])})
				if len(hits) == limit {
					return hits, nil
				}
				break
			}
		}
	}
	return hits, nil
}

func (s *Server) librarySearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	terms := searchTerms(query.Get("q"))
	if len(terms) == 0 {
		fail(w, 400, "请输入搜索内容")
		return
	}
	limit := 20
	if raw := query.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 200 {
			fail(w, 400, "limit 必须在 1 到 200 之间")
			return
		}
		limit = n
	}
	library := query.Get("library")
	if library != "" && !validLibrary(library) {
		fail(w, 400, "未知书库")
		return
	}
	var docs []Document
	if id := query.Get("document"); id != "" {
		d, err := s.Store.Document(id)
		if err != nil || d.DeletedAt != "" {
			fail(w, 404, "文档不存在")
			return
		}
		docs = []Document{d}
	} else {
		all, err := s.Store.Documents()
		if err != nil {
			fail(w, 500, "无法读取书库")
			return
		}
		for _, d := range all {
			if library == "" || d.Library == library {
				docs = append(docs, d)
			}
		}
	}
	hits, err := s.searchLibrary(r.Context(), docs, terms, limit)
	if err != nil {
		return
	}
	respond(w, 200, hits)
}
