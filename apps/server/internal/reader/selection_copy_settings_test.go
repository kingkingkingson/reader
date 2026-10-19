package reader

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSelectionAutoCopySettingPersistsBothStates(t *testing.T) {
	s := testServer(t)
	s.Token = "test-secret"
	for _, enabled := range []bool{true, false} {
		body, _ := json.Marshal(map[string]any{"autoCopySelection": enabled, "appearance": "dark"})
		if w := request(t, s, "PUT", "/api/settings", strings.NewReader(string(body))); w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		// Verify persisted storage, as well as the settings response used on startup.
		var stored string
		if err := s.Store.DB.QueryRow("SELECT value FROM settings WHERE key='reader'").Scan(&stored); err != nil {
			t.Fatal(err)
		}
		response := request(t, s, "GET", "/api/settings", nil)
		for _, data := range []string{stored, response.Body.String()} {
			var saved map[string]any
			if err := json.Unmarshal([]byte(data), &saved); err != nil || saved["autoCopySelection"] != enabled || saved["appearance"] != "dark" {
				t.Fatalf("selection copy setting not retained: %s", data)
			}
		}
	}
}
