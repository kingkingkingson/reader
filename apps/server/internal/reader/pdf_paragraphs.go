package reader

import (
	"math"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// PDFFragment is one page's geometry for a paragraph that continues across pages.
type PDFFragment struct {
	ID     string `json:"id"`
	Page   int    `json:"page"`
	Bounds struct {
		X      float64 `json:"x"`
		Y      float64 `json:"y"`
		Width  float64 `json:"width"`
		Height float64 `json:"height"`
	} `json:"bounds"`
	Text string `json:"text"`
}

// readingBlocks joins a paragraph that the page-wise layout split across a page boundary.
func (m layoutManifest) readingBlocks() []PDFBlock {
	return joinCrossPageParagraphs(m.Blocks)
}

func joinCrossPageParagraphs(blocks []PDFBlock) []PDFBlock {
	if len(blocks) < 2 {
		return append([]PDFBlock(nil), blocks...)
	}
	logical := append([]PDFBlock(nil), blocks...)
	sortPDFBlocks(logical)
	consumed := map[string]bool{}
	maxPage := 0
	for _, b := range logical {
		if b.Page > maxPage {
			maxPage = b.Page
		}
	}
	for page := 1; page < maxPage; page++ {
		head := continuationHead(logical, consumed, page)
		tail := continuationTail(logical, consumed, page+1)
		if head == nil || tail == nil || !paragraphContinues(*head, *tail) {
			continue
		}
		absorbParagraph(head, tail)
		consumed[tail.ID] = true
	}
	out := make([]PDFBlock, 0, len(logical))
	for _, b := range logical {
		if consumed[b.ID] {
			continue
		}
		if len(b.Fragments) < 2 {
			b.Fragments = nil
		}
		out = append(out, b)
	}
	return out
}

func sortPDFBlocks(blocks []PDFBlock) {
	for i := 1; i < len(blocks); i++ {
		item := blocks[i]
		j := i
		for j > 0 && pdfBlockLess(item, blocks[j-1]) {
			blocks[j] = blocks[j-1]
			j--
		}
		blocks[j] = item
	}
}

func pdfBlockLess(a, b PDFBlock) bool {
	if a.Page != b.Page {
		return a.Page < b.Page
	}
	return blockOrder(a.ID) < blockOrder(b.ID)
}

func continuationHead(blocks []PDFBlock, consumed map[string]bool, page int) *PDFBlock {
	indexes := []int{}
	for i := range blocks {
		if consumed[blocks[i].ID] || fragmentEnd(blocks[i]).Page != page {
			continue
		}
		indexes = append(indexes, i)
	}
	for n := len(indexes) - 1; n >= 0; n-- {
		b := &blocks[indexes[n]]
		if trailingPageFurniture(b) {
			continue
		}
		end := fragmentEnd(*b)
		if proseFamily(b.Label) == "" || !nearPageBottom(end.Bounds) {
			return nil
		}
		return b
	}
	return nil
}

func continuationTail(blocks []PDFBlock, consumed map[string]bool, page int) *PDFBlock {
	for i := range blocks {
		b := &blocks[i]
		if consumed[b.ID] || b.Page != page {
			continue
		}
		if leadingPageFurniture(b) {
			continue
		}
		if proseFamily(b.Label) == "" || !nearPageTop(boxOf(b.Bounds.X, b.Bounds.Y, b.Bounds.Width, b.Bounds.Height)) {
			return nil
		}
		return b
	}
	return nil
}

func trailingPageFurniture(b *PDFBlock) bool {
	switch b.Label {
	case "footnote", "vision_footnote", "footer", "footer_image", "header", "header_image", "number", "seal":
		return true
	default:
		return isPDFPageDecoration(*b)
	}
}

func leadingPageFurniture(b *PDFBlock) bool {
	switch b.Label {
	case "header", "header_image", "footer", "footer_image", "number", "seal":
		return true
	default:
		return isPDFPageDecoration(*b)
	}
}

func proseFamily(label string) string {
	switch label {
	case "text", "abstract", "content":
		return "body"
	case "aside_text":
		return "aside"
	default:
		return ""
	}
}

func nearPageBottom(b pdfBox) bool {
	return b.Y+b.Height >= 0.68
}

func nearPageTop(b pdfBox) bool {
	return b.Y <= 0.28
}

func boxOf(x, y, width, height float64) pdfBox {
	return pdfBox{x, y, width, height}
}

func paragraphContinues(head, tail PDFBlock) bool {
	if proseFamily(head.Label) == "" || proseFamily(head.Label) != proseFamily(tail.Label) {
		return false
	}
	end := fragmentEnd(head)
	tailBox := boxOf(tail.Bounds.X, tail.Bounds.Y, tail.Bounds.Width, tail.Bounds.Height)
	if end.Page+1 != tail.Page || !nearPageBottom(end.Bounds) || !nearPageTop(tailBox) {
		return false
	}
	if !similarColumn(end.Bounds, tailBox) {
		return false
	}
	headText := strings.TrimSpace(end.Text)
	tailText := strings.TrimSpace(tail.Text)
	if utf8.RuneCountInString(headText) < 4 || utf8.RuneCountInString(tailText) < 4 {
		return false
	}
	if sentenceEnded(headText) || startsNewParagraph(tailText) {
		return false
	}
	return true
}

func similarColumn(a, b pdfBox) bool {
	if a.Width < 0.18 || b.Width < 0.18 {
		return false
	}
	maxWidth := math.Max(a.Width, b.Width)
	return math.Abs(a.Width-b.Width)/maxWidth <= 0.3
}

func sentenceEnded(text string) bool {
	r, ok := lastMeaningfulRune(text)
	if !ok {
		return true
	}
	return strings.ContainsRune(".?!。！？…", r)
}

func lastMeaningfulRune(text string) (rune, bool) {
	text = strings.TrimSpace(text)
	for len(text) > 0 {
		r, size := utf8.DecodeLastRuneInString(text)
		if r == utf8.RuneError && size == 1 {
			return 0, false
		}
		if strings.ContainsRune(" \t\"'”’“‘)]）】》〉", r) {
			text = text[:len(text)-size]
			continue
		}
		return r, true
	}
	return 0, false
}

var newParagraphStart = regexp.MustCompile(`(?i)^(?:[-•·▪▸]|\d+[.)、]|[(（]\d+[)）]|(?:figure|fig\.?|table|algorithm)\s*\d+|[图表]\s*\d+|第\s*[0-9０-９一二三四五六七八九十]+\s*[章节])`)

func startsNewParagraph(text string) bool {
	return newParagraphStart.MatchString(strings.TrimSpace(text))
}

func absorbParagraph(head, tail *PDFBlock) {
	ensureFragments(head)
	ensureFragments(tail)
	head.Fragments = append(head.Fragments, tail.Fragments...)
	head.Text = joinParagraphText(head.Text, tail.Text)
}

func ensureFragments(b *PDFBlock) {
	if len(b.Fragments) > 0 {
		return
	}
	b.Fragments = []PDFFragment{fragmentFromBlock(*b)}
}

func fragmentFromBlock(b PDFBlock) PDFFragment {
	f := PDFFragment{ID: b.ID, Page: b.Page, Text: strings.TrimSpace(b.Text)}
	f.Bounds.X, f.Bounds.Y, f.Bounds.Width, f.Bounds.Height = b.Bounds.X, b.Bounds.Y, b.Bounds.Width, b.Bounds.Height
	return f
}

type pdfRegion struct {
	Page   int
	Bounds pdfBox
	Text   string
}

type pdfBox struct {
	X, Y, Width, Height float64
}

func fragmentEnd(b PDFBlock) pdfRegion {
	if n := len(b.Fragments); n > 0 {
		f := b.Fragments[n-1]
		return pdfRegion{Page: f.Page, Bounds: pdfBox{f.Bounds.X, f.Bounds.Y, f.Bounds.Width, f.Bounds.Height}, Text: f.Text}
	}
	return pdfRegion{Page: b.Page, Bounds: pdfBox{b.Bounds.X, b.Bounds.Y, b.Bounds.Width, b.Bounds.Height}, Text: b.Text}
}

func joinParagraphText(head, tail string) string {
	head = strings.TrimSpace(head)
	tail = strings.TrimSpace(tail)
	if head == "" {
		return tail
	}
	if tail == "" {
		return head
	}
	last, _ := utf8.DecodeLastRuneInString(head)
	first, _ := utf8.DecodeRuneInString(tail)
	if (last == '-' || last == '‐' || last == '\u00ad') && unicode.IsLower(first) {
		return strings.TrimRight(head, "-‐\u00ad") + tail
	}
	if isCJK(last) && isCJK(first) {
		return head + tail
	}
	return head + " " + tail
}

func isCJK(r rune) bool {
	return unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r) || unicode.Is(unicode.Hangul, r)
}
