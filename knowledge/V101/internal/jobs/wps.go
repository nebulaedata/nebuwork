package jobs

// Shared by parsing failures and on-demand spreadsheet previews.
func WPSErrorMessage(code string) string {
	messages := map[string]string{
		"WPS_ENCRYPTED":             "WPS 文件已加密，请先在 WPS 中解除密码后上传；原文件已保留",
		"WPS_CORRUPT_FILE":          "WPS 文件容器损坏或结构不完整，请在 WPS 中另存后重试；未保存不完整解析结果",
		"WPS_FORMAT_MISMATCH":       "WPS 扩展名与实际内容类型不符（文字、表格、演示），请用正确的类型另存后上传",
		"WPS_UNSUPPORTED_VARIANT":   "当前转换器不支持此 WPS 文件的内部版本或结构；请在 WPS 中另存为 DOCX、XLSX 或 PPTX。原文件已保留，未按纯文本强行解析",
		"WPS_CONVERSION_TIMEOUT":    "WPS 格式转换超过 300 秒，请检查文件复杂度或拆分文件；未切换解析引擎",
		"WPS_CONVERTER_UNAVAILABLE": "WPS 转换工具不可用，请检查容器内 LibreOffice 依赖",
		"WPS_CONVERSION_FAILED":     "WPS 格式转换失败，可能包含损坏、加密或不兼容对象；请在 WPS 中另存后重试。原文件已保留，未使用其他引擎替代成功结果",
		"WPS_CONVERSION_INVALID":    "WPS 转换产物未通过结构核验，未用于分块或生成；请在 WPS 中另存为标准 Office 格式",
		"WPS_PARSE_FAILED":          "WPS 结构适配后解析失败，请检查文件内的复杂对象或损坏内容并另存后重试；未替换已有成功结果",
	}
	if message := messages[code]; message != "" {
		return message
	}
	return "WPS 文件处理失败；原文件已保留，未修改已有成功结果"
}
