import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Radio } from "tdesign-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

export const parsedSchema = {
  ...defaultSchema,
  tagNames: defaultSchema.tagNames?.filter(
    (tag) => !["input", "style", "script"].includes(tag),
  ),
  attributes: {
    ...defaultSchema.attributes,
    td: [...(defaultSchema.attributes?.td || []), "colSpan", "rowSpan"],
    th: [...(defaultSchema.attributes?.th || []), "colSpan", "rowSpan"],
  },
};
export function RichContent({ text }: { text: string }) {
  return (
    <div className="parsed-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, parsedSchema]]}
        components={{
          table: ({ node, ...props }) => (
            <div className="parsed-table-scroll">
              <table {...props} />
            </div>
          ),
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
          // Document HTML is untrusted. Registered version-bound assets are
          // supplied separately, never fetched from arbitrary document URLs.
          img: ({ alt }) =>
            alt ? <span className="help">[图片：{alt}]</span> : null,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
export type OCRCleanup = {
  algorithm: string;
  message: string;
  needs_review: boolean;
  removed_characters: number;
  removals: { char_start: number; char_end: number }[];
};

// Every offset is in raw Unicode code points, including images/source highlights.
export function ocrDisplayText(text: string, cleanup?: OCRCleanup | null, offset = 0) {
  if (!cleanup) return text;
  const chars = Array.from(text);
  let cursor = 0;
  const parts: string[] = [];
  for (const range of cleanup.removals) {
    const start = Math.max(0, range.char_start - offset);
    const end = Math.min(chars.length, range.char_end - offset);
    if (end <= start) continue;
    if (start < cursor) return text;
    parts.push(chars.slice(cursor, start).join(""));
    cursor = end;
  }
  return parts.join("") + chars.slice(cursor).join("");
}

export function OCRText({ text, cleanup }: { text: string; cleanup?: OCRCleanup | null }) {
  const [raw, setRaw] = useState(false);
  if (!cleanup) return <RichContent text={text} />;
  const cleaned = ocrDisplayText(text, cleanup);
  return <div className="ocr-review">
    <Alert theme="warning" message={cleanup.message} />
    <div className="ocr-review-toolbar">
      <span className="help">{raw ? "原始 OCR · 未改写" : `已清理 ${cleanup.removed_characters} 个重复字符 · 待核验`}</span>
      <Button size="small" variant="text" onClick={() => setRaw(!raw)}>{raw ? "查看去重结果" : "查看原始 OCR"}</Button>
    </div>
    {raw ? <div className="content-text ocr-raw-text">{text}</div> : cleaned.trim() ? <RichContent text={cleaned} /> : <p className="help">本段为同一区域的循环重复，清理后无新增文字；仍可查看原始 OCR 和定位原文。</p>}
  </div>;
}
export type ImageOccurrence = {
  char_start: number;
  char_end: number;
  reference_only?: boolean;
  unplaced?: boolean;
  images: Record<string, any>[];
};

export function IllustratedContent({ text, occurrences, renderImages, focusSourceID, ocrCleanup }: {
  text: string;
  occurrences: ImageOccurrence[];
  renderImages: (images: Record<string, any>[]) => ReactNode;
  focusSourceID?: string;
  ocrCleanup?: OCRCleanup | null;
}) {
  const chars = Array.from(text);
  let cursor = 0;
  const items: ReactNode[] = [];
  const unplaced: ReactNode[] = [];
  for (const [index, occurrence] of [...occurrences].sort((a,b) => a.char_start-b.char_start).entries()) {
    const focused = !!focusSourceID && occurrence.images.some(image => image.source_ref_id===focusSourceID);
    const pictures=<div id={focused ? "source-image-highlight" : undefined} className={`parsed-inline-images${focused ? " source-image-highlight" : ""}`} key={`images-${index}`}>{renderImages(occurrence.images)}</div>;
    if (occurrence.unplaced || !Number.isInteger(occurrence.char_start) || occurrence.char_start<0 || occurrence.char_start>chars.length) {
      unplaced.push(pictures);
      continue;
    }
    const at = Math.max(cursor, occurrence.char_start);
    if (at>cursor) items.push(<RichContent key={`text-${index}`} text={ocrDisplayText(chars.slice(cursor,at).join(""),ocrCleanup,cursor)} />);
    items.push(pictures);
    cursor = occurrence.reference_only ? Math.max(at, Math.min(chars.length, occurrence.char_end)) : at;
  }
  if (cursor<chars.length) items.push(<RichContent key="remaining" text={ocrDisplayText(chars.slice(cursor).join(""),ocrCleanup,cursor)} />);
  if (unplaced.length) items.push(<section className="parsed-image-appendix" key="unplaced"><h3>文档内嵌图片</h3><p className="help">以下图片已提取，解析引擎未提供可核验的正文插入位置。</p>{unplaced}</section>);
  return <>{items}</>;
}
export function ParsedContent({
  text,
  start,
  end,
  imageOccurrences = [],
  renderImages,
  focusSourceID,
  ocrCleanup,
}: {
  text: string;
  start?: number;
  end?: number;
  imageOccurrences?: ImageOccurrence[];
  renderImages?: (images: Record<string, any>[]) => ReactNode;
  focusSourceID?: string;
  ocrCleanup?: OCRCleanup | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const hasImageTarget = !!focusSourceID && imageOccurrences.some(o => o.images.some(i=>i.source_ref_id===focusSourceID));
  const hasRange = start !== undefined && end !== undefined && end > start;
  const [view, setView] = useState(hasRange ? "raw" : "formatted");
  useEffect(() => {
    setView(hasRange && !hasImageTarget ? "raw" : "formatted");
  }, [start, end, hasRange, hasImageTarget, focusSourceID]);
  useEffect(() => {
    if (hasImageTarget && view === "formatted") root.current?.querySelector("#source-image-highlight")?.scrollIntoView({block:"center",behavior:"smooth"});
  }, [focusSourceID,hasImageTarget,view]);
  const chars = Array.from(text);
  return (
    <div ref={root}>
      {ocrCleanup && <Alert theme="warning" message={`${ocrCleanup.message} 可切换“原始文本”核对。`} />}
      <div className="parsed-content-toolbar">
        <Radio.Group
          variant="default-filled"
          size="small"
          value={view}
          onChange={(v) => setView(String(v))}
        >
          <Radio.Button value="formatted">排版视图</Radio.Button>
          <Radio.Button value="raw">原始文本</Radio.Button>
        </Radio.Group>
        {hasRange && view === "raw" && (
          <span className="help">
            按原始文本位置高亮来源，可切换排版视图查看表格。
          </span>
        )}
      </div>
      {view === "formatted" ? (
        renderImages && imageOccurrences.length ? <IllustratedContent text={text} occurrences={imageOccurrences} renderImages={renderImages} focusSourceID={focusSourceID} ocrCleanup={ocrCleanup} /> : <RichContent text={ocrDisplayText(text,ocrCleanup)} />
      ) : (
        <div className="content-text">
          {hasRange ? (
            <>
              {chars.slice(0, start).join("")}
              <mark id="source-highlight">
                {chars.slice(start, end).join("")}
              </mark>
              {chars.slice(end).join("")}
            </>
          ) : (
            text
          )}
        </div>
      )}
    </div>
  );
}
