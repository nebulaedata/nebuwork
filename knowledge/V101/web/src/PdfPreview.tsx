import { resourceURL } from "./integration";
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Button, InputNumber, Space, Select } from "tdesign-react";
import "react-pdf/dist/Page/TextLayer.css";
import { ErrorNotice } from "./ui";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
const options = {
  cMapUrl: resourceURL("/pdfjs/cmaps/"),
  standardFontDataUrl: resourceURL("/pdfjs/standard_fonts/"),
  wasmUrl: resourceURL("/pdfjs/wasm/"),
};
export default function PdfPreview({
  url,
  page: requested,
  bbox,
}: {
  url: string;
  page: number;
  bbox?: number[];
}) {
  const [page, setPage] = useState(requested);
  const [count, setCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(500);
  const [error, setError] = useState("");
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => setPage(requested), [requested, url]);
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(200, entries[0].contentRect.width)),
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={container}>
      <Space breakLine style={{ marginBottom: 12 }}>
        <Button
          size="small"
          variant="outline"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          上一页
        </Button>
        <InputNumber
          aria-label="PDF 页码"
          size="small"
          min={1}
          max={count || 1}
          value={page}
          onChange={(p) => setPage(Number(p))}
        />
        <span className="help">/ {count || "—"} 页</span>
        <Button
          size="small"
          variant="outline"
          disabled={page >= count}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </Button>
        <Select
          size="small"
          aria-label="PDF 缩放"
          style={{ width: 90 }}
          value={zoom}
          onChange={(v) => setZoom(Number(v))}
          options={[
            { value: 1, label: "适合宽度" },
            { value: 1.5, label: "150%" },
            { value: 2, label: "200%" },
            { value: 3, label: "300%" },
          ]}
        />
      </Space>
      <ErrorNotice message={error} />
      <Document
        file={url}
        options={options}
        onLoadSuccess={({ numPages }) => {
          setCount(numPages);
          setPage((p) => Math.max(1, Math.min(p, numPages)));
          setError("");
        }}
        onLoadError={() => setError("PDF 预览加载失败，可下载源文件查看。")}
        loading="正在加载 PDF…"
      >
        <Page
          pageNumber={page}
          width={width * zoom}
          renderTextLayer
          renderAnnotationLayer={false}
          className="pdf-source-page"
        >
          {page === requested &&
            bbox?.length === 4 &&
            bbox.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) &&
            bbox[2] > bbox[0] &&
            bbox[3] > bbox[1] && (
              <div
                aria-label="原文版面区域"
                className="pdf-source-region"
                style={{
                  left: `${bbox[0] * 100}%`,
                  top: `${bbox[1] * 100}%`,
                  width: `${(bbox[2] - bbox[0]) * 100}%`,
                  height: `${(bbox[3] - bbox[1]) * 100}%`,
                }}
              />
            )}
        </Page>
      </Document>
    </div>
  );
}
