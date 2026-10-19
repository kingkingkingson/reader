package reader

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type documentCodexEntry struct {
	document, key string
	active        bool
	session       *codexSession
	binding       *documentToolBinding
	stopMCP       func()
	timer         *time.Timer
}
type documentCodexCache struct {
	mu     sync.Mutex
	entry  *documentCodexEntry
	closed bool
}

func (c *documentCodexCache) discardLocked() {
	if c.entry != nil {
		e := c.entry
		c.entry = nil
		if e.timer != nil {
			e.timer.Stop()
		}
		e.binding.bind(nil)
		e.session.close()
		e.stopMCP()
	}
}
func (c *documentCodexCache) close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
	c.discardLocked()
}
func (c *documentCodexCache) deleteDocument(doc string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entry != nil && c.entry.document == doc {
		c.discardLocked()
	}
}
func (c *documentCodexCache) release(entry *documentCodexEntry, healthy bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entry != entry {
		return
	}
	entry.active = false
	entry.binding.bind(nil)
	if !healthy {
		c.discardLocked()
		return
	}
	entry.timer = time.AfterFunc(10*time.Minute, func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.entry == entry && !entry.active {
			c.discardLocked()
		}
	})
}
func (c *documentCodexCache) acquire(ctx context.Context, a *documentAgent, root, model string) (*documentCodexEntry, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil, generationError(ErrorCanceled, "服务已关闭")
	}
	state := a.conversation
	key := state.ID + "\x00" + model
	if c.entry != nil && c.entry.key != key {
		c.discardLocked()
	}
	if c.entry != nil {
		if c.entry.timer != nil {
			c.entry.timer.Stop()
		}
		c.entry.active = true
		c.entry.binding.bind(a)
		return c.entry, nil
	}
	work := filepath.Join(root, "ai-work", "conversation-"+state.ID)
	if err := os.MkdirAll(work, 0700); err != nil {
		return nil, err
	}
	binding := &documentToolBinding{agent: a, attempt: a.ID}
	url, token, closeMCP, err := serveBoundDocumentMCP(binding)
	if err != nil {
		return nil, err
	}
	session, err := isolatedDocumentCodex(ctx, work, model, url, token)
	if err != nil {
		closeMCP()
		return nil, err
	}
	session.persistent = true
	session.finalMessagesOnly = true
	session.baseInstructions = documentReadingInstructions
	if state.NativeThread != "" {
		if err = session.resumeDocument(ctx, state.NativeThread); err != nil {
			session.close()
			closeMCP()
			return nil, err
		}
		session.total = state.NativeUsage
	}
	e := &documentCodexEntry{document: a.corpus.DocumentID, key: key, active: true, session: session, binding: binding, stopMCP: closeMCP}
	c.entry = e
	return e, nil
}
func (s *codexSession) resumeDocument(ctx context.Context, threadID string) error {
	params := map[string]any{"threadId": threadID, "excludeTurns": true, "cwd": s.work, "approvalPolicy": "never", "sandbox": "read-only", "baseInstructions": documentReadingInstructions}
	if s.model != "" {
		params["model"] = s.model
	}
	// Re-bind the same owned tools after a process restart; do not resume old MCP URLs.
	params["config"] = s.configOverrides
	raw, err := s.control(ctx, "thread/resume", params)
	if err != nil {
		return generationError(ErrorProtocol, "无法恢复 Codex 阅读会话，历史已保留，请重试")
	}
	var result struct {
		Model  string `json:"model"`
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	if json.Unmarshal(raw, &result) != nil || result.Thread.ID != threadID {
		return generationError(ErrorProtocol, "Codex 恢复了不匹配的会话")
	}
	s.threadID = threadID
	s.actualModel = result.Model
	if _, err = s.verifyDocumentConfig(ctx); err != nil {
		return err
	}
	raw, err = s.control(ctx, "mcpServerStatus/list", map[string]any{"threadId": threadID, "limit": 100, "detail": "toolsAndAuthOnly"})
	if err != nil || !validDocumentMCPStatus(raw, s.documentMCPName) {
		return generationError(ErrorCapability, "恢复后的文档工具范围无效")
	}
	return nil
}
func (s *codexSession) revertPending(ctx context.Context, c *documentConversation) error {
	if !c.NativeDirty || c.NativeThread == "" {
		return nil
	}
	pending := c.NativePending
	if pending == "" {
		raw, err := s.control(ctx, "thread/turns/list", map[string]any{"threadId": c.NativeThread, "limit": 1, "sortDirection": "desc"})
		if err != nil {
			return generationError(ErrorProtocol, "无法核对中断的 Codex 会话，未丢弃历史")
		}
		var result struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if json.Unmarshal(raw, &result) != nil {
			return generationError(ErrorProtocol, "Codex 会话进度无效")
		}
		if len(result.Data) > 0 && result.Data[0].ID != c.NativeCommitted {
			pending = result.Data[0].ID
		}
	}
	if pending != "" {
		if _, err := s.control(ctx, "thread/revert", map[string]any{"threadId": c.NativeThread, "beforeTurnId": pending}); err != nil {
			return generationError(ErrorProtocol, "无法恢复到上次已保存的回答，历史已保留")
		}
	}
	c.NativeDirty = false
	c.NativePending = ""
	return nil
}
