package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

// exitError carries the process exit status: 1 for failures, 2 for usage
// mistakes and 3 when Reader is not running.
type exitError struct {
	code    int
	message string
}

func (e exitError) Error() string { return e.message }
func usageError(format string, args ...any) error {
	return exitError{2, fmt.Sprintf(format, args...)}
}

var errNotRunning = exitError{3, "Reader 没有运行。请先打开 Reader 桌面版，再运行此命令。"}

type discovery struct {
	URL     string `json:"url"`
	Token   string `json:"token"`
	Version string `json:"version"`
}

// libraryDir is the desktop app's library unless --data or READER_DATA names
// another one, such as the `.reader` directory used by `pnpm dev`.
func libraryDir(flagValue string) (string, error) {
	if flagValue != "" {
		return filepath.Abs(flagValue)
	}
	if env := os.Getenv("READER_DATA"); env != "" {
		return filepath.Abs(env)
	}
	config, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(config, "Reader", "library"), nil
}

type client struct {
	base    string
	token   string
	version string
	library string
	http    *http.Client
}

func connect(dataFlag string) (*client, error) {
	dir, err := libraryDir(dataFlag)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(dir, "server.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, errNotRunning
	}
	if err != nil {
		return nil, fmt.Errorf("无法读取 %s：%w", filepath.Join(dir, "server.json"), err)
	}
	var d discovery
	if err = json.Unmarshal(data, &d); err != nil || d.URL == "" || d.Token == "" {
		return nil, errors.New("Reader 的连接信息无效，请重新启动 Reader")
	}
	u, err := url.Parse(d.URL)
	if err != nil || u.Scheme != "http" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost") {
		// The token must never leave this machine.
		return nil, errors.New("Reader 的连接地址不是本机地址，已拒绝连接")
	}
	return &client{base: d.URL, token: d.Token, version: d.Version, library: dir, http: &http.Client{Timeout: 5 * time.Minute}}, nil
}

type apiError struct {
	Status int
	Body   map[string]any
}

func (e apiError) Error() string {
	if message, ok := e.Body["error"].(string); ok && message != "" {
		return message
	}
	return fmt.Sprintf("Reader 返回了 HTTP %d", e.Status)
}

func (c *client) do(method, path string, body io.Reader, contentType string, out any) (int, error) {
	req, err := http.NewRequest(method, c.base+path, body)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	res, err := c.http.Do(req)
	if err != nil {
		// A stale discovery file from a crash points at a closed port.
		return 0, errNotRunning
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 256<<20))
	if err != nil {
		return res.StatusCode, err
	}
	if res.StatusCode >= 400 {
		e := apiError{Status: res.StatusCode, Body: map[string]any{}}
		_ = json.Unmarshal(data, &e.Body)
		if res.StatusCode == 401 {
			return res.StatusCode, exitError{3, "Reader 的连接信息已过期，请重新启动 Reader"}
		}
		return res.StatusCode, e
	}
	if out != nil {
		if err = json.Unmarshal(data, out); err != nil {
			return res.StatusCode, fmt.Errorf("无法解析 Reader 的响应：%w", err)
		}
	}
	return res.StatusCode, nil
}

func (c *client) get(path string, query url.Values, out any) error {
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	_, err := c.do("GET", path, nil, "", out)
	return err
}

// upload sends one file the way the desktop import does.
func (c *client) upload(path, library string, allowLarge bool, out any) (int, error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	_ = form.WriteField("library", library)
	if allowLarge {
		_ = form.WriteField("allowLarge", "1")
	}
	part, err := form.CreateFormFile("file", filepath.Base(path))
	if err != nil {
		return 0, err
	}
	if _, err = io.Copy(part, file); err != nil {
		return 0, err
	}
	if err = form.Close(); err != nil {
		return 0, err
	}
	return c.do("POST", "/api/documents", &body, form.FormDataContentType(), out)
}
