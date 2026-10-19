package reader

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
	"unicode/utf8"
)

const defaultDocumentContextTokens = 65536

// A conservative estimate of consumed text, not billable usage. Window capacity
// is obtained separately from provider metadata or effective Codex config.
func estimateDocumentTokens(text string) int {
	ascii, other := 0, 0
	for _, r := range text {
		if r < 128 {
			ascii++
		} else {
			other++
		}
	}
	return (ascii+2)/3 + other
}
func (s *Server) documentContextOverride() int {
	var body string
	var settings struct {
		DocumentContextTokens int `json:"documentContextTokens"`
	}
	if s.Store.DB.QueryRow("SELECT value FROM settings WHERE key='reader'").Scan(&body) == nil {
		_ = json.Unmarshal([]byte(body), &settings)
	}
	if settings.DocumentContextTokens < 8192 || settings.DocumentContextTokens > 1048576 {
		return 0
	}
	return settings.DocumentContextTokens
}

// Reserve one quarter for instructions, previous conversation, tool envelopes,
// and output. Callers subtract their actual prompt/overview estimate as well.
func documentSourceBudget(contextTokens int) int { return contextTokens * 3 / 4 }
func validOverviewText(text string, maxRunes int) bool {
	return utf8.ValidString(text) && utf8.RuneCountInString(text) <= maxRunes
}

func validContextWindow(n int) int {
	if n >= 1024 && n <= 32<<20 {
		return n
	}
	return 0
}
func resolveDocumentContext(reported, override int, source string) (int, string) {
	reported = validContextWindow(reported)
	if reported > 0 {
		if override > 0 && override < reported {
			return override, "manual_cap+" + source
		}
		return reported, source
	}
	if override > 0 {
		return override, "manual"
	}
	return defaultDocumentContextTokens, "fallback_estimate"
}
func codexConfiguredWindow(raw []byte) int {
	var v struct {
		Config struct {
			Window int `json:"model_context_window"`
		} `json:"config"`
	}
	if json.Unmarshal(raw, &v) != nil {
		return 0
	}
	return validContextWindow(v.Config.Window)
}
func (s *Server) overviewContextWindow(ctx context.Context) (int, string) {
	config := s.aiConfig()
	window, source := 0, ""
	child, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	switch config.Primary {
	case "api":
		req, err := s.apiAgentAdapter(config, taskChat).resolve(child, false)
		if err == nil {
			window, source = req.ContextWindow, "api_models"
		}
	case "codex":
		work, err := os.MkdirTemp(filepath.Join(s.Store.Root, "ai-work"), "overview-config-")
		if err == nil {
			defer os.RemoveAll(work)
			session, e := newCodexSession(work, config.Models["codex"])
			if e == nil {
				defer session.close()
				if session.initializeControl(child) == nil {
					raw, e := session.control(child, "config/read", map[string]any{"includeLayers": false, "cwd": work})
					if e == nil {
						window, source = codexConfiguredWindow(raw), "codex_config"
					}
				}
			}
		}
	}
	return resolveDocumentContext(window, s.documentContextOverride(), source)
}
