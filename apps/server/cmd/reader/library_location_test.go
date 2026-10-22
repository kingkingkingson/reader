package main

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestDesktopLibraryLocation(t *testing.T) {
	config := t.TempDir()
	got, err := desktopLibraryDir(config)
	if err != nil || got != filepath.Join(config, "library") {
		t.Fatal(got, err)
	}
	target := filepath.Join(t.TempDir(), "moved")
	data := []byte(`{"directory":` + strconv.Quote(target) + `}`)
	if err := os.WriteFile(filepath.Join(config, "library-location.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	got, err = desktopLibraryDir(config)
	if err != nil || got != target {
		t.Fatal(got, err)
	}
	for _, data := range []string{`bad json`, `{}`, `{"directory":"relative"}`} {
		if err := os.WriteFile(filepath.Join(config, "library-location.json"), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := desktopLibraryDir(config); err == nil {
			t.Fatal("accepted bad config")
		}
	}
}

func TestLibraryLocationExplicitOverrides(t *testing.T) {
	custom := t.TempDir()
	explicit := t.TempDir()
	t.Setenv("READER_DATA", custom)
	got, err := libraryDir("")
	if err != nil || got != custom {
		t.Fatal(got, err)
	}
	got, err = libraryDir(explicit)
	if err != nil || got != explicit {
		t.Fatal(got, err)
	}
}
