package ingest

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"

	"nebulaekno/internal/config"
)

type zipEntry struct {
	name      string
	body      []byte
	mode      os.FileMode
	encrypted bool
}

func zipBytes(t *testing.T, entries ...zipEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for _, e := range entries {
		h := &zip.FileHeader{Name: e.name, Method: zip.Deflate}
		if e.mode != 0 {
			h.SetMode(e.mode)
		}
		if e.encrypted {
			h.Flags |= 1
		}
		f, err := w.CreateHeader(h)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = f.Write(e.body); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
func extractionFixture(t *testing.T, payload []byte) (*Extractor, ArchiveFile, *[]ArchiveEntry) {
	t.Helper()
	dir := t.TempDir()
	root := ArchiveFile{"root", "root-version", filepath.Join(dir, "root.zip"), "资料/root.zip"}
	if err := os.WriteFile(root.Path, payload, 0600); err != nil {
		t.Fatal(err)
	}
	entries := []ArchiveEntry{}
	x := &Extractor{
		Config: config.Config{MaxUpload: 1 << 20, MediaMaxUpload: 1 << 20, ArchiveMaxUpload: 1 << 20, ArchiveMaxExpanded: 4 << 20, ArchiveMaxDepth: 8, ArchiveMaxFiles: 100},
		Store: func(ctx context.Context, e ArchiveEntry, r io.Reader) (ArchiveFile, error) {
			entries = append(entries, e)
			id := fmt.Sprint(len(entries))
			p := filepath.Join(dir, id)
			data, err := io.ReadAll(r)
			if err != nil {
				return ArchiveFile{}, err
			}
			err = os.WriteFile(p, data, 0600)
			return ArchiveFile{id, "version-" + id, p, e.RelativePath}, err
		},
		Mark:     func(context.Context, string, string) error { return nil },
		Progress: func(context.Context, ArchiveReport) error { return nil },
	}
	return x, root, &entries
}
func TestRecursiveArchivesPreserveAllFileTypesAndPaths(t *testing.T) {
	inner := zipBytes(t, zipEntry{name: "中文/同名.xyz", body: []byte("unknown")}, zipEntry{name: "empty.txt"})
	outer := zipBytes(t, zipEntry{name: "a/same.txt", body: []byte("first")}, zipEntry{name: "b/same.txt", body: []byte("second")}, zipEntry{name: "nested.ZIP", body: inner})
	x, root, entries := extractionFixture(t, outer)
	if err := x.Extract(context.Background(), root); err != nil {
		t.Fatal(err)
	}
	if x.Report.Files != 5 || x.Report.IssueCount != 0 {
		t.Fatalf("report: %+v", x.Report)
	}
	if (*entries)[3].RelativePath != "资料/root.zip/nested.ZIP/中文/同名.xyz" || (*entries)[3].ParentID != "3" {
		t.Fatalf("provenance: %+v", *entries)
	}
}
func TestArchiveRejectsUnsafeEntriesWithoutLosingSafeFiles(t *testing.T) {
	payload := zipBytes(t,
		zipEntry{name: "../escape.txt", body: []byte("x")},
		zipEntry{name: "/absolute.txt", body: []byte("x")},
		zipEntry{name: "C:\\drive.txt", body: []byte("x")},
		zipEntry{name: "link", body: []byte("../outside"), mode: os.ModeSymlink | 0777},
		zipEntry{name: "secret.txt", body: []byte("secret"), encrypted: true},
		zipEntry{name: "broken.zip", body: []byte("bad zip")},
		zipEntry{name: "safe.bin", body: []byte("saved")})
	x, root, entries := extractionFixture(t, payload)
	if err := x.Extract(context.Background(), root); err != nil {
		t.Fatal(err)
	}
	if len(*entries) != 2 || x.Report.IssueCount != 6 {
		t.Fatalf("entries=%+v report=%+v", *entries, x.Report)
	}
}

func TestRecursiveArchivesFilterOfficeTemporaryFiles(t *testing.T) {
	inner := zipBytes(t,
		zipEntry{name: `二级\~$表格.xlsx`, body: []byte("lock")},
		zipEntry{name: "二级/正常.custom", body: []byte("kept")})
	outer := zipBytes(t,
		zipEntry{name: "~$任务书.docx", body: []byte("lock")},
		zipEntry{name: "~$损坏.zip", body: []byte("not a zip")},
		zipEntry{name: "附件.zip", body: inner},
		zipEntry{name: "~$目录/正常.txt", body: []byte("normal")})
	x, root, entries := extractionFixture(t, outer)
	for attempt := 0; attempt < 2; attempt++ {
		*entries = nil
		if err := x.Extract(context.Background(), root); err != nil {
			t.Fatal(err)
		}
		if x.Report.Skipped != 3 || x.Report.Files != 3 || x.Report.Entries != 6 || x.Report.IssueCount != 0 || x.Report.Bytes != int64(len(inner)+len("keptnormal")) {
			t.Fatalf("report: %+v", x.Report)
		}
		for _, entry := range *entries {
			if IsTemporaryFile(entry.Name) {
				t.Fatalf("temporary file reached storage: %+v", entry)
			}
		}
	}
}

func TestArchiveContainingOnlyTemporaryFilesSucceeds(t *testing.T) {
	x, root, entries := extractionFixture(t, zipBytes(t, zipEntry{name: "~$任务书.docx"}))
	marked := ""
	x.Mark = func(_ context.Context, _, state string) error { marked = state; return nil }
	if err := x.Extract(context.Background(), root); err != nil {
		t.Fatal(err)
	}
	if marked != "extracted" || len(*entries) != 0 || x.Report.Skipped != 1 || x.Report.IssueCount != 0 || x.Report.Bytes != 0 {
		t.Fatalf("marked=%s report=%+v", marked, x.Report)
	}
}
func TestArchiveLimitsAcrossNestedFiles(t *testing.T) {
	inner := zipBytes(t, zipEntry{name: "a.txt", body: bytes.Repeat([]byte("a"), 500)})
	outer := zipBytes(t, zipEntry{name: "nested.zip", body: inner}, zipEntry{name: "b.txt", body: bytes.Repeat([]byte("b"), 500)})
	for _, kind := range []string{"depth", "entries", "bytes", "file_size"} {
		t.Run(kind, func(t *testing.T) {
			x, root, _ := extractionFixture(t, outer)
			switch kind {
			case "depth":
				x.Config.ArchiveMaxDepth = 1
			case "entries":
				x.Config.ArchiveMaxFiles = 1
			case "bytes":
				x.Config.ArchiveMaxExpanded = int64(len(inner)) + 499
			case "file_size":
				x.Config.MaxUpload = 499
			}
			if err := x.Extract(context.Background(), root); err != nil {
				t.Fatal(err)
			}
			if x.Report.IssueCount == 0 || x.Report.Bytes > x.Config.ArchiveMaxExpanded || x.Report.Entries > x.Config.ArchiveMaxFiles {
				t.Fatalf("limits: %+v", x.Report)
			}
		})
	}
}
func TestArchiveCancellationAndCorruption(t *testing.T) {
	x, root, _ := extractionFixture(t, zipBytes(t, zipEntry{name: "a.txt", body: []byte("a")}))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := x.Extract(ctx, root); err != context.Canceled {
		t.Fatalf("cancellation: %v", err)
	}
	if err := os.WriteFile(root.Path, []byte("invalid zip"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := x.Extract(context.Background(), root); err == nil {
		t.Fatal("corrupt root must fail")
	}
}
func TestRelativePathValidation(t *testing.T) {
	for _, p := range []string{"../x.txt", "a/../../x.txt", "/x.txt", "C:/x.txt", "a//x.txt", "a/./x.txt", "a/\x00x.txt", "other.txt"} {
		if _, err := RelativePath("x.txt", p); err == nil {
			t.Errorf("accepted %q", p)
		}
	}
	if p, err := RelativePath("x.txt", "文件夹\\子目录\\x.txt"); err != nil || p != "文件夹/子目录/x.txt" {
		t.Fatalf("%q %v", p, err)
	}
}
