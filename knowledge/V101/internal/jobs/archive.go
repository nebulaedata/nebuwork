package jobs

import (
	"context"
	"fmt"
	"io"
	"nebulaekno/internal/ai"
	"nebulaekno/internal/ingest"

	"github.com/jackc/pgx/v5"
)

func (w *Worker) extractArchive(ctx context.Context, t *Task) error {
	if err := w.stage(ctx, t, "extract_archive", "running"); err != nil {
		return err
	}
	var root ingest.ArchiveFile
	err := w.Services.DB.QueryRow(ctx, `SELECT k.id::text,f.id::text,f.path,k.relative_path FROM knowledge k JOIN file_versions f ON f.id=k.current_file_version_id WHERE k.id=$1`, t.KnowledgeID).Scan(&root.ID, &root.VersionID, &root.Path, &root.RelativePath)
	if err != nil {
		return err
	}
	store := ingest.Store{Services: w.Services, Config: w.Config}
	x := ingest.Extractor{
		Config: w.Config,
		Store: func(ctx context.Context, entry ingest.ArchiveEntry, r io.Reader) (ingest.ArchiveFile, error) {
			result, err := store.Save(ctx, t.KBID, entry.Name, r, fmt.Sprintf("archive:%s:%d", entry.ParentVersionID, entry.Index), ingest.Options{
				RelativePath: entry.RelativePath, SourceArchiveID: entry.ParentID, ArchiveChild: true,
				Guard: func(ctx context.Context, tx pgx.Tx) error { return Owned(ctx, tx, t) },
			})
			if err != nil {
				return ingest.ArchiveFile{}, err
			}
			out := ingest.ArchiveFile{ID: result["knowledge_id"].(string), VersionID: result["file_version_id"].(string), RelativePath: entry.RelativePath}
			err = w.Services.DB.QueryRow(ctx, "SELECT path FROM file_versions WHERE id=$1", out.VersionID).Scan(&out.Path)
			return out, err
		},
		Mark: func(ctx context.Context, id, state string) error {
			// Root status is finalized by process(); child archives have no separate jobs.
			if id == t.KnowledgeID {
				return nil
			}
			_, err := w.Services.DB.Exec(ctx, "UPDATE knowledge SET status=$2,storage_reason='',updated_at=now() WHERE id=$1", id, state)
			return err
		},
		Progress: func(ctx context.Context, report ingest.ArchiveReport) error {
			t.Checkpoint["archive_report"] = report
			return w.stage(ctx, t, "extract_archive", "running")
		},
	}
	err = x.Extract(ctx, root)
	t.Checkpoint["archive_report"] = x.Report
	if err != nil {
		_ = w.stage(ctx, t, "extract_archive", "failed")
		return err
	}
	if x.Report.IssueCount > 0 {
		if err = w.stage(ctx, t, "extract_archive", "partially_failed"); err != nil {
			return err
		}
		return &ai.Error{Code: "ARCHIVE_PARTIAL", Message: "部分条目未展开，请查看解压报告；原 ZIP 已完整保留"}
	}
	return w.stage(ctx, t, "extract_archive", "succeeded")
}
