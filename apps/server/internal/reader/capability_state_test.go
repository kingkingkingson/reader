package reader

import (
	"context"
	"errors"
	"testing"
)

func TestRuntimeFailurePreservesVerifiedCapability(t *testing.T) {
	for _, mode := range []string{"text", "vision", "canceled", "consumer", "new-model", "new-check", "fallback", "timeout", "network", "authentication", "model"} {
		t.Run(mode, func(t *testing.T) {
			store, err := OpenStore(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			defer store.DB.Close()
			s := NewServer(store, "test", "")
			c := AIConfig{Primary: "codex", Models: map[string]string{"codex": "model-a"}, Capabilities: map[string]Capability{}}
			c.Capabilities["codex"] = Capability{Text: true, Vision: true, CheckedAt: "initial", Fingerprint: configPrint(c, "codex")}
			if err := s.writeAIConfig(c); err != nil {
				t.Fatal(err)
			}
			g := s.generationService(c)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			connection := g.connections["codex"]
			connection.Adapter = adapterFunc(func(_ context.Context, _ GenerateRequest, emit func(ProviderEvent) error) (GenerateResult, error) {
				if mode == "canceled" {
					cancel()
				}
				if mode == "consumer" {
					_ = emit(ProviderEvent{Text: "partial"})
				}
				if mode == "new-model" || mode == "new-check" {
					latest := s.aiConfig()
					if mode == "new-model" {
						latest.Models["codex"] = "model-b"
					} else {
						cap := latest.Capabilities["codex"]
						cap.CheckedAt = "newer"
						latest.Capabilities["codex"] = cap
					}
					if err := s.writeAIConfig(latest); err != nil {
						t.Fatal(err)
					}
				}
				switch mode {
				case "timeout":
					return GenerateResult{}, context.DeadlineExceeded
				case "network":
					return GenerateResult{}, generationError(ErrorNetwork, "connection reset")
				case "authentication":
					return GenerateResult{}, generationError(ErrorAuthentication, "expired login")
				case "model":
					return GenerateResult{}, generationError(ErrorModel, "model unavailable")
				}
				return GenerateResult{}, errors.New("provider unavailable")
			})
			g.connections["codex"] = connection
			if mode == "fallback" {
				g.connections["text-api"] = generationConnection{VerifiedText: true, Adapter: adapterFunc(func(_ context.Context, _ GenerateRequest, emit func(ProviderEvent) error) (GenerateResult, error) {
					_ = emit(ProviderEvent{Text: "backup"})
					return GenerateResult{Text: "backup", FinishReason: "stop"}, nil
				})}
			}
			input := AIInput{Prompt: "test"}
			if mode == "vision" || mode == "timeout" {
				input.Image = []byte{1}
			}
			_, err = g.Generate(ctx, input, true, func(ProviderEvent) error {
				if mode == "consumer" {
					return errors.New("client disconnected")
				}
				return nil
			})
			if mode == "fallback" && err != nil {
				t.Fatal(err)
			}
			saved := NewServer(store, "test", "").aiConfig().Capabilities["codex"]

			if !saved.Text || !saved.Vision || saved.Error != "" {
				t.Fatalf("runtime failure revoked verified capability: %+v", saved)
			}
			if mode == "vision" || mode == "timeout" {
				next := s.generationService(s.aiConfig())
				connection := next.connections["codex"]
				connection.Adapter = adapterFunc(func(_ context.Context, _ GenerateRequest, emit func(ProviderEvent) error) (GenerateResult, error) {
					_ = emit(ProviderEvent{Text: "$$x=1$$"})
					return GenerateResult{Text: "$$x=1$$", FinishReason: "stop"}, nil
				})
				next.connections["codex"] = connection
				if _, err := next.Generate(t.Context(), input, false, nil); err != nil {
					t.Fatalf("next formula blocked after a runtime error: %v", err)
				}
			}
		})
	}
}
