package ingest

import (
	"context"
	"os"
	"testing"

	"nebulaekno/internal/config"
)

func TestTemporaryFilesMatchOnlyFilenamePrefix(t *testing.T) {
	for _, name := range []string{"~$任务书.docx", "~$表格.xlsx", "~$说明.PDF", "~$无扩展名", "目录/~$锁文件.doc", `目录\~$锁文件.doc`} {
		if !IsTemporaryFile(name) {
			t.Errorf("temporary file was not filtered: %q", name)
		}
	}
	for _, name := range []string{"任务书.docx", "说明~$备份.docx", "~普通文件.txt", "$预算.xlsx", "资料.custom", "~$目录/正常.docx", `~$目录\正常.docx`} {
		if IsTemporaryFile(name) {
			t.Errorf("normal file was filtered: %q", name)
		}
	}
}

type unreadableFile struct{}

func (unreadableFile) Read([]byte) (int, error) {
	panic("temporary file content must not be read")
}

func TestTemporaryUploadDoesNotReadContentOrCreateFiles(t *testing.T) {
	dir := t.TempDir()
	// Nil Services also ensures no database records or tasks are touched.
	store := Store{Config: config.Config{DataDir: dir}}
	result, err := store.Save(context.Background(), "unused", "~$任务书.docx", unreadableFile{}, "key", Options{RelativePath: "上传目录/~$任务书.docx"})
	if err != nil || result["state"] != "skipped" || result["skip_reason"] != "office_temporary_file" || result["knowledge_id"] != nil || result["task_id"] != nil {
		t.Fatalf("skip result=%v error=%v", result, err)
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 0 {
		t.Fatalf("temporary upload created files: %v %v", files, err)
	}
}
