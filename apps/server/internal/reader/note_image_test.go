package reader

import (
	"bytes"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestNoteImageRoundTrip(t *testing.T) {
	s := testServer(t)
	doc := organizationDoc(t, s)
	png := []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
		0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54,
		0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05,
		0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4,
		0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
		0xae, 0x42, 0x60, 0x82,
	}
	saved := request(t, s, "POST", "/api/documents/"+doc.ID+"/note-images", bytes.NewReader(png))
	if saved.Code != 201 {
		t.Fatal(saved.Code, saved.Body.String())
	}
	var body struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(saved.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !noteImageName.MatchString(body.ID) {
		t.Fatal(body.ID)
	}
	got := request(t, s, "GET", "/api/documents/"+doc.ID+"/note-images/"+body.ID, nil)
	if got.Code != 200 || got.Header().Get("Content-Type") != "image/png" || !bytes.Equal(got.Body.Bytes(), png) {
		t.Fatal(got.Code, got.Header().Get("Content-Type"), got.Body.Len())
	}
	stored := filepath.Join(s.Store.Root, "cache", doc.ID, "note-images", body.ID)
	if _, err := os.Stat(stored); err != nil {
		t.Fatal(err)
	}
	rejected := request(t, s, "POST", "/api/documents/"+doc.ID+"/note-images", bytes.NewReader([]byte("not-an-image")))
	if rejected.Code != 400 {
		t.Fatal(rejected.Code, rejected.Body.String())
	}
	missing := request(t, s, "GET", "/api/documents/"+doc.ID+"/note-images/not-an-image.png", nil)
	if missing.Code != 404 {
		t.Fatal(missing.Code, missing.Body.String())
	}
	traversal := request(t, s, "GET", "/api/documents/"+doc.ID+"/note-images/"+url.PathEscape("../secret.png"), nil)
	if traversal.Code != 404 {
		t.Fatal(traversal.Code, traversal.Body.String())
	}
	unknown := request(t, s, "POST", "/api/documents/missing/note-images", bytes.NewReader(png))
	if unknown.Code != 404 {
		t.Fatal(unknown.Code, unknown.Body.String())
	}
}
