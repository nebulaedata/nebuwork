package jobs

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"unicode"

	"nebulaekno/internal/ai"
)

// Diagnostics contain bounded model output, never request headers or credentials.
type GenerationIssue struct {
	Field     string   `json:"field"`
	Message   string   `json:"message"`
	SourceIDs []string `json:"source_ref_ids,omitempty"`
	Excerpt   string   `json:"excerpt,omitempty"`
}

func excerpt(s string) string {
	r := []rune(s)
	if len(r) > 1600 {
		return string(r[:1600]) + "…（已截断）"
	}
	return s
}

type WikiBlock struct {
	Content   string   `json:"content"`
	SourceIDs []string `json:"source_ref_ids"`
}
type StructuredWikiPage struct {
	Title  string      `json:"title"`
	Blocks []WikiBlock `json:"blocks"`
	// Read old provider responses without weakening their citation checks.
	Content   string   `json:"content,omitempty"`
	SourceIDs []string `json:"source_ref_ids,omitempty"`
}

const structuredWikiContract = `根据完整材料生成简体中文 Wiki。保留有依据的重要事实、数字、单位、条件、限制、表格含义和差异，不得以减少内容规避校验。相同主题合并为一页。输出 JSON {"pages":[{"title":"主题","blocks":[{"content":"Markdown 段落或完整表格","source_ref_ids":["S1"]}]}]}。每个事实段落/表格单独作为一个 block，并引用支撑该块的材料编号。正文不要写 source: 链接、UUID、HTML 注释或单独来源列表，程序负责生成链接。只使用本批 S 编号，不能猜测来源。关联页面可在正文使用 [[页面标题]]。`

