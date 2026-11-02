import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  Image,
  ImageViewer,
  Tabs,
  Pagination,
  Tag,
  Tooltip,
  MessagePlugin,
} from "tdesign-react";
import { BrowseIcon, ImageIcon } from "tdesign-icons-react";
import { api, Row } from "./api";
import {
  Busy,
  Empty,
  ErrorNotice,
  locationLabel,
  navigate,
  useData,
} from "./ui";
import { OCRText, RichContent } from "./ParsedContent";

export function imageLabel(image: Row) {
  const position = image.locators?.[0] || image.metadata || {};
  const converted = position.mapping === "converted_structure" ? "转换后 · " : "";
  if (position.page) {
    const label = image.metadata?.layout?.label;
    return `${converted}第 ${position.page} 页 · ${label === "chart" ? "图表" : label === "seal" ? "印章" : position.bbox ? "区域图片" : "内嵌图片"}`;
  }
  if (image.kind === "video_frame")
    return `视频代表帧 · ${locationLabel({ type: "frame", ...position })}`;
  if (position.slide) return `${converted}第 ${position.slide} 张幻灯片 · 内嵌图片`;
  if (position.sheet) return `${converted}${position.sheet}${position.cell_range ? ` · ${position.cell_range}` : ""} · 内嵌图片`;
  if (position.chapter) return `章节 ${position.chapter} · 内嵌图片`;
  if (position.paragraph_id) return `${converted}第 ${position.paragraph_id} 段 · 内嵌图片`;
  if (position.table_id)
    return `${converted}表 ${position.table_id} · 第 ${position.row} 行 · 内嵌图片`;
  return position.part ? `内嵌图片 · ${position.part}` : "图片";
}
export async function openImageSource(sourceId: string) {
  try {
    const source = await api<Row>("/sources/" + sourceId);
    navigate(source.preview_url);
  } catch (e) {
    MessagePlugin.error((e as Error).message);
  }
}

export function ImageDetails({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const detail = useData<Row>(id ? "/images/" + id : "", 5000);
  const [zoom, setZoom] = useState(false);
  const data = detail.data;
  const descriptions: Row[] =
    data?.source_refs?.filter((s: Row) =>
      ["image_caption", "frame_caption"].includes(s.origin),
    ) || [];
  return (
    <Dialog
      visible={!!id}
      header="图片与解析内容"
      placement="center"
      width="min(1120px, calc(100vw - 40px))"
      footer={false}
      closeOnOverlayClick={false}
      onClose={onClose}
      className="image-detail-dialog"
    >
      <ErrorNotice message={detail.error} />
      {!data ? (
        !detail.error && <Busy />
      ) : (
        <>
          <div className="image-detail-meta">
            <Tooltip content={data.name}>
              <span>{data.name}</span>
            </Tooltip>
            <Tag variant="light">{imageLabel(data)}</Tag>
          </div>
          <div className="image-detail-layout">
            <div className="image-detail-preview">
              <Image
                src={data.content_url}
                alt={imageLabel(data)}
                fit="contain"
              />
              <div className="image-detail-actions">
                <Button
                  size="small"
                  variant="outline"
                  icon={<BrowseIcon />}
                  onClick={() => setZoom(true)}
                >
                  放大查看
                </Button>
                <Button
                  size="small"
                  variant="outline"
                  disabled={!data.source_ref_id}
                  onClick={() => {
                    onClose();
                    openImageSource(data.source_ref_id);
                  }}
                >
                  定位原文
                </Button>
              </div>
              {data.locators?.[0]?.page && data.locators?.[0]?.bbox && (
                <p className="help">
                  此图按版面区域裁剪；定位原文可查看原页并高亮图片区域。
                </p>
              )}
            </div>
            <div className="image-detail-text">
              <Tabs defaultValue="ocr">
                <Tabs.TabPanel value="ocr" label="文字识别 / 提取内容">
                  <section>
                    <p className="help">
                      解析引擎从此图片区域提取的内容；不包含整页的其他文字。
                    </p>
                    {data.recognized_text ? (
                      <OCRText key={data.id} text={data.recognized_text} cleanup={data.ocr_cleanup} />
                    ) : (
                      <p className="image-no-result">
                        暂无已提取的文字。图片已保留，可查看原图。
                      </p>
                    )}
                  </section>
                </Tabs.TabPanel>
                <Tabs.TabPanel
                  value="caption"
                  label={`AI 内容理解${descriptions.length ? " · 已生成" : ""}`}
                >
                  <section>
                    <p className="help">
                      模型生成的描述，与原文提取内容分开保存。
                    </p>
                    {descriptions.length ? (
                      descriptions.map((source) => (
                        <div key={source.source_ref_id}>
                          <RichContent
                            text={source.generated_text || source.quote || ""}
                          />
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => {
                              onClose();
                              openImageSource(source.source_ref_id);
                            }}
                          >
                            查看描述来源
                          </Button>
                        </div>
                      ))
                    ) : (
                      <p className="image-no-result">
                        尚无已生成的描述。可在处理流水线查看图片内容理解阶段的状态。
                      </p>
                    )}
                  </section>
                </Tabs.TabPanel>
              </Tabs>
              <p className="help image-version">
                文件版本 {data.file_version_id?.slice(0, 8)} · 解析版本{" "}
                {data.parse_version_id?.slice(0, 8)}
              </p>
            </div>
          </div>
          {zoom && (
            <ImageViewer
              visible={zoom}
              images={[data.content_url]}
              title={imageLabel(data)}
              trigger={<></>}
              closeOnOverlay={false}
              onClose={() => setZoom(false)}
              zIndex={6000}
            />
          )}
        </>
      )}
    </Dialog>
  );
}

