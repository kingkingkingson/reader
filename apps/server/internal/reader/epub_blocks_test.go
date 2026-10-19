package reader

import (
	"testing"

	"golang.org/x/net/html"
)

func TestEPUBHeadingLevelFollowsTheSourceTag(t *testing.T) {
	_, blocks, err := parseEPUBChapter("a.xhtml", `<html><body><h1>One</h1><h2>1.1 Two</h2><p>Body</p></body></html>`, func(EPUBReadingBlock, []*html.Node) {})
	if err != nil {
		t.Fatal(err)
	}
	if len(blocks) != 3 {
		t.Fatalf("blocks: %+v", blocks)
	}
	if blocks[0].Label != "paragraph_title" || blocks[0].Level != 1 || blocks[0].Text != "One" {
		t.Fatalf("h1: %+v", blocks[0])
	}
	if blocks[1].Label != "paragraph_title" || blocks[1].Level != 2 || blocks[1].Text != "1.1 Two" {
		t.Fatalf("h2: %+v", blocks[1])
	}
	if blocks[2].Label != "text" || blocks[2].Level != 0 || blocks[2].Text != "Body" {
		t.Fatalf("p: %+v", blocks[2])
	}
}
