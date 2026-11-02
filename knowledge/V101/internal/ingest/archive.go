package ingest

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"nebulaekno/internal/config"
	"path"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
)

type ArchiveFile struct{ ID, VersionID, Path, RelativePath string }
type ArchiveEntry struct {
	Name, RelativePath, ParentID, ParentVersionID string
	Index                                         int
}
type ArchiveIssue struct {
	Path   string `json:"path"`
	Reason string `json:"reason"`
}
type ArchiveReport struct {
	Entries    int            `json:"entries"`
	Files      int            `json:"files"`
	Skipped    int            `json:"skipped_files"`
	Bytes      int64          `json:"expanded_bytes"`
	IssueCount int            `json:"issue_count"`
	Issues     []ArchiveIssue `json:"issues"`
}

// Each retry traverses the same immutable archive. The Store callback deduplicates
// by parent file version and entry index, including entries with identical names.
type Extractor struct {
	Config   config.Config
	Store    func(context.Context, ArchiveEntry, io.Reader) (ArchiveFile, error)
	Mark     func(context.Context, string, string) error
	Progress func(context.Context, ArchiveReport) error
	Report   ArchiveReport
}

func (x *Extractor) issue(name, reason string) {
	x.Report.IssueCount++
	if len(x.Report.Issues) < 100 {
		x.Report.Issues = append(x.Report.Issues, ArchiveIssue{name, reason})
	}
}

func (x *Extractor) Extract(ctx context.Context, root ArchiveFile) error {
	x.Report = ArchiveReport{Issues: []ArchiveIssue{}}
	return x.walk(ctx, root, 1)
}

func archiveEntryName(f *zip.File) string {
	name := f.Name
	// Many Windows ZIP tools store Chinese names in GBK without the UTF-8 flag.
	if f.NonUTF8 && !utf8.ValidString(name) {
		if decoded, err := simplifiedchinese.GB18030.NewDecoder().String(name); err == nil {
			name = decoded
		}
	}
	return strings.ReplaceAll(name, "\\", "/")
}

func (x *Extractor) walk(ctx context.Context, current ArchiveFile, depth int) error {
	before := x.Report.IssueCount
	if depth > x.Config.ArchiveMaxDepth {
		x.issue(current.RelativePath, "超过递归解压层数，已保留 ZIP 原文件")
		return x.Mark(ctx, current.ID, "partially_extracted")
	}
	z, err := zip.OpenReader(current.Path)
	if err != nil {
		if depth == 1 {
			return fmt.Errorf("ZIP 无法解压：文件损坏或格式无效；原文件已保留")
		}
		x.issue(current.RelativePath, "ZIP 损坏或格式无效，已保留原文件")
		return x.Mark(ctx, current.ID, "partially_extracted")
	}
	defer z.Close()
	for index, f := range z.File {
		if err = ctx.Err(); err != nil {
			return err
		}
		if x.Report.Entries >= x.Config.ArchiveMaxFiles {
			x.issue(current.RelativePath, "超过解压条目数量，剩余内容保留在原 ZIP 中")
			break
		}
		x.Report.Entries++
		name := archiveEntryName(f)
		if f.FileInfo().IsDir() {
			continue
		}
		base := path.Base(name)
		relative, validErr := RelativePath(base, name)
		full := current.RelativePath + "/" + relative
		if validErr != nil {
			x.issue(current.RelativePath+"/"+name, "路径无效，保留在原 ZIP 中")
			continue
		}
		if IsTemporaryFile(base) {
			x.Report.Skipped++
			continue
		}
		if !f.Mode().IsRegular() {
			x.issue(full, "链接或特殊文件不展开，保留在原 ZIP 中")
			continue
		}
		if f.Flags&1 != 0 {
			x.issue(full, "加密文件无法解压，保留在原 ZIP 中")
			continue
		}
		ext := strings.TrimPrefix(strings.ToLower(path.Ext(base)), ".")
		if f.UncompressedSize64 > uint64(Limit(x.Config, ext)) {
			x.issue(full, "超过单文件大小限制，保留在原 ZIP 中")
			continue
		}
		if f.UncompressedSize64 > uint64(x.Config.ArchiveMaxExpanded-x.Report.Bytes) {
			x.issue(full, "超过本次递归解压总大小，保留在原 ZIP 中")
			continue
		}
		if _, err = RelativePath(base, full); err != nil {
			x.issue(full, "相对路径过长，保留在原 ZIP 中")
			continue
		}
		r, openErr := f.Open()
		if openErr != nil {
			x.issue(full, "无法读取该压缩条目，保留在原 ZIP 中")
			continue
		}
		x.Report.Bytes += int64(f.UncompressedSize64)
		stored, storeErr := x.Store(ctx, ArchiveEntry{base, full, current.ID, current.VersionID, index}, ContextReader{ctx, r})
		r.Close()
		if storeErr != nil {
			return fmt.Errorf("保存解压文件 %s 失败：%w", full, storeErr)
		}
		x.Report.Files++
		if err = x.Progress(ctx, x.Report); err != nil {
			return err
		}
		if ext == "zip" {
			if err = x.walk(ctx, stored, depth+1); err != nil {
				return err
			}
		}
	}
	status := "extracted"
	if x.Report.IssueCount > before {
		status = "partially_extracted"
	}
	if err = x.Mark(ctx, current.ID, status); err != nil {
		return err
	}
	return x.Progress(ctx, x.Report)
}
