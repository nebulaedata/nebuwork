import { useRef, useState, type CSSProperties } from "react";
import { Button, Progress, Space, Table, Tag, Upload } from "tdesign-react";
import { FolderIcon, UploadIcon } from "tdesign-icons-react";
import { Row } from "./api";
import { ErrorNotice, formatBytes, useData } from "./ui";
import { isTemporaryFile, uploadResumable } from "./upload";
import { createId } from "./id";

type Item = {
  id: string;
  file: File;
  path: string;
  state: "waiting" | "uploading" | "success" | "failed" | "skipped";
  progress: number;
  result?: Row;
  error?: string;
};

export function UploadFiles({
  kb,
  onUploaded,
  onBusy,
}: {
  kb: string;
  onUploaded: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const policy = useData<Row>("/uploads/policy");
  const queue = useRef<Item[]>([]);
  const running = useRef(false);
  const [items, setItems] = useState<Item[]>([]);
  const [filteredCount, setFilteredCount] = useState(0);
  const refresh = () => setItems(queue.current.map((item) => ({ ...item })));
  async function drain() {
    if (running.current) return;
    running.current = true;
    onBusy(true);
    try {
      let item: Item | undefined;
      while (
        (item = queue.current.find((entry) => entry.state === "waiting"))
      ) {
        const current = item;
        current.state = "uploading";
        refresh();
        try {
          current.result = await uploadResumable(
            kb,
            current.file,
            (progress) => {
              current.progress = progress;
              refresh();
            },
          );
          current.state =
            current.result?.state === "skipped" ? "skipped" : "success";
        } catch (error) {
          current.state = "failed";
          current.error = (error as Error).message;
        }
        refresh();
        onUploaded();
      }
    } finally {
      running.current = false;
      onBusy(false);
    }
  }
  function select(files: File[]) {
    let filtered = 0;
    for (const file of files) {
      if (isTemporaryFile(file.name)) {
        filtered++;
        continue;
      }
      const path = file.webkitRelativePath || file.name;
      // Different folders may contain identical names and bytes.
      const existing = queue.current.find(
        (item) =>
          item.path === path &&
          item.file.size === file.size &&
          item.file.lastModified === file.lastModified,
      );
      if (existing) {
        if (existing.state === "failed") {
          existing.state = "waiting";
          existing.error = undefined;
        }
        continue;
      }
      queue.current.push({
        id: createId(),
        file,
        path,
        state: "waiting",
        progress: 0,
      });
    }
    setFilteredCount((count) => count + filtered);
    refresh();
    void drain();
  }
  const picker = {
    multiple: true,
    autoUpload: false,
    files: [],
    allowUploadDuplicateFile: true,
    // TDesign handles file selection; the shared queue owns resumable transfers.
    beforeAllFilesUpload: () => false,
    onSelectChange: select,
    showUploadProgress: false,
  };
  const done = items.filter((item) => item.state === "success").length;
  const skipped = items.filter((item) => item.state === "skipped").length;
  return (
    <div className="field-stack">
      <ErrorNotice message={policy.error} />
      <Space>
        <Upload {...picker}>
          <Button icon={<UploadIcon />}>选择文件 / ZIP</Button>
        </Upload>
        <Upload
          {...picker}
          ref={(instance) => {
            // TDesign 1.18 declares inputAttributes but does not forward them yet.
            // Its public upload ref exposes the component's own file input.
            instance?.upload?.setAttribute("webkitdirectory", "");
            instance?.upload?.setAttribute("directory", "");
          }}
          inputAttributes={
            { webkitdirectory: "", directory: "" } as CSSProperties
          }
        >
          <Button variant="outline" icon={<FolderIcon />}>
            选择文件夹
          </Button>
        </Upload>
      </Space>
      <Upload
        {...picker}
        draggable
        theme="custom"
        dragContent="拖入文件或 ZIP，支持一次选择多个文件"
      />
      <p className="help" style={{ margin: 0 }}>
        文件夹保留相对路径；ZIP
        自动递归解压，原压缩包同时保留。上传和解压时自动过滤以 ~$ 开头的 Office
        临时文件。其他不支持的格式和空文件也会保存，暂不解析。空文件夹不会创建文档。
      </p>
      {filteredCount + skipped > 0 && (
        <p className="help" role="status">
          已自动过滤 {filteredCount + skipped} 个 Office 临时文件（~$ 开头）
        </p>
      )}
      {policy.data && (
        <p className="help" style={{ margin: 0 }}>
          单文件 {formatBytes(policy.data.file_max_bytes)}，音视频 / ZIP{" "}
          {formatBytes(policy.data.media_max_bytes)} /{" "}
          {formatBytes(policy.data.archive_max_bytes)}。 ZIP 最多{" "}
          {policy.data.archive_max_depth} 层、{policy.data.archive_max_entries}{" "}
          个条目、累计展开 {formatBytes(policy.data.archive_max_expanded_bytes)}
          。中断后选择同一文件可续传。
        </p>
      )}
      {items.length > 0 && (
        <>
          <div className="toolbar">
            <span>
              已保存 {done} / {items.length - skipped} 个文件
            </span>
            <span className="help">解压和解析进度请在任务中心查看</span>
          </div>
          <Table
            rowKey="id"
            size="small"
            data={items}
            maxHeight={300}
            columns={[
              { colKey: "path", title: "文件 / 相对路径", ellipsis: true },
              {
                colKey: "state",
                title: "上传状态",
                width: 185,
                cell: ({ row }) => {
                  if (row.state === "uploading")
                    return <Progress percentage={row.progress} size="small" />;
                  if (row.state === "failed")
                    return (
                      <span title={row.error}>
                        <Tag theme="danger">上传失败</Tag>
                      </span>
                    );
                  if (row.state === "waiting") return <Tag>等待上传</Tag>;
                  if (row.state === "skipped") return <Tag>已过滤临时文件</Tag>;
                  return (
                    <Tag theme="success">
                      {row.result?.state === "stored"
                        ? "已保存，暂不解析"
                        : row.file.name.toLowerCase().endsWith(".zip")
                          ? "已上传，等待解压"
                          : "已上传，等待处理"}
                    </Tag>
                  );
                },
              },
              {
                colKey: "action",
                title: "操作",
                width: 65,
                cell: ({ row }) =>
                  row.state === "failed" && (
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => {
                        const item = queue.current.find(
                          (item) => item.id === row.id,
                        )!;
                        item.state = "waiting";
                        item.error = undefined;
                        refresh();
                        void drain();
                      }}
                    >
                      重试
                    </Button>
                  ),
              },
            ]}
          />
          {items
            .filter((item) => item.error)
            .map((item) => (
              <ErrorNotice
                key={item.id}
                message={`${item.path}：${item.error}`}
              />
            ))}
        </>
      )}
    </div>
  );
}
