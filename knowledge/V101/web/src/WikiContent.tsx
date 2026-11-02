import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { MessagePlugin } from "tdesign-react";
import { api, Row } from "./api";
import { navigate } from "./ui";
import { parsedSchema } from "./ParsedContent";

// These comments delimit generated sections for incremental backend updates.
// Hide only their presentation; never rewrite the persisted/editor content.
export function cleanWikiContent(text: string) {
  return text.replace(/<!--\s*\/?source-document(?::[^>]*?)?\s*-->/g, "");
}
export function wikiHeadings(text: string) {
  const clean = cleanWikiContent(text);
  let fenced = false;
  let offset = 0;
  const headings: { id: string; text: string; level: number }[] = [];
  for (const line of clean.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const match = !fenced && /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match)
      headings.push({
        id: `wiki-heading-${offset}`,
        text: match[2].replace(/[*`]/g, ""),
        level: match[1].length,
      });
    offset += line.length + 1;
  }
  return headings;
}
const schema = {
  ...parsedSchema,
  protocols: {
    ...parsedSchema.protocols,
    href: [...(parsedSchema.protocols?.href || []), "source", "wiki"],
  },
};
export function WikiContent({
  text,
  pages,
  onSelectPage,
}: {
  text: string;
  pages: Row[];
  onSelectPage: (id: string) => void;
}) {
  const clean = cleanWikiContent(text);
  const references = [
    ...new Set([...clean.matchAll(/\]\(source:([\w-]+)\)/g)].map((m) => m[1])),
  ];
  // Transform wiki links in the syntax tree, preserving code blocks and heading offsets.
  function wikiLinks() {
    return (tree: any) => {
      function visit(node: any) {
        if (
          !node.children ||
          ["link", "code", "inlineCode"].includes(node.type)
        )
          return;
        node.children = node.children.flatMap((child: any) => {
          if (child.type !== "text") {
            visit(child);
            return [child];
          }
          const result: any[] = [];
          let cursor = 0;
          for (const m of child.value.matchAll(/\[\[([^\[\]]+)\]\]/g)) {
            result.push({
              type: "text",
              value: child.value.slice(cursor, m.index),
            });
            const page = pages.find((p) => p.title === m[1].trim());
            result.push(
              page
                ? {
                    type: "link",
                    url: `wiki:${page.id}`,
                    children: [{ type: "text", value: m[1] }],
                  }
                : { type: "text", value: m[1] },
            );
            cursor = m.index + m[0].length;
          }
          result.push({ type: "text", value: child.value.slice(cursor) });
          return result;
        });
      }
      let relatedLevel = 0;
      const label = (node: any): string =>
        node.value || (node.children || []).map(label).join("");
      for (const node of tree.children || []) {
        if (node.type === "heading") {
          if (relatedLevel && node.depth <= relatedLevel) relatedLevel = 0;
          if (["关联页面", "相关页面"].includes(label(node)))
            relatedLevel = node.depth;
        }
        if (!relatedLevel || node.type !== "list") continue;
        for (const item of node.children || []) {
          const paragraph = item.children?.[0];
          if (
            paragraph?.type !== "paragraph" ||
            paragraph.children.length !== 1
          )
            continue;
          const child = paragraph.children[0];
          if (
            !["text", "strong", "link"].includes(child.type) ||
            (child.type === "link" && child.url !== "#")
          )
            continue;
          const page = pages.find((p) => p.title === label(child).trim());
          if (page)
            paragraph.children = [
              {
                type: "link",
                url: `wiki:${page.id}`,
                children: [{ type: "text", value: page.title }],
              },
            ];
        }
      }
      visit(tree);
    };
  }
  const heading =
    (level: 1 | 2 | 3) =>
    ({ node, children }: any) => {
      const Tag = `h${level}` as "h1" | "h2" | "h3";
      return (
        <Tag id={`wiki-heading-${node?.position?.start?.offset ?? 0}`}>
          {children}
        </Tag>
      );
    };
  return (
    <div className="wiki-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, wikiLinks]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
        urlTransform={(url) =>
          /^(https?:|mailto:|\/|#|source:[\w-]+$|wiki:[\w-]+$)/i.test(url) &&
          !url.startsWith("//")
            ? url
            : ""
        }
        components={{
          h1: heading(1),
          h2: heading(2),
          h3: heading(3),
          table: ({ node, ...props }) => (
            <div className="parsed-table-scroll">
              <table {...props} />
            </div>
          ),
          img: ({ alt }) =>
            alt ? <span className="help">[图片：{alt}]</span> : null,
          a: ({ href, children }) => {
            const source = href?.startsWith("source:");
            const wiki = href?.startsWith("wiki:");
            if (source || wiki)
              return (
                <a
                  className={source ? "wiki-citation" : "wiki-page-link"}
                  href="#"
                  title={source ? "查看原文来源" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    if (wiki) onSelectPage(href!.slice(5));
                    else
                      api<Row>("/sources/" + href!.slice(7))
                        .then((s) => navigate(s.preview_url))
                        .catch((e) => MessagePlugin.error(e.message));
                  }}
                >
                  {source
                    ? `来源 ${references.indexOf(href!.slice(7)) + 1 || ""}`
                    : children}
                </a>
              );
            return (
              <a
                href={href}
                target={href?.startsWith("#") ? undefined : "_blank"}
                rel="noopener noreferrer"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {clean}
      </ReactMarkdown>
    </div>
  );
}
