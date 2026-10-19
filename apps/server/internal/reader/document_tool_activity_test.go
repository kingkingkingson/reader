package reader

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDocumentToolActivitiesDescribeTargets(t *testing.T) {
	_, a := originalDocumentFixture(t)
	var notices []string
	a.activity = func(phase, tool, message string) error {
		if phase != "reading" || tool == "" {
			t.Error("missing tool identity")
		}
		notices = append(notices, message)
		return nil
	}
	for _, call := range []struct{ tool, args string }{
		{"get_outline", `{}`},
		{"search_document", `{"query":"cobalt\n\u202Eprotocol"}`},
		{"read_passage", jsonText(map[string]string{"blockId": a.corpus.Passages[1].ID})},
	} {
		if _, err := a.call(t.Context(), call.tool, json.RawMessage(call.args)); err != nil {
			t.Fatal(err)
		}
	}
	if len(notices) != 3 || !strings.Contains(notices[0], "定位相关章节") || !strings.Contains(notices[1], "cobalt protocol") || strings.ContainsAny(notices[1], "\n\u202E") || !strings.Contains(notices[2], "Definition") {
		t.Fatalf("activity does not describe the original target: %v", notices)
	}
	// A PDF target reports its original page, not an opaque passage ID.
	s, _, _ := bookFixture(t)
	corpus, err := s.documentCorpus(t.Context(), "doc", nil)
	if err != nil {
		t.Fatal(err)
	}
	b := &documentAgent{server: s, corpus: corpus, ctx: t.Context(), ID: id(), activity: a.activity}
	if _, err = b.call(t.Context(), "read_passage", json.RawMessage(jsonText(map[string]string{"blockId": corpus.Passages[0].ID}))); err != nil || !strings.Contains(notices[len(notices)-1], "第 1 页") {
		t.Fatal("PDF activity lost its page", err, notices)
	}
}
