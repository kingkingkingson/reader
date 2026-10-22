package reader

import (
	"encoding/json"
	"testing"
)

func TestCodexFeatureEnabledAcceptsBoolAndTable(t *testing.T) {
	for _, tc := range []struct {
		raw         string
		enabled, ok bool
	}{
		{"", false, true},
		{"null", false, true},
		{"false", false, true},
		{"true", true, true},
		{`{"enabled":false}`, false, true},
		{`{"enabled":true,"extra":1}`, true, true},
		{`{}`, false, false},
		{`{"enabled":"yes"}`, false, false},
		{`"on"`, false, false},
	} {
		enabled, ok := codexFeatureEnabled(json.RawMessage(tc.raw))
		if enabled != tc.enabled || ok != tc.ok {
			t.Errorf("%q: got (%v, %v), want (%v, %v)", tc.raw, enabled, ok, tc.enabled, tc.ok)
		}
	}
}
