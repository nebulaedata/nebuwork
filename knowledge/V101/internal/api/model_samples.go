package api

import (
	"io"
	"nebulaekno/internal/ai"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (s *Server) testModelSample(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	m, e := ai.Load(r.Context(), s.Services, id)
	if e != nil {
		Failure(w, 404, "NOT_FOUND", "模型不存在")
		return
	}
	if m.Purpose == "text" && !ai.AllowsImageInput(m) {
		Failure(w, 422, "IMAGE_INPUT_DISABLED", "请先在该文本模型设置中开启“允许图片输入”")
		return
	}
	if !ai.AllowsImageInput(m) && m.Purpose != "asr" && m.Purpose != "multimodal_embedding" {
		Failure(w, 400, "INVALID_ARGUMENT", "该模型用途不需要文件样本")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 26<<20)
	reader, e := r.MultipartReader()
	if e != nil {
		Failure(w, 400, "INVALID_ARGUMENT", "需要 multipart 文件样本")
		return
	}
	part, e := reader.NextPart()
	if e != nil || part.FileName() == "" {
		Failure(w, 400, "INVALID_ARGUMENT", "缺少样本文件")
		return
	}
	defer part.Close()
	extension := strings.ToLower(filepath.Ext(part.FileName()))
	if m.Purpose == "asr" && extension != ".wav" && extension != ".mp3" && extension != ".m4a" && extension != ".flac" {
		Failure(w, 400, "UNSUPPORTED_FORMAT", "语音测试支持 WAV、MP3、M4A、FLAC")
		return
	}
	dir := filepath.Join(s.Config.DataDir, "tmp")
	f, e := os.CreateTemp(dir, "model-sample-*"+extension)
	if e != nil {
		Failure(w, 500, "STORAGE_UNAVAILABLE", "样本存储不可用")
		return
	}
	path := f.Name()
	defer func() { f.Close(); os.Remove(path) }()
	n, e := io.Copy(f, io.LimitReader(part, 25<<20+1))
	f.Close()
	if e != nil || n > 25<<20 {
		Failure(w, 413, "UPLOAD_TOO_LARGE", "测试样本最大 25 MiB")
		return
	}
	var result any
	switch m.Purpose {
	case "asr":
		var transcript ai.Transcript
		transcript, e = ai.Transcribe(r.Context(), m, path)
		if e == nil {
			if len(transcript.Segments) == 0 {
				Failure(w, 422, "ASR_TIMESTAMPS_REQUIRED", "ASR 没有返回分段时间戳，请使用有语音的样本并确认模型支持 verbose_json")
				return
			}
			for _, segment := range transcript.Segments {
				if segment.Start < 0 || segment.End <= segment.Start {
					Failure(w, 422, "ASR_TIMESTAMPS_INVALID", "ASR 时间戳无效")
					return
				}
			}
			result = map[string]any{"tested": "audio_transcription", "timestamps": "segment", "response": transcript}
		}
	case "text", "vision", "multimodal_embedding":
		var image string
		image, e = ai.ImageData(path)
		if e == nil {
			if ai.AllowsImageInput(m) {
				var text string
				text, e = ai.Chat(r.Context(), m, "用中文描述此图片实际可见内容。", []string{image})
				result = map[string]any{"tested": "vision_image_input", "response": text}
			} else {
				var vectors [][]float64
				vectors, e = ai.Embeddings(r.Context(), m, []any{map[string]string{"image": image}, map[string]string{"text": "图片内容"}})
				if e == nil {
					result = map[string]any{"tested": "text_and_image_embedding", "dimension": len(vectors[0]), "count": len(vectors)}
				}
			}
		}
	}
	if e != nil {
		if a, ok := e.(*ai.Error); ok {
			Failure(w, 502, a.Code, a.Message)
		} else {
			Failure(w, 400, "SAMPLE_INVALID", "样本读取或处理失败")
		}
		return
	}
	JSON(w, 200, result)
}
