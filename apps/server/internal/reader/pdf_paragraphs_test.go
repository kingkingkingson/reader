package reader

import "testing"

func prose(id string, page int, y, height float64, text string) PDFBlock {
	b := PDFBlock{ID: id, Page: page, Label: "text", Text: text}
	b.Bounds.X, b.Bounds.Y, b.Bounds.Width, b.Bounds.Height = 0.12, y, 0.76, height
	return b
}

func TestJoinCrossPageParagraph(t *testing.T) {
	blocks := []PDFBlock{
		prose("p1-b1", 1, 0.72, 0.16, "The method keeps a running process-"),
		prose("p2-b1", 2, 0.1, 0.2, "ing across the page boundary."),
		prose("p2-b2", 2, 0.4, 0.1, "A later paragraph stays separate."),
	}
	joined := joinCrossPageParagraphs(blocks)
	if len(joined) != 2 || joined[0].ID != "p1-b1" || joined[1].ID != "p2-b2" {
		t.Fatalf("paragraphs: %+v", joined)
	}
	if joined[0].Text != "The method keeps a running processing across the page boundary." {
		t.Fatalf("text: %q", joined[0].Text)
	}
	if len(joined[0].Fragments) != 2 || joined[0].Fragments[1].Page != 2 || joined[0].Fragments[1].ID != "p2-b1" {
		t.Fatalf("fragments: %+v", joined[0].Fragments)
	}
	if len(joined[1].Fragments) != 0 {
		t.Fatalf("separate paragraph gained fragments: %+v", joined[1].Fragments)
	}
}

func TestJoinCrossPageParagraphKeepsFinishedSentences(t *testing.T) {
	blocks := []PDFBlock{
		prose("p1-b1", 1, 0.7, 0.18, "This paragraph is finished."),
		prose("p2-b1", 2, 0.1, 0.16, "The next page starts another one."),
	}
	joined := joinCrossPageParagraphs(blocks)
	if len(joined) != 2 || joined[0].Text != blocks[0].Text {
		t.Fatalf("finished sentence was joined: %+v", joined)
	}
}

func TestJoinCrossPageParagraphSkipsAHeading(t *testing.T) {
	next := prose("p2-b2", 2, 0.2, 0.2, "Body after the heading continues here.")
	title := prose("p2-b1", 2, 0.08, 0.06, "2 Related work")
	title.Label = "paragraph_title"
	blocks := []PDFBlock{
		prose("p1-b1", 1, 0.75, 0.12, "The discussion does not end"),
		title,
		next,
	}
	joined := joinCrossPageParagraphs(blocks)
	if len(joined) != 3 {
		t.Fatalf("heading did not stop the join: %+v", joined)
	}
}

func TestJoinCrossPageParagraphSkipsFootnotes(t *testing.T) {
	note := prose("p1-b2", 1, 0.9, 0.04, "1. A bottom note.")
	note.Label = "footnote"
	blocks := []PDFBlock{
		prose("p1-b1", 1, 0.62, 0.22, "正文在页尾还没有结束"),
		note,
		prose("p2-b1", 2, 0.11, 0.18, "所以下一页接着写完。"),
	}
	joined := joinCrossPageParagraphs(blocks)
	if len(joined) != 2 || joined[0].Text != "正文在页尾还没有结束所以下一页接着写完。" {
		t.Fatalf("footnote join: %+v", joined)
	}
}

func TestJoinCrossPageParagraphChainsPages(t *testing.T) {
	blocks := []PDFBlock{
		prose("p1-b1", 1, 0.7, 0.18, "第一页没有写完"),
		prose("p2-b1", 2, 0.1, 0.78, "第二页也没有写完"),
		prose("p3-b1", 3, 0.1, 0.2, "第三页才结束。"),
	}
	joined := joinCrossPageParagraphs(blocks)
	if len(joined) != 1 || len(joined[0].Fragments) != 3 {
		t.Fatalf("chain: %+v", joined)
	}
	if joined[0].Text != "第一页没有写完第二页也没有写完第三页才结束。" {
		t.Fatalf("chain text: %q", joined[0].Text)
	}
}

func TestJoinCrossPageParagraphRequiresAdjacentPages(t *testing.T) {
	blocks := []PDFBlock{
		prose("p1-b1", 1, 0.7, 0.18, "This sentence stops before a missing page"),
		prose("p3-b1", 3, 0.1, 0.2, "and should not attach here."),
	}
	if len(joinCrossPageParagraphs(blocks)) != 2 {
		t.Fatal("joined across a missing page")
	}
}

func TestJoinCrossPageParagraphRejectsDifferentColumns(t *testing.T) {
	wide := prose("p1-b1", 1, 0.7, 0.18, "A full-width paragraph continues")
	narrow := prose("p2-b1", 2, 0.1, 0.2, "into a narrow column.")
	narrow.Bounds.Width = 0.3
	if len(joinCrossPageParagraphs([]PDFBlock{wide, narrow})) != 2 {
		t.Fatal("joined different column widths")
	}
}
