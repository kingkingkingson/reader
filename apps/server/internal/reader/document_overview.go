package reader

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

const overviewVersion = "overview-v1"

type overviewPoint struct {
	Text     string   `json:"text"`
	BlockIDs []string `json:"blockIds"`
}
type overviewContent struct {
	Summary     string          `json:"summary"`
	Findings    []overviewPoint `json:"findings"`
	Limitations []overviewPoint `json:"limitations"`
	Terms       []string        `json:"terms"`
}
type overviewSection struct {
	Key          string          `json:"key"`
	Title        string          `json:"title"`
	FirstBlockID string          `json:"firstBlockId"`
	LastBlockID  string          `json:"lastBlockId"`
	Location     json.RawMessage `json:"location"`
	PassageCount int             `json:"passageCount"`
	Content      overviewContent `json:"content"`
}
type overviewSource struct {
	BlockID  string          `json:"blockId"`
	Label    string          `json:"label"`
	Location json.RawMessage `json:"location"`
}
type documentOverview struct {
	Stale            bool              `json:"stale"`
	Sources          []overviewSource  `json:"sources,omitempty"`
	DocumentID       string            `json:"documentId"`
	Revision         string            `json:"corpusRevision"`
	Version          string            `json:"compilerVersion"`
	Status           string            `json:"status"`
	Content          *overviewContent  `json:"content,omitempty"`
	Sections         []overviewSection `json:"sections"`
	Coverage         corpusCoverage    `json:"coverage"`
	CompiledPassages int               `json:"compiledPassages"`
	TotalPassages    int               `json:"totalPassages"`
	UpdatedAt        string            `json:"updatedAt"`
	Error            string            `json:"error,omitempty"`
}
type overviewJob struct{ DocumentID, ID, Status, Error string }

