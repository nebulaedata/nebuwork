import { resourceURL } from "./integration";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Button,
  Space,
  Tabs,
  Tree,
  MessagePlugin,
  Dialog,
  Upload,
  InputNumber,
  Image,
  Pagination,
  Alert,
} from "tdesign-react";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import zhCN from "video.js/dist/lang/zh-CN.json";
videojs.addLanguage("zh-CN", zhCN);
const TabPanel = Tabs.TabPanel;
const PdfPreview = lazy(() => import("./PdfPreview"));
const DocumentWiki = lazy(() =>
  import("./DocumentRelated").then((m) => ({ default: m.DocumentWiki })),
);
const DocumentGraph = lazy(() =>
  import("./DocumentRelated").then((m) => ({ default: m.DocumentGraph })),
);
import { api, send, Row } from "./api";
import { DocumentProcessing } from "./ProcessingPipeline";
import { documentApplications } from "./DocumentApplications";
import { ChunkImages, ImageGallery } from "./Images";
import { ParsedContent, OCRText, RichContent } from "./ParsedContent";
import { StoredDocument } from "./StoredDocument";
import { RebuildDialog } from "./RebuildDialog";
import { SpreadsheetPreview } from "./SpreadsheetPreview";
import {
  action,
  Busy,
  Empty,
  ErrorNotice,
  navigate,
  Status,
  timeLabel,
  locationLabel,
  useData,
  usePath,
} from "./ui";
function Player({
  url,
  type,
  seek,
}: {
  url: string;
  type: string;
  seek: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<ReturnType<typeof videojs>>();
  useEffect(() => {
    const video = document.createElement("video-js");
    video.classList.add("vjs-big-play-centered");
    container.current!.appendChild(video);
    player.current = videojs(video, {
      controls: true,
      language: "zh-CN",
      fluid: true,
      preload: "metadata",
      sources: [
        {
          src: url,
          type:
            type === "mp3"
              ? "audio/mpeg"
              : type === "wav"
                ? "audio/wav"
                : type === "ogg"
                  ? "audio/ogg"
                  : "video/mp4",
        },
      ],
    });
    return () => {
      player.current?.dispose();
      player.current = undefined;
    };
  }, [url, type]);
  useEffect(() => {
    const instance = player.current;
    if (!instance) return;
    const locate = () => instance.currentTime(seek / 1000);
    if (instance.readyState() >= 1) locate();
    else instance.one("loadedmetadata", locate);
  }, [seek, url]);
  return <div ref={container} />;
}
export function DocumentView({ id }: { id: string }) {
  const [rebuild, setRebuild] = useState(false);
  const route = usePath();
  const params = new URLSearchParams(location.search);
  const sourceID = params.get("source_ref_id") || "";
  const fileVersion = params.get("file_version_id") || "";
  const doc = useData<Row>("/knowledge/" + id, 5000);
  const source = useData<Row>(sourceID ? "/sources/" + sourceID : "");
  const sourceData = source.data?.knowledge_id === id ? source.data : undefined;
  const versionQuery =
    "file_version_id=" +
    (fileVersion || sourceData?.file_version_id || "") +
    "&parse_version_id=" +
    (params.get("parse_version_id") || sourceData?.parse_version_id || "");
  const hasParse = !!(
    doc.data?.current_parse_version_id ||
    fileVersion ||
    sourceData?.parse_version_id
  );
  const downloadOnly =
    doc.data?.status === "stored" || doc.data?.file_type === "zip";
  const content = useData<Row>(
    hasParse && !downloadOnly
      ? "/knowledge/" + id + "/content?" + versionQuery
      : "",
    5000,
  );
  const outline = useData<Row>(
    hasParse && !downloadOnly
      ? "/knowledge/" + id + "/outline?" + versionQuery
      : "",
    5000,
  );
  const preview = useData<Row>(
    doc.data && !downloadOnly
      ? "/knowledge/" + id + "/preview/manifest?" + versionQuery
      : "",
    5000,
  );
  const [chunkPage, setChunkPage] = useState(1);
  useEffect(() => setChunkPage(1), [id, versionQuery]);
  const chunks = useData<Row[]>(
    hasParse && !downloadOnly
      ? "/knowledge/" +
          id +
          `/chunks?page_size=25&page=${chunkPage}&` +
          versionQuery
      : "",
    5000,
  );
  const related = useData<Row>(
    doc.data && (!sourceID || sourceData)
      ? `/knowledge/${id}/related/stats?${versionQuery}`
      : "",
    5000,
  );
  const relatedQuery = related.data
    ? new URLSearchParams({
        file_version_id: related.data.file_version_id,
        parse_version_id: related.data.parse_version_id,
      }).toString()
    : versionQuery;
  const requestedTab = params.get("tab") || "original";
  const processingTab = [
    "original",
    "content",
    "chunks",
    "images",
    "wiki",
    "graph",
  ].includes(requestedTab)
    ? requestedTab
    : "original";
  const category = sourceID
    ? "processing"
    : params.get("category") === "applications" ||
        (!params.has("category") && requestedTab === "extraction")
      ? "applications"
      : "processing";
  const application =
    documentApplications.find((a) => a.id === params.get("application")) ||
    documentApplications[0];
  const [tab, setTab] = useState(processingTab);
  useEffect(() => setTab(processingTab), [route]);
  function selectCategory(next: string, applicationID = application.id) {
    const q = new URLSearchParams(location.search);
    q.set("category", next);
    if (next === "applications") {
      q.set("application", applicationID);
      if (sourceData) {
        q.set("file_version_id", sourceData.file_version_id);
        q.set("parse_version_id", sourceData.parse_version_id);
      }
      q.delete("source_ref_id");
    } else q.delete("application");
    if (q.get("tab") === "extraction") q.delete("tab");
    navigate(`/documents/${id}?${q}`);
  }
  const relatedTab = tab === "wiki" || tab === "graph";
  const [seek, setSeek] = useState(0);
  const [subtitle, setSubtitle] = useState(false);
  const [offset, setOffset] = useState(0);
  const locator = sourceData?.locators?.[0];
  useEffect(() => {
    if (!locator) return;
    if (locator.type === "time" || locator.type === "frame") {
      setSeek(locator.start_ms ?? locator.time_ms ?? 0);
      setTab("original");
    } else if (locator.type === "sheet") {
      setTab("original");
    } else if (!locator.page && !locator.slide && locator.type !== "image") {
      setTab("content");
      setTimeout(
        () =>
          document
            .getElementById("source-highlight")
            ?.scrollIntoView({ block: "center", behavior: "smooth" }),
        100,
      );
    } else setTab("original");
  }, [source.data]);
  if (!doc.data)
    return doc.loading ? <Busy /> : <ErrorNotice message={doc.error} />;
  const d = doc.data;
  if (downloadOnly) return <StoredDocument doc={d} />;
  const type = preview.data?.type;
  const nativeMedia = ["mp3", "mp4", "wav", "ogg"].includes(type);
  const image = ["png", "jpg", "jpeg", "webp"].includes(type);
  const media = [
    "mp3",
    "mp4",
    "wav",
    "ogg",
    "flac",
    "m4a",
    "aac",
    "mkv",
    "mov",
    "webm",
    "avi",
    "m4v",
  ].includes(d.file_type);
  const selectSource = (sourceId: string) =>
    api<Row>("/sources/" + sourceId)
      .then((source) => navigate(source.preview_url))
      .catch((e) => MessagePlugin.error(e.message));
  return (
    <>
      <div className="page-heading">
        <div>
          <Button
            variant="text"
            size="small"
            onClick={() => navigate("/knowledge-bases/" + d.knowledge_base_id)}
          >
            ← 返回知识库
          </Button>
          <h1 style={{ fontSize: 20 }}>{d.name}</h1>
          <p className="subtitle">
            <Status value={d.status} />{" "}
            {d.relative_path && d.relative_path !== d.name && (
              <span className="help">{d.relative_path} · </span>
            )}
            <span className="help">
              文件版本{" "}
              {(
                fileVersion ||
                sourceData?.file_version_id ||
                d.current_file_version_id
              )?.slice(0, 8)}
            </span>
          </p>
        </div>
        <Space>
          {media && (
            <Button variant="outline" onClick={() => setSubtitle(true)}>
              上传字幕
            </Button>
          )}
          <Button variant="outline" onClick={() => setRebuild(true)}>
            重新处理
          </Button>
          <Button
            href={resourceURL(
              "/api/v1/knowledge/" + id + "/download" + "?" + versionQuery,
            )}
            variant="outline"
          >
            下载源文件
          </Button>
        </Space>
      </div>
      {rebuild && (
        <RebuildDialog
          libraryId={d.knowledge_base_id}
          libraryName="当前知识库"
          document={d}
          onClose={() => setRebuild(false)}
          onSubmitted={doc.reload}
        />
      )}
      <ErrorNotice message={doc.error || source.error} />
      <Tabs
        className="document-category-tabs"
        value={category}
        onChange={(v) => selectCategory(String(v))}
      >
        <TabPanel value="processing" label="数据处理" />
        <TabPanel value="applications" label="扩展应用" />
      </Tabs>
      {category === "applications" ? (
        <section className="document-panel document-application-panel">
          <Tabs
            value={application.id}
            onChange={(v) => selectCategory("applications", String(v))}
          >
            {documentApplications.map((a) => (
              <TabPanel key={a.id} value={a.id} label={a.name} />
            ))}
          </Tabs>
          <Suspense fallback={<Busy />}>
            <application.Content
              id={id}
              parseVersion={
                params.get("parse_version_id") ||
                content.data?.parse_version_id ||
                ""
              }
              Progress={application.Progress}
            />
          </Suspense>
        </section>
      ) : (
        <>
          <DocumentProcessing id={id} name={d.name} />
          <div
            className={`document-grid${type === "spreadsheet" ? " spreadsheet-document-grid" : ""}${relatedTab ? " document-related-grid" : ""}`}
          >
            <aside className="document-panel">
              <div className="toolbar">
                <h3>文件目录</h3>
                <Button
                  size="small"
                  variant="text"
                  onClick={() =>
                    action(() =>
                      send("/knowledge/" + id + "/outline/rebuild", {}),
                    )
                  }
                >
                  重新提取
                </Button>
              </div>
              {outline.data?.structure?.length ? (
                <Tree
                  data={outline.data.structure}
                  keys={{ value: "id", label: "title", children: "children" }}
                  expandAll
                  activable
                  onClick={({ node }) => {
                    const sourceId = node.data.source_ref_id;
                    if (sourceId) selectSource(sourceId);
                    else MessagePlugin.info("该目录项的位置尚未核验");
                  }}
                />
              ) : (
                <p className="help">
                  {outline.data?.status === "empty"
                    ? "未检测到可核验的目录结构"
                    : "目录尚未完成；需要模型的阶段会等待配置。"}
                </p>
              )}
              {outline.data?.status && <Status value={outline.data.status} />}
            </aside>
            <section className="document-panel">
              {content.data?.conversion?.mapping === "converted_structure" && (
                <Alert
                  theme="info"
                  message="当前内容与位置来自 WPS 转换副本，未核验为原文件的精确页码或对象坐标。下载源文件仍返回原始 WPS 文件。"
                  style={{ marginBottom: 12 }}
                />
              )}
              <Tabs
                value={tab}
                onChange={(v) => {
                  const next = String(v);
                  setTab(next);
                  const q = new URLSearchParams(location.search);
                  q.set("category", "processing");
                  q.set("tab", next);
                  q.delete("application");
                  if (next === "wiki" || next === "graph") {
                    q.set("tab", next);
                    // Keep the viewed version but leave the old source selection so
                    // selecting that same citation again can navigate back to it.
                    if (sourceData) {
                      q.set("file_version_id", sourceData.file_version_id);
                      q.set("parse_version_id", sourceData.parse_version_id);
                    }
                    q.delete("source_ref_id");
                  }
                  navigate(`/documents/${id}${q.size ? "?" + q : ""}`);
                }}
              >
                <TabPanel value="original" label="原文预览">
                  <div style={{ paddingTop: 16 }}>
                    {type === "spreadsheet" ? (
                      <SpreadsheetPreview
                        id={id}
                        query={versionQuery}
                        locator={locator}
                      />
                    ) : type === "pdf" ? (
                      <Suspense fallback={<Busy />}>
                        <PdfPreview
                          url={preview.data!.content_url}
                          page={locator?.page || locator?.slide || 1}
                          bbox={locator?.bbox}
                        />
                      </Suspense>
                    ) : nativeMedia ? (
                      <Player
                        url={preview.data!.content_url}
                        type={type}
                        seek={seek}
                      />
                    ) : image ? (
                      <img
                        src={preview.data!.content_url}
                        alt={d.name}
                        style={{ maxWidth: "100%" }}
                      />
                    ) : content.data ? (
                      <ParsedContent
                        text={content.data.content}
                        ocrCleanup={content.data.ocr_cleanup}
                        imageOccurrences={content.data.image_occurrences}
                        renderImages={(images) => (
                          <ChunkImages images={images} />
                        )}
                        start={sourceData?.char_start}
                        end={sourceData?.char_end}
                      />
                    ) : (
                      <Empty
                        title="预览准备中"
                        detail="解析完成后可查看原文或转换后的预览副本。"
                      />
                    )}
                  </div>
                  {media && (
                    <Frames
                      id={id}
                      versionQuery={versionQuery}
                      onSelect={selectSource}
                      onSeek={setSeek}
                    />
                  )}
                  {media && (
                    <Transcript
                      id={id}
                      versionQuery={versionQuery}
                      onSeek={setSeek}
                    />
                  )}
                </TabPanel>
                <TabPanel value="content" label="解析内容">
                  <div style={{ paddingTop: 16 }}>
                    {content.data ? (
                      <ParsedContent
                        focusSourceID={
                          sourceData?.metadata?.derived_from ||
                          sourceData?.source_ref_id
                        }
                        text={content.data.content}
                        ocrCleanup={content.data.ocr_cleanup}
                        imageOccurrences={content.data.image_occurrences}
                        renderImages={(images) => (
                          <ChunkImages images={images} />
                        )}
                        start={sourceData?.char_start}
                        end={sourceData?.char_end}
                      />
                    ) : (
                      <Empty
                        title="正文尚未就绪"
                        detail="查看任务中心中的解析阶段和错误原因。"
                      />
                    )}
                  </div>
                </TabPanel>
                <TabPanel
                  value="chunks"
                  label={`分块 ${(chunks.data as any)?.meta?.total ?? chunks.data?.length ?? ""}`}
                >
                  <div style={{ paddingTop: 16 }}>
                    <ErrorNotice message={chunks.error} />
                    {chunks.data?.map((chunk) => (
                      <div className="result" key={chunk.id}>
                        <div className="toolbar">
                          <span className="help">
                            分块 {chunk.ordinal + 1}
                            {chunk.block_type &&
                              ` · ${({ text: "文字", table: "表格", spreadsheet: "表格", image: "图片" } as Record<string, string>)[chunk.block_type] || chunk.block_type}`}
                            {chunk.locators?.[0]?.sheet &&
                              ` · ${locationLabel(chunk.locators[0])}`}
                            {chunk.locators?.[0]?.page &&
                              ` · 第 ${chunk.locators[0].page} 页`}
                            {chunk.locators?.[0]?.paragraph_id &&
                              chunk.block_type === "image" &&
                              ` · 第 ${chunk.locators[0].paragraph_id} 段`}
                            {chunk.locators?.[0]?.table_id &&
                              chunk.block_type === "image" &&
                              ` · 表 ${chunk.locators[0].table_id} 第 ${chunk.locators[0].row} 行`}
                          </span>
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => selectSource(chunk.source_ref_id)}
                          >
                            定位原文
                          </Button>
                        </div>
                        {!chunk.layout?.reference_only && (
                          <OCRText
                            text={chunk.content}
                            cleanup={chunk.ocr_cleanup}
                          />
                        )}
                        {["image_caption", "frame_caption"].includes(
                          chunk.content_origin,
                        ) && (
                          <p className="help">AI 内容理解 · 模型生成的描述</p>
                        )}
                        <ChunkImages images={chunk.images || []} />
                        {!!chunk.context_source_ref_ids?.length && (
                          <div className="table-context-links">
                            <span className="help">补充上下文来源：</span>
                            {chunk.context_source_ref_ids.map(
                              (sourceId: string, i: number) => (
                                <Button
                                  key={sourceId}
                                  size="small"
                                  variant="text"
                                  onClick={() => selectSource(sourceId)}
                                >
                                  表头 / 合并内容 {i + 1}
                                </Button>
                              ),
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {!!chunks.data?.length && (
                      <Pagination
                        current={chunkPage}
                        pageSize={25}
                        total={
                          (chunks.data as any)?.meta?.total ??
                          chunks.data.length
                        }
                        showPageSize={false}
                        size="small"
                        onCurrentChange={setChunkPage}
                      />
                    )}
                  </div>
                </TabPanel>
                <TabPanel value="images" label="图片与解析">
                  {hasParse ? (
                    <ImageGallery
                      key={id + versionQuery}
                      path={"/knowledge/" + id + "/images?" + versionQuery}
                      requiresReparse={content.data?.requires_image_reparse}
                      warnings={content.data?.warnings || []}
                      documentId={
                        content.data?.parse_version_id ===
                        doc.data?.current_parse_version_id
                          ? id
                          : undefined
                      }
                    />
                  ) : (
                    <Empty
                      title="暂无图片资源"
                      detail="文档解析后会显示图片及解析内容。"
                    />
                  )}
                </TabPanel>
                <TabPanel
                  value="wiki"
                  label={`Wiki${related.data ? ` ${related.data.wiki_pages}` : ""}`}
                >
                  <ErrorNotice message={related.error} />
                  {tab === "wiki" && related.data && (
                    <Suspense fallback={<Busy />}>
                      <DocumentWiki
                        key={id + relatedQuery}
                        id={id}
                        query={relatedQuery}
                        stats={related.data}
                      />
                    </Suspense>
                  )}
                  {tab === "wiki" && !related.data && !related.error && (
                    <Busy />
                  )}
                </TabPanel>
                <TabPanel
                  value="graph"
                  label={`知识图谱${related.data ? ` ${related.data.entities}` : ""}`}
                >
                  <ErrorNotice message={related.error} />
                  {tab === "graph" && related.data && (
                    <Suspense fallback={<Busy />}>
                      <DocumentGraph
                        key={id + relatedQuery}
                        id={id}
                        query={relatedQuery}
                        stats={related.data}
                      />
                    </Suspense>
                  )}
                  {tab === "graph" && !related.data && !related.error && (
                    <Busy />
                  )}
                </TabPanel>
              </Tabs>
            </section>
            <aside className="document-panel document-evidence">
              <h3>来源定位</h3>
              {sourceData && sourceID ? (
                <>
                  <p className="help">{sourceData.file_name}</p>
                  <Status value={sourceData.status} />
                  {sourceData.context_sources?.map((context: Row) => (
                    <Button
                      key={context.source_ref_id}
                      size="small"
                      variant="text"
                      onClick={() => selectSource(context.source_ref_id)}
                    >
                      查看表头 / 合并内容来源
                    </Button>
                  ))}
                  <div className="source-quote">
                    <OCRText
                      key={sourceData.source_ref_id}
                      cleanup={sourceData.ocr_cleanup}
                      text={
                        sourceData.metadata?.layout?.reference_only
                          ? "此来源为文档内嵌图片。"
                          : sourceData.quote ||
                            sourceData.metadata?.generated_text ||
                            "此来源为图片或视频代表帧。"
                      }
                    />
                  </div>
                  {sourceData.partial && (
                    <p className="help">{sourceData.mapping_reason}</p>
                  )}
                  <p>
                    位置：
                    {(sourceData.locators || []).map(locationLabel).join("；")}
                  </p>
                  <p className="help">
                    来源：
                    {(
                      {
                        native: "文件原文",
                        ocr: "图片文字识别",
                        asr: "语音转写",
                        subtitle: "外部字幕",
                        embedded_subtitle: "内嵌字幕",
                        image_caption: "图片模型描述",
                        frame_caption: "画面模型描述",
                        frame_ocr: "视频画面文字识别",
                      } as Record<string, string>
                    )[sourceData.content_origin] || "文件解析"}
                  </p>
                  <p className="help">
                    引用始终关联文件版本；不会将旧位置套到新文件。
                  </p>
                </>
              ) : (
                <Empty
                  title="选择一条来源"
                  detail="点击目录、分块或搜索结果，查看证据和原文位置。"
                />
              )}
            </aside>
          </div>
        </>
      )}
      <Dialog
        header="绑定字幕到当前文件版本"
        visible={subtitle}
        onClose={() => setSubtitle(false)}
        footer={false}
      >
        <p className="help">
          支持 SRT、VTT。字幕会生成新的解析版本，已有引用保留原时间。
        </p>
        <label className="field">
          <span>字幕时间偏移（毫秒）</span>
          <InputNumber value={offset} onChange={(v) => setOffset(Number(v))} />
        </label>
        <Upload
          accept=".srt,.vtt"
          theme="file"
          requestMethod={async (files) => {
            const file = Array.isArray(files) ? files[0] : files;
            try {
              const result = await send("/knowledge/" + id + "/subtitles", {
                file_version_id: d.current_file_version_id,
                format: file.name?.toLowerCase().endsWith(".vtt")
                  ? "vtt"
                  : "srt",
                content: await file.raw!.text(),
                offset_ms: offset,
              });
              MessagePlugin.success("字幕处理任务已创建");
              return { status: "success" as const, response: result };
            } catch (e) {
              return {
                status: "fail" as const,
                error: (e as Error).message,
                response: {},
              };
            }
          }}
        />
      </Dialog>
    </>
  );
}
function Transcript({
  id,
  onSeek,
  versionQuery,
}: {
  id: string;
  versionQuery: string;
  onSeek: (time: number) => void;
}) {
  const [page, setPage] = useState(1);
  const transcript = useData<Row[]>(
    "/knowledge/" +
      id +
      "/media/transcript?page_size=50&page=" +
      page +
      "&" +
      versionQuery,
    10000,
  );
  return (
    <div style={{ marginTop: 24 }}>
      <h3>转写与时间定位</h3>
      <Space>
        <Button
          size="small"
          variant="text"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          上一组
        </Button>
        <span className="help">第 {page} 组</span>
        <Button
          size="small"
          variant="text"
          disabled={(transcript.data?.length || 0) < 50}
          onClick={() => setPage((p) => p + 1)}
        >
          下一组
        </Button>
      </Space>
      {transcript.data?.length ? (
        transcript.data.map((line) => (
          <div key={line.id} className="transcript-line">
            <Button
              size="small"
              variant="text"
              onClick={() => onSeek(line.locators[0].start_ms)}
            >
              {timeLabel(line.locators[0].start_ms)}
            </Button>
            <span>{line.quote}</span>
          </div>
        ))
      ) : (
        <p className="help">
          没有已完成的转写片段。请配置提供分段时间戳的 ASR 模型。
        </p>
      )}
    </div>
  );
}

function Frames({
  id,
  versionQuery,
  onSelect,
  onSeek,
}: {
  id: string;
  versionQuery: string;
  onSelect: (id: string) => void;
  onSeek: (at: number) => void;
}) {
  const frames = useData<Row[]>(
    "/knowledge/" + id + "/frames?page_size=100&" + versionQuery,
    10000,
  );
  if (!frames.data?.length) return null;
  return (
    <div style={{ marginTop: 20 }}>
      <h3>代表帧</h3>
      <div
        style={{
          display: "flex",
          gap: 12,
          overflowX: "auto",
          padding: "12px 0",
        }}
      >
        {frames.data.map((frame) => (
          <div key={frame.id} style={{ minWidth: 140 }}>
            <Image
              src={frame.url}
              style={{ width: 140, height: 90 }}
              fit="contain"
            />
            <Button
              variant="text"
              size="small"
              onClick={() =>
                frame.source_refs?.length
                  ? onSelect(frame.source_refs[0].source_ref_id)
                  : onSeek(frame.metadata.time_ms)
              }
            >
              {timeLabel(frame.metadata.time_ms)}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
