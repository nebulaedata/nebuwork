package defaults

import (
	"embed"
	"encoding/json"
	"strings"
)

//go:embed parser_catalog.json
var parserFiles embed.FS

type ParserFormat struct {
	Key        string   `json:"key"`
	Name       string   `json:"name"`
	Extensions []string `json:"extensions"`
	Default    string   `json:"default"`
	Choices    []string `json:"choices"`
}

var ParserFormats = loadParserFormats()
var ParserEngines, ParserChoices = parserMaps()

func loadParserFormats() []ParserFormat {
	data, err := parserFiles.ReadFile("parser_catalog.json")
	if err != nil {
		panic(err)
	}
	var formats []ParserFormat
	if err = json.Unmarshal(data, &formats); err != nil {
		panic(err)
	}
	return formats
}

func parserMaps() (map[string]string, map[string][]string) {
	engines, choices := map[string]string{}, map[string][]string{}
	for _, f := range ParserFormats {
		engines[f.Key], choices[f.Key] = f.Default, f.Choices
	}
	// Accept old clients and frozen tasks without advertising merged rows.
	choices["text"], choices["media"] = []string{"native"}, []string{"ffmpeg"}
	return engines, choices
}

func ParserForExtension(extension string, selections map[string]any) (string, string) {
	extension = strings.TrimPrefix(strings.ToLower(extension), ".")
	for _, f := range ParserFormats {
		for _, ext := range f.Extensions {
			if extension == ext {
				if selected, ok := selections[f.Key].(string); ok && selected != "" {
					return f.Key, selected
				}
				if (f.Key == "audio" || f.Key == "video") && selections["media"] == "ffmpeg" {
					return f.Key, "ffmpeg"
				}
				if f.Key == "txt" && selections["text"] == "native" {
					return f.Key, "native"
				}
				return f.Key, f.Default
			}
		}
	}
	return "", ""
}

const ImageInstructions = "请用简体中文客观描述图片中可观察到的内容、布局与文字。不推断人物身份、意图或未显示的事实。说明看不清的内容。直接返回描述。"
