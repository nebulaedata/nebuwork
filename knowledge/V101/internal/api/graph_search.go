package api

import (
	"context"
	"fmt"

	"nebulaekno/internal/ai"
)

// Coverage follows the same document and source filters as graph retrieval.
// Saved, synced evidence is usable even while another chunk is still failing.
type GraphSearchCoverage struct {
	Documents          int  `json:"documents"`
	CompletedDocuments int  `json:"completed_documents"`
	IndexedDocuments   int  `json:"indexed_documents"`
	EvidenceRecords    int  `json:"evidence_records"`
	SyncedRecords      int  `json:"synced_records"`
	PendingSyncRecords int  `json:"pending_sync_records"`
	Partial            bool `json:"partial"`
}

func (c GraphSearchCoverage) ready() error {
	if c.SyncedRecords > 0 || c.CompletedDocuments > 0 {
		return nil
	}
	message := "所选范围尚无可检索的图谱内容；成功分块同步后即可查询，无需等待全部完成"
	if c.PendingSyncRecords > 0 {
		message = "图谱证据已保存，但尚未同步到图数据库；同步完成的部分即可查询，无需等待全部分块完成"
	}
	return &ai.Error{Code: "INDEX_NOT_READY", Message: message}
}

func (c GraphSearchCoverage) warning() map[string]string {
	if !c.Partial {
		return nil
	}
	message := fmt.Sprintf("图谱尚未全部完成，当前检索已同步的内容，结果可能不完整。范围内 %d 篇文档，%d 篇图谱阶段已完成，%d 篇已有同步证据", c.Documents, c.CompletedDocuments, c.IndexedDocuments)
	if c.PendingSyncRecords > 0 {
		message += fmt.Sprintf("；另有 %d 条证据待同步", c.PendingSyncRecords)
	}
	return map[string]string{"channel": "graph", "code": "GRAPH_PARTIAL_COVERAGE", "message": message}
}

func (s *Server) graphSearchCoverage(ctx context.Context, in SearchInput) (*GraphSearchCoverage, error) {
	documents, _ := knowledgeFilterSQL(in)
	where, args := filterSQL(in)
	if len(in.Filters.Origins) > 0 || in.Filters.TimeStart != nil || in.Filters.TimeEnd != nil {
		documents += " AND EXISTS(SELECT 1 FROM chunks c JOIN source_refs s ON s.id=c.source_ref_id WHERE c.knowledge_id=k.id AND " + where + ")"
	}
	query := `WITH documents AS (
 SELECT k.id,coalesce((SELECT t.checkpoint->>'graph' FROM tasks t
 WHERE t.knowledge_id=k.id AND t.checkpoint->>'parse_version_id'=k.current_parse_version_id::text AND t.checkpoint ? 'graph'
 ORDER BY t.created_at DESC,t.id DESC LIMIT 1),'pending') AS graph_state
 FROM knowledge k WHERE ` + documents + `
), evidence AS (
 SELECT DISTINCT g.id,g.knowledge_id,g.synced_at FROM graph_records g
 JOIN chunks c ON c.source_ref_id=g.source_ref_id AND c.knowledge_id=g.knowledge_id
 JOIN source_refs s ON s.id=c.source_ref_id JOIN knowledge k ON k.id=c.knowledge_id
 WHERE ` + where + `
)
 SELECT (SELECT count(*) FROM documents),
 (SELECT count(*) FROM documents WHERE graph_state='succeeded'),
 count(DISTINCT knowledge_id) FILTER(WHERE synced_at IS NOT NULL),count(*),
 count(*) FILTER(WHERE synced_at IS NOT NULL),count(*) FILTER(WHERE synced_at IS NULL) FROM evidence`
	coverage := &GraphSearchCoverage{}
	err := s.Services.DB.QueryRow(ctx, query, args...).Scan(&coverage.Documents, &coverage.CompletedDocuments,
		&coverage.IndexedDocuments, &coverage.EvidenceRecords, &coverage.SyncedRecords, &coverage.PendingSyncRecords)
	if err != nil {
		return nil, err
	}
	coverage.Partial = coverage.CompletedDocuments < coverage.Documents || coverage.PendingSyncRecords > 0
	return coverage, nil
}
