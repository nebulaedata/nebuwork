package api

import (
	"context"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Page relationships come from saved Wiki text, independently of entity extraction.
type wikiGraphPage struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	State     string    `json:"state"`
	FolderID  *string   `json:"folder_id"`
	UpdatedAt time.Time `json:"updated_at"`
	Content   string    `json:"-"`
}
type wikiPageLink struct {
	Source      string `json:"source_id"`
	Target      string `json:"target_id"`
	SourceTitle string `json:"source_title"`
	TargetTitle string `json:"target_title"`
	Kind        string `json:"kind"`
}
type wikiPageGraph struct {
	Nodes      []wikiGraphPage `json:"nodes"`
	Edges      []wikiPageLink  `json:"edges"`
	Unresolved int             `json:"unresolved_references"`
}

var wikiComments = regexp.MustCompile(`(?s)<!--.*?-->`)
var wikiInlineCode = regexp.MustCompile("`+[^`]*`+")
var wikiBrackets = regexp.MustCompile(`\[\[([^\[\]\n]+)\]\]`)
var wikiMarkdownLink = regexp.MustCompile(`\[([^\[\]\n]+)\]\(([^\s)]+)\)`)
var wikiHeading = regexp.MustCompile(`^(#{1,6})\s+(.+?)\s*#*\s*$`)
var wikiListItem = regexp.MustCompile(`^(?:[-*+]|[0-9]+[.)])\s+(.+)$`)

func loadWikiPageGraph(ctx context.Context, db interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, kb string) (wikiPageGraph, error) {
	rows, err := db.Query(ctx, `SELECT id::text,title,state,folder_id::text,updated_at,content FROM wiki_pages WHERE knowledge_base_id=$1 ORDER BY title,id`, kb)
	if err != nil {
		return wikiPageGraph{}, err
	}
	defer rows.Close()
	pages := []wikiGraphPage{}
	for rows.Next() {
		var p wikiGraphPage
		if err = rows.Scan(&p.ID, &p.Title, &p.State, &p.FolderID, &p.UpdatedAt, &p.Content); err != nil {
			return wikiPageGraph{}, err
		}
		pages = append(pages, p)
	}
	if err = rows.Err(); err != nil {
		return wikiPageGraph{}, err
	}
	return buildWikiPageGraph(pages), nil
}

func buildWikiPageGraph(pages []wikiGraphPage) wikiPageGraph {
	g := wikiPageGraph{Nodes: pages, Edges: []wikiPageLink{}}
	names, ids := map[string]wikiGraphPage{}, map[string]wikiGraphPage{}
	for _, p := range pages {
		names[p.Title] = p
		ids[p.ID] = p
	}
	for _, p := range pages {
		seen, missing := map[string]bool{}, map[string]bool{}
		add := func(key, kind string, byID bool) {
			key = strings.TrimSpace(key)
			target, ok := names[key]
			if byID {
				target, ok = ids[key]
			}
			if !ok {
				if !missing[key] {
					g.Unresolved++
					missing[key] = true
				}
				return
			}
			if target.ID == p.ID || seen[target.ID] {
				return
			}
			seen[target.ID] = true
			g.Edges = append(g.Edges, wikiPageLink{p.ID, target.ID, p.Title, target.Title, kind})
		}
		fence := ""
		relatedLevel := 0
		for _, raw := range strings.Split(wikiComments.ReplaceAllString(p.Content, ""), "\n") {
			line := strings.TrimSpace(raw)
			if strings.HasPrefix(line, "```") || strings.HasPrefix(line, "~~~") {
				char := line[:1]
				n := len(line) - len(strings.TrimLeft(line, char))
				if fence == "" {
					fence = strings.Repeat(char, n)
				} else if strings.HasPrefix(line, fence) && strings.Trim(line, char+" \t") == "" {
					fence = ""
				}
				continue
			}
			if fence != "" || strings.HasPrefix(raw, "    ") || strings.HasPrefix(raw, "\t") {
				continue
			}
			line = wikiInlineCode.ReplaceAllString(line, "")
			if h := wikiHeading.FindStringSubmatch(line); h != nil {
				if relatedLevel > 0 && len(h[1]) <= relatedLevel {
					relatedLevel = 0
				}
				if h[2] == "关联页面" || h[2] == "相关页面" {
					relatedLevel = len(h[1])
				}
				continue
			}
			for _, m := range wikiBrackets.FindAllStringSubmatch(line, -1) {
				add(m[1], "reference", false)
			}
			for _, m := range wikiMarkdownLink.FindAllStringSubmatch(line, -1) {
				if strings.HasPrefix(m[2], "wiki:") {
					add(strings.TrimPrefix(m[2], "wiki:"), "reference", true)
				}
			}
			if relatedLevel == 0 {
				continue
			}
			item := wikiListItem.FindStringSubmatch(line)
			if item == nil {
				continue
			}
			value := strings.TrimSpace(item[1])
			if strings.Contains(value, "[[") {
				continue
			}
			if m := wikiMarkdownLink.FindStringSubmatch(value); m != nil {
				// Only a complete placeholder link is a named related page; external URLs are never guessed.
				if m[0] == value && m[2] == "#" {
					add(m[1], "related", false)
				}
			} else if !strings.ContainsAny(value, "[]<>") {
				add(strings.Trim(value, "*"), "related", false)
			}
		}
	}
	return g
}
