package ingest

import (
	"context"
	"fmt"
	"io"
	"nebulaekno/internal/config"
	"nebulaekno/internal/defaults"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"
)

const OfficeTemporaryPrefix = "~$"

// Office lock files are not source documents, regardless of their extension.
// Match only the filename, so a normal file in a similarly named folder is kept.
func IsTemporaryFile(name string) bool {
	return strings.HasPrefix(path.Base(strings.ReplaceAll(name, "\\", "/")), OfficeTemporaryPrefix)
}

func SkippedFile(name, relative string) map[string]any {
	return map[string]any{"file_name": name, "relative_path": relative, "state": "skipped", "skip_reason": "office_temporary_file"}
}

func Supported(ext string) bool {
	for _, f := range defaults.ParserFormats {
		for _, candidate := range f.Extensions {
			if ext == candidate {
				return true
			}
		}
	}
	return false
}

func IsMedia(ext string) bool {
	switch ext {
	case "mp3", "wav", "ogg", "flac", "m4a", "aac", "mp4", "mkv", "mov", "webm", "avi", "m4v":
		return true
	}
	return false
}

func Limit(c config.Config, ext string) int64 {
	if ext == "zip" {
		return c.ArchiveMaxUpload
	}
	if IsMedia(ext) {
		return c.MediaMaxUpload
	}
	return c.MaxUpload
}

// Relative paths describe provenance only; physical files always use generated IDs.
func RelativePath(name, relative string) (string, error) {
	if relative == "" {
		relative = name
	}
	relative = strings.ReplaceAll(relative, "\\", "/")
	if !utf8.ValidString(relative) || len(relative) > 4096 || strings.HasPrefix(relative, "/") {
		return "", fmt.Errorf("文件相对路径无效")
	}
	for _, segment := range strings.Split(relative, "/") {
		if segment == "" || segment == "." || segment == ".." || strings.Contains(segment, ":") || strings.IndexFunc(segment, unicode.IsControl) >= 0 {
			return "", fmt.Errorf("文件相对路径包含无效目录")
		}
	}
	if strings.TrimSpace(name) == "" || utf8.RuneCountInString(name) > 256 || path.Base(relative) != name || strings.ContainsAny(name, "/\\") {
		return "", fmt.Errorf("文件名与相对路径不一致")
	}
	return relative, nil
}

type ContextReader struct {
	Context context.Context
	Reader  io.Reader
}

func (r ContextReader) Read(p []byte) (int, error) {
	if err := r.Context.Err(); err != nil {
		return 0, err
	}
	return r.Reader.Read(p)
}