func (s *Store) loadOverview(ctx context.Context, documentID string) (documentOverview, error) {
	o := documentOverview{DocumentID: documentID, Status: "missing", Sections: []overviewSection{}, Coverage: corpusCoverage{Missing: []string{}, Warnings: []string{}}}
	var body string
	err := s.DB.QueryRowContext(ctx, "SELECT body FROM document_overviews WHERE document_id=? AND json_type(body,'$.content')='object' UNION ALL SELECT body FROM document_overview_drafts WHERE document_id=? UNION ALL SELECT body FROM document_overviews WHERE document_id=? LIMIT 1", documentID, documentID, documentID).Scan(&body)
	if errors.Is(err, sql.ErrNoRows) {
		return o, nil
	}
	if err != nil {
		return o, err
	}
	err = json.Unmarshal([]byte(body), &o)
	return o, err
}
func (s *Server) currentOverview(ctx context.Context, c *documentCorpus) (*documentOverview, error) {
	o, err := s.Store.loadOverview(ctx, c.DocumentID)
	if err != nil {
		return nil, err
	}
	if o.Revision != c.Revision || o.Version != overviewVersion || o.Content == nil {
		return nil, nil
	}
	if o.Status != "complete" && o.Status != "partial" {
		return nil, nil
	}
	return &o, nil
}
func (s *Server) overviewState(ctx context.Context, documentID string) (documentOverview, error) {
	d, err := s.Store.Document(documentID)
	if err != nil || d.DeletedAt != "" {
		return documentOverview{}, sql.ErrNoRows
	}
	o, err := s.Store.loadOverview(ctx, documentID)
	if err != nil {
		return o, err
	}
	if o.Revision != "" {
		var revision, fingerprint, corpusBody string
		e := s.Store.DB.QueryRowContext(ctx, "SELECT revision,fingerprint,body FROM document_corpora WHERE document_id=?", documentID).Scan(&revision, &fingerprint, &corpusBody)
		current, fe := s.corpusFingerprint(d)
		if e != nil || fe != nil || o.Revision != revision || fingerprint != current || o.Version != overviewVersion {
			o.Status = "stale"
			o.Stale = true
		}
		if !o.Stale && o.Content != nil {
			wanted := map[string]bool{}
			for _, point := range append(append([]overviewPoint{}, o.Content.Findings...), o.Content.Limitations...) {
				for _, block := range point.BlockIDs {
					wanted[block] = true
				}
			}
			var c documentCorpus
			if json.Unmarshal([]byte(corpusBody), &c) == nil {
				for _, p := range c.Passages {
					if wanted[p.ID] {
						o.Sources = append(o.Sources, overviewSource{p.ID, p.Label, p.Location})
					}
				}
			}
		}
	}
	var draft string
	if e := s.Store.DB.QueryRowContext(ctx, "SELECT body FROM document_overview_drafts WHERE document_id=?", documentID).Scan(&draft); e == nil {
		var progress documentOverview
		if json.Unmarshal([]byte(draft), &progress) == nil {
			o.CompiledPassages, o.TotalPassages = progress.CompiledPassages, progress.TotalPassages
		}
	} else if !errors.Is(e, sql.ErrNoRows) {
		return o, e
	}
	var status, message string
	err = s.Store.DB.QueryRowContext(ctx, "SELECT status,error FROM document_overview_jobs WHERE document_id=?", documentID).Scan(&status, &message)
	if err == nil && status != "complete" {
		o.Status = status
		o.Error = message
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return o, err
	}
	return o, nil
}
func (s *Server) getDocumentOverview(w http.ResponseWriter, r *http.Request) {
	o, err := s.overviewState(r.Context(), r.PathValue("id"))
	if err != nil {
		fail(w, 404, "文档不可用")
		return
	}
	respond(w, 200, o)
}
func (s *Server) requestDocumentOverview(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Regenerate bool `json:"regenerate"`
	}
	if !decode(w, r, &request) {
		return
	}
	s.overviewMu.Lock()
	defer s.overviewMu.Unlock()
	o, err := s.overviewState(r.Context(), r.PathValue("id"))
	if err != nil {
		fail(w, 404, "文档不可用")
		return
	}
	if o.Status == "running" || o.Status == "queued" || (!request.Regenerate && o.Status == "complete") {
		respond(w, 200, o)
		return
	}
	// Replacing a job ID invalidates any late writer from a canceled attempt.
	tx, err := s.Store.DB.BeginTx(r.Context(), nil)
	if err != nil {
		fail(w, 500, "无法安排概要生成")
		return
	}
	defer tx.Rollback()
	jobID := id()
	if request.Regenerate {
		// Reset only the working draft. The published overview remains readable
		// through cancellation, upstream failures and later retries.
		_, err = tx.Exec("INSERT INTO document_overview_drafts(document_id,job_id,body) VALUES(?,?,'{}') ON CONFLICT(document_id) DO UPDATE SET job_id=excluded.job_id,body=excluded.body", o.DocumentID, jobID)
	} else {
		_, err = tx.Exec("UPDATE document_overview_drafts SET job_id=? WHERE document_id=?", jobID, o.DocumentID)
	}
	if err == nil {
		_, err = tx.Exec("INSERT INTO document_overview_jobs(document_id,job_id,status,error) VALUES(?,?,'queued','') ON CONFLICT(document_id) DO UPDATE SET job_id=excluded.job_id,status='queued',error=''", o.DocumentID, jobID)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		fail(w, 500, "无法安排概要生成")
		return
	}
	o, err = s.overviewState(r.Context(), o.DocumentID)
	if err != nil {
		fail(w, 500, "无法读取概要状态")
		return
	}
	respond(w, 202, o)
}
func (s *Server) cancelDocumentOverview(w http.ResponseWriter, r *http.Request) {
	documentID := r.PathValue("id")
	s.overviewMu.Lock()
	defer s.overviewMu.Unlock()
	_, err := s.Store.DB.ExecContext(r.Context(), "UPDATE document_overview_jobs SET status='canceled',error='' WHERE document_id=? AND status IN ('queued','running','waiting')", documentID)
	if err != nil {
		fail(w, 500, "无法取消概要生成")
		return
	}
	if cancel := s.overviewActive[documentID]; cancel != nil {
		cancel()
	}
	w.WriteHeader(204)
}

