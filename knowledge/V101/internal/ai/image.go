package ai

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"os"
)

func ImageData(path string) (string, error) {
	f, e := os.Open(path)
	if e != nil {
		return "", fmt.Errorf("图片文件不可读")
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil || info.Size() > 20<<20 {
		return "", fmt.Errorf("图片超过模型输入限制")
	}
	b, e := os.ReadFile(path)
	if e != nil {
		return "", fmt.Errorf("图片读取失败")
	}
	kind := http.DetectContentType(b)
	if kind != "image/png" && kind != "image/jpeg" && kind != "image/webp" {
		return "", fmt.Errorf("图片格式不适合模型输入")
	}
	return "data:" + kind + ";base64," + base64.StdEncoding.EncodeToString(b), nil
}
