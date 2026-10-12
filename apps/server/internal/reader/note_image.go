package reader

import (
	"bytes"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
)

const noteImageLimit = 8 << 20

var noteImageName = regexp.MustCompile(`^[0-9a-f]{32}\.(?:png|jpe?g|gif|webp)$`)

func noteImageType(data []byte) (ext, contentType string, ok bool) {
	switch {
	case len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}):
		return ".png", "image/png", true
	case len(data) >= 3 && bytes.Equal(data[:3], []byte{0xff, 0xd8, 0xff}):
		return ".jpg", "image/jpeg", true
	case len(data) >= 6 && (bytes.Equal(data[:6], []byte("GIF87a")) || bytes.Equal(data[:6], []byte("GIF89a"))):
		return ".gif", "image/gif", true
	case len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")):
		return ".webp", "image/webp", true
	default:
		return "", "", false
	}
}

func (s *Server) noteImageDir(documentID string) string {
	return filepath.Join(s.Store.Root, "cache", documentID, "note-images")
}

func (s *Server) saveNoteImage(w http.ResponseWriter, r *http.Request) {
	if _, err := s.Store.Document(r.PathValue("id")); err != nil {
		fail(w, 404, "文档不存在")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, noteImageLimit+1)
	data, err := io.ReadAll(r.Body)
	if err != nil || len(data) > noteImageLimit {
		fail(w, 400, "图片不能超过 8MB")
		return
	}
	ext, _, ok := noteImageType(data)
	if !ok {
		fail(w, 400, "只接受 PNG、JPEG、GIF 或 WebP 图片")
		return
	}
	dir := s.noteImageDir(r.PathValue("id"))
	if err = os.MkdirAll(dir, 0700); err != nil {
		fail(w, 500, "无法保存图片")
		return
	}
	name := id() + ext
	if err = os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
		fail(w, 500, "无法保存图片")
		return
	}
	respond(w, 201, map[string]string{"id": name})
}

func (s *Server) getNoteImage(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !noteImageName.MatchString(name) {
		fail(w, 404, "图片不存在")
		return
	}
	if _, err := s.Store.Document(r.PathValue("id")); err != nil {
		fail(w, 404, "文档不存在")
		return
	}
	path := filepath.Join(s.noteImageDir(r.PathValue("id")), name)
	_, contentType, ok := noteImageType(mustReadPrefix(path))
	if !ok {
		fail(w, 404, "图片不存在")
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeFile(w, r, path)
}

func mustReadPrefix(path string) []byte {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	buf := make([]byte, 12)
	n, _ := f.Read(buf)
	return buf[:n]
}
