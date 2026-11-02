package defaults

import "testing"

func TestIndependentParserResolution(t *testing.T) {
	selected := map[string]any{"word": "libreoffice", "audio": "ffmpeg", "image": "tesseract"}
	for _, test := range []struct{ ext, key, engine string }{
		{".DOCX", "word", "libreoffice"}, {"odt", "odt", "anydoc"}, {"epub", "epub", "anydoc"},
		{"mp3", "audio", "ffmpeg"}, {"mp4", "video", "simple"}, {"png", "image", "tesseract"},
		{"pdf", "pdf", "paddleocr_vl"}, {"ofd", "ofd", "paddleocr_vl"}, {"csv", "csv", "simple"}, {"html", "html", "native"},
	} {
		key, engine := ParserForExtension(test.ext, selected)
		if key != test.key || engine != test.engine {
			t.Errorf("%s resolved to %s/%s", test.ext, key, engine)
		}
	}
	extensions := map[string]bool{}
	for _, f := range ParserFormats {
		found := false
		for _, choice := range f.Choices {
			if choice == f.Default {
				found = true
			}
		}
		if !found {
			t.Errorf("default not selectable: %s", f.Key)
		}
		for _, ext := range f.Extensions {
			if extensions[ext] {
				t.Errorf("ambiguous extension: %s", ext)
			}
			extensions[ext] = true
		}
	}
}
