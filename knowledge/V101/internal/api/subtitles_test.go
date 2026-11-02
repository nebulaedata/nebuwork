package api

import "testing"

func TestSubtitleOffsetAndBounds(t *testing.T) {
	input := "1\r\n00:00:00,200 --> 00:00:01,500\r\n你好😀\r\n\r\n2\r\n00:00:02,000 --> 00:00:02,500\r\n数据库\r\n"
	out, e := parseSubtitles(input, 100, 3000)
	if e != nil || len(out) != 2 || out[0]["start_ms"] != int64(300) || out[0]["text"] != "你好😀" {
		t.Fatalf("unexpected result: %v %v", out, e)
	}
	for _, offset := range []int64{-500, 1000} {
		if _, e = parseSubtitles(input, offset, 3000); e == nil {
			t.Fatalf("accepted invalid offset %d", offset)
		}
	}
	if _, e = parseSubtitles("WEBVTT\n\n00:02.000 --> 00:01.000\n倒序\n", 0, 3000); e == nil {
		t.Fatal("accepted reversed time")
	}
}