// A repair must account for every outstanding page. Valid pages are immutable.
func validateWikiDraft(text string, aliases map[string]string, batch *WikiBatch) ([]WikiPage, []json.RawMessage, []GenerationIssue, error) {
	var envelope struct {
		Pages []json.RawMessage `json:"pages"`
	}
	if e := ai.ParseJSON(text, &envelope); e != nil {
		return nil, batch.Pending, nil, e
	}
	invalid := func(message string) ([]WikiPage, []json.RawMessage, []GenerationIssue, error) {
		return nil, batch.Pending, nil, &ai.Error{Code: "WIKI_SOURCE_INVALID", Message: message}
	}
	if len(envelope.Pages) == 0 {
		return invalid("Wiki 未返回页面，不能用空结果绕过修复")
	}
	if len(batch.Pending) > 0 && len(envelope.Pages) != len(batch.Pending) {
		return invalid("局部修复必须逐项返回全部待修复页面，不能删除或增加页面")
	}
	// Duplicate themes must be merged before accepting either page; otherwise a
	// later local repair could accidentally overwrite an already accepted page.
	seen := map[string]bool{}
	for _, raw := range envelope.Pages {
		var p StructuredWikiPage
		_ = json.Unmarshal(raw, &p)
		title := strings.TrimSpace(p.Title)
		if title != "" && seen[title] {
			return invalid("同一批次标题重复，请合并同主题的全部事实和来源")
		}
		seen[title] = true
	}
	titles := map[string]bool{}
	for _, title := range batch.Accepted {
		titles[title] = true
	}
	valid := []WikiPage{}
	pending := []json.RawMessage{}
	issues := []GenerationIssue{}
	for i, raw := range envelope.Pages {
		var page StructuredWikiPage
		pageIssues := []GenerationIssue{}
		issue := func(field, message string, refs []string, value string) {
			pageIssues = append(pageIssues, GenerationIssue{Field: fmt.Sprintf("pages[%d].%s", i, field), Message: message, SourceIDs: refs, Excerpt: excerpt(value)})
		}
		if e := json.Unmarshal(raw, &page); e != nil {
			issue("page", "页面字段类型错误", nil, string(raw))
		}
		page.Title = strings.TrimSpace(page.Title)
		if len(batch.Pending) > 0 {
			var old StructuredWikiPage
			_ = json.Unmarshal(batch.Pending[i], &old)
			if old.Title != "" && page.Title != strings.TrimSpace(old.Title) {
				return invalid("局部修复不得替换页面主题或改变待修复页面顺序")
			}
			if len(old.Blocks) > 0 {
				if len(page.Blocks) != len(old.Blocks) {
					return invalid("局部修复不得删除、增加或合并正文块，请保留全部事实")
				}
				for j, block := range old.Blocks {
					// Citation repair is not a license to rewrite verified prose.
					if strings.TrimSpace(block.Content) != "" && !strings.Contains(strings.ToLower(block.Content), "source:") && !strings.Contains(block.Content, "<!--") && page.Blocks[j].Content != block.Content {
						return invalid("引用修复不得改写原有正文、数值或表格，只修正来源编号")
					}
				}
			}
		}
		if page.Title == "" || titles[page.Title] {
			issue("title", "标题为空或与已保留的页面重复", nil, page.Title)
		}
		titles[page.Title] = true
		out := WikiPage{Title: page.Title, SourceIDs: []string{}}
		if len(page.Blocks) == 0 && page.Content != "" {
			legacy, _ := json.Marshal(map[string]any{"pages": []WikiPage{{Title: page.Title, Content: page.Content, SourceIDs: page.SourceIDs}}})
			pages, e := validateWiki(string(legacy), aliases)
			if e != nil {
				issue("content", wikiFailure(e).Message, nil, page.Content)
			} else {
				out = pages[0]
			}
		} else if len(page.Blocks) == 0 {
			issue("blocks", "缺少有来源的正文块", nil, string(raw))
		} else {
			rendered := []string{}
			for j, block := range page.Blocks {
				field := fmt.Sprintf("blocks[%d]", j)
				refs := []string{}
				links := []string{}
				for _, alias := range block.SourceIDs {
					id := aliases[alias]
					if id == "" {
						issue(field+".source_ref_ids", "来源编号不属于本批材料："+alias, nil, block.Content)
						continue
					}
					if !slices.Contains(refs, id) {
						refs = append(refs, id)
						links = append(links, "[来源](source:"+id+")")
					}
				}
				if strings.TrimSpace(block.Content) == "" || len(block.SourceIDs) == 0 {
					issue(field, "正文块或来源列表为空", refs, block.Content)
				}
				if strings.Contains(strings.ToLower(block.Content), "source:") || strings.Contains(block.Content, "<!--") {
					issue(field+".content", "请将引用放在结构化 source_ref_ids 中，正文不得包含来源链接或内部标记", refs, block.Content)
				}
				rendered = append(rendered, strings.TrimSpace(block.Content)+"\n\n"+strings.Join(links, " "))
				for _, id := range refs {
					if !slices.Contains(out.SourceIDs, id) {
						out.SourceIDs = append(out.SourceIDs, id)
					}
				}
			}
			out.Content = strings.Join(rendered, "\n\n")
		}
		if len(pageIssues) > 0 {
			pending = append(pending, raw)
			issues = append(issues, pageIssues...)
		} else {
			valid = append(valid, out)
		}
	}
	if len(pending) > 0 {
		return valid, pending, issues, &ai.Error{Code: "WIKI_SOURCE_INVALID", Message: fmt.Sprintf("%d 个页面需局部修复；其余页面已通过引用校验", len(pending))}
	}
	return valid, nil, nil, nil
}

// Ignore whitespace only, then map the exact match back to the original text.
// Numbers, punctuation, units and negations are NEVER normalized or guessed.
func originalQuote(content, quote string) (string, bool) {
	normalize := func(s string) ([]rune, []int) {
		out, positions := []rune{}, []int{}
		for i, r := range []rune(s) {
			if !unicode.IsSpace(r) {
				out = append(out, r)
				positions = append(positions, i)
			}
		}
		return out, positions
	}
	hay, pos := normalize(content)
	needle, _ := normalize(quote)
	if len(needle) == 0 {
		return "", false
	}
	at := strings.Index(string(hay), string(needle))
	if at < 0 {
		return "", false
	}
	start := len([]rune(string(hay)[:at]))
	end := start + len(needle) - 1
	return string([]rune(content)[pos[start] : pos[end]+1]), true
}