export function ChunkImages({ images }: { images: Row[] }) {
  const [selected, setSelected] = useState("");
  if (!images.length) return null;
  return (
    <div className="chunk-images">
      {images.map((image) => (
        <div className="chunk-image" key={image.id}>
          <Button
            variant="text"
            className="image-thumb-button"
            onClick={() => setSelected(image.id)}
            aria-label={`查看${imageLabel(image)}及解析内容`}
          >
            <Image
              src={image.content_url}
              alt={imageLabel(image)}
              fit="contain"
              lazy
            />
          </Button>
          <div className="chunk-image-caption">
            <span className="help">{imageLabel(image)}</span>
            <Button
              size="small"
              variant="text"
              onClick={() => setSelected(image.id)}
            >
              图片解析
            </Button>
          </div>
        </div>
      ))}
      {selected && (
        <ImageDetails id={selected} onClose={() => setSelected("")} />
      )}
    </div>
  );
}

export function ImageGallery({
  path,
  fileNames = false,
  requiresReparse = false,
  warnings = [],
  documentId,
}: {
  path: string;
  fileNames?: boolean;
  requiresReparse?: boolean;
  warnings?: Row[];
  documentId?: string;
}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState("");
  const [repairing, setRepairing] = useState(false);
  const images = useData<Row[]>(
    path + (path.includes("?") ? "&" : "?") + `page_size=12&page=${page}`,
    5000,
  );
  const total = (images.data as any)?.meta?.total ?? 0;
  return (
    <div className="image-gallery">
      <div className="toolbar">
        <div>
          <h3>
            <ImageIcon /> 图片与解析内容{" "}
            <span className="help">{images.data ? `共 ${total} 张` : ""}</span>
          </h3>
          <p className="help">
            查看页内裁剪图片、文档内嵌图片和视频代表帧，以及提取内容和 AI
            理解结果。整页图仅用于原文预览。
          </p>
        </div>
        {documentId && <Button variant="outline" loading={repairing} disabled={!total} onClick={async () => {
          setRepairing(true);
          try {
            await api(`/knowledge/${documentId}/images/rebuild`, { method:"POST" });
            MessagePlugin.success("已创建图片理解补充任务，已有描述会保留，可在任务中心查看进度。");
          } catch(e) { MessagePlugin.error((e as Error).message); }
          finally { setRepairing(false); }
        }}>补充图片理解</Button>}
      </div>
      {requiresReparse && (
        <Alert
          theme="info"
          message="此文件使用旧版整页识别结果。点击文档右上角“重新处理”，可提取页内图片及其区域位置；原文预览仍可使用。"
        />
      )}
      {!!warnings.length && (
        <Alert
          theme="warning"
          message={Array.from(new Set(warnings.map((w) => w.code === "OCR_QUALITY_SUSPECT" ? (w.message || "部分区域的 OCR 疑似异常，请查看对应图片核验；原始内容和定位已保留。") : w.code === "PAGE_IMAGE_NOT_CROPPED" ? `第 ${w.page} 页被识别为整页图片，已跳过图片理解，请检查版面检测结果。` : w.code === "IMAGE_ASSET_UNAVAILABLE" ? "部分图片资源缺失或无法转换，已保留其他解析结果。" : w.code === "IMAGE_EXTRACTION_FAILED" ? "部分内嵌图片提取失败，文字解析已保留。可重试或更换解析引擎。" : w.code === "EXTERNAL_IMAGE_NOT_FETCHED" ? "文件引用了未随文件上传的图片，未自动下载外部资源。" : (w.message || `图片提取提示：${w.code}`)))).join(" ")}
        />
      )}
      <ErrorNotice message={images.error} />
      {!images.data && !images.error ? (
        <Busy />
      ) : images.data?.length ? (
        <>
          <div className="image-gallery-grid">
            {images.data.map((image) => (
              <article className="image-card" key={image.id}>
                <Button
                  variant="text"
                  className="image-thumb-button"
                  onClick={() => setSelected(image.id)}
                  aria-label={`查看${imageLabel(image)}及解析内容`}
                >
                  <Image
                    src={image.content_url}
                    alt={imageLabel(image)}
                    fit="contain"
                    lazy
                  />
                </Button>
                <div className="image-card-info">
                  <strong>{imageLabel(image)}</strong>
                  {fileNames && (
                    <Tooltip content={image.name}>
                      <p className="image-file-name">{image.name}</p>
                    </Tooltip>
                  )}
                  <div className="image-card-footer">
                    <Tag
                      theme={image.caption_ready ? "success" : "default"}
                      variant="light"
                      size="small"
                    >
                      {image.caption_ready ? "已有 AI 描述" : "暂无 AI 描述"}
                    </Tag>
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => setSelected(image.id)}
                    >
                      查看解析
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <Pagination
            current={page}
            pageSize={12}
            total={total}
            showPageSize={false}
            onCurrentChange={setPage}
            size="small"
          />
        </>
      ) : (
        !images.error && (
          <Empty
            title="暂无图片资源"
            detail="仅展示实际提取的图片；纯文字或表格页面不会生成图片。旧版 PDF 需重新处理后提取页内图片。"
          />
        )
      )}
      {selected && (
        <ImageDetails id={selected} onClose={() => setSelected("")} />
      )}
    </div>
  );
}