func (s *Store) saveOverview(ctx context.Context, job overviewJob, o documentOverview) error {
	o.UpdatedAt = now()
	body, err := json.Marshal(o)
	if err != nil {
		return err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var count int
	err = tx.QueryRowContext(ctx, `SELECT count(*) FROM document_overview_jobs j JOIN documents d ON d.id=j.document_id JOIN document_corpora c ON c.document_id=d.id WHERE j.document_id=? AND j.job_id=? AND j.status='running' AND d.deleted_at='' AND c.revision=?`, o.DocumentID, job.ID, o.Revision).Scan(&count)
	if err != nil {
		return err
	}
	if count != 1 {
		return generationError(ErrorCanceled, "概要任务或原文版本已改变")
	}
	if o.Content == nil {
		if _, err = tx.ExecContext(ctx, "INSERT INTO document_overview_drafts(document_id,job_id,body) VALUES(?,?,?) ON CONFLICT(document_id) DO UPDATE SET job_id=excluded.job_id,body=excluded.body", o.DocumentID, job.ID, string(body)); err != nil {
			return err
		}
		return tx.Commit()
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM document_overview_drafts WHERE document_id=?", o.DocumentID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO document_overviews(document_id,body) VALUES(?,?) ON CONFLICT(document_id) DO UPDATE SET body=excluded.body", o.DocumentID, string(body)); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM document_overviews_fts WHERE document_id=?", o.DocumentID); err != nil {
		return err
	}
	if o.Content != nil {
		text := o.Content.Summary + "\n" + strings.Join(o.Content.Terms, " ")
		if _, err = tx.ExecContext(ctx, "INSERT INTO document_overviews_fts(document_id,revision,content) VALUES(?,?,?)", o.DocumentID, o.Revision, text); err != nil {
			return err
		}
	}
	return tx.Commit()
}

type overviewExecutor interface {
	Exec(string, ...any) (sql.Result, error)
}

func queueImportedOverview(db overviewExecutor, documentID, settings string) error {
	var prefs struct {
		Enabled bool `json:"autoGenerateOverview"`
	}
	if json.Unmarshal([]byte(settings), &prefs) != nil || !prefs.Enabled {
		return nil
	}
	_, err := db.Exec("INSERT OR IGNORE INTO document_overview_jobs(document_id,job_id,status,error) VALUES(?,?,'queued','')", documentID, id())
	return err
}
func (s *Server) listOverviewStatuses(w http.ResponseWriter, r *http.Request) {
	rows, err := s.Store.DB.QueryContext(r.Context(), `SELECT j.document_id,j.status,j.error,COALESCE(draft.body,o.body,'') FROM document_overview_jobs j JOIN documents d ON d.id=j.document_id LEFT JOIN document_overviews o ON o.document_id=j.document_id LEFT JOIN document_overview_drafts draft ON draft.document_id=j.document_id WHERE d.deleted_at=''`)
	if err != nil {
		fail(w, 500, "无法读取概要任务")
		return
	}
	defer rows.Close()
	result := []any{}
	for rows.Next() {
		var doc, status, message, body string
		if err = rows.Scan(&doc, &status, &message, &body); err != nil {
			fail(w, 500, "无法读取概要任务")
			return
		}
		var o documentOverview
		_ = json.Unmarshal([]byte(body), &o)
		result = append(result, map[string]any{"documentId": doc, "status": status, "error": message, "compiledPassages": o.CompiledPassages, "totalPassages": o.TotalPassages})
	}
	if rows.Err() != nil {
		fail(w, 500, "无法读取概要任务")
		return
	}
	respond(w, 200, result)
}
