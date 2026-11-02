import { resourceURL } from "./integration";
import { Button, Space, Table } from "tdesign-react";
import { Row, send } from "./api";
import {
  action,
  ErrorNotice,
  formatBytes,
  navigate,
  Status,
  useData,
} from "./ui";

export function ArchiveReport({ report }: { report: Row }) {
  return (
    <div style={{ marginTop: 16 }}>
      <h3>解压报告</h3>
      <p className="help">
        已保存 {report.files || 0} 个文件 · 累计展开{" "}
        {formatBytes(report.expanded_bytes || 0)} · {report.issue_count || 0}{" "}
        个条目未展开
        {!!report.skipped_files && (
          <> · 已过滤 {report.skipped_files} 个 Office 临时文件</>
        )}
      </p>
      {!!report.issues?.length && (
        <Table
          rowKey="path"
          size="small"
          data={report.issues}
          maxHeight={260}
          columns={[
            { colKey: "path", title: "压缩包内路径", ellipsis: true },
            { colKey: "reason", title: "说明" },
          ]}
        />
      )}
      {report.issue_count > 100 && (
        <p className="help">仅展示前 100 条记录，其余内容仍保留在原 ZIP 中。</p>
      )}
    </div>
  );
}

export function StoredDocument({ doc }: { doc: Row }) {
  const archive = doc.file_type === "zip";
  const tasks = useData<Row[]>(
    archive ? "/knowledge/" + doc.id + "/stages" : "",
    3000,
  );
  const extraction = tasks.data?.find(
    (task) => task.type === "extract_archive",
  );
  const reasons: Record<string, string> = {
    unsupported_format:
      "当前格式暂不支持解析。源文件已完整保存，可随时下载；不会创建解析任务。",
    empty_file: "这是一个空文件，已保留原文件，暂不解析。",
    media_disabled:
      "当前知识库已关闭音视频处理。源文件已保存，启用后可重新处理。",
    archive_pending:
      "此压缩包由上层 ZIP 的任务递归处理，进度与错误请查看上层压缩包。",
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <Button
            variant="text"
            size="small"
            onClick={() =>
              navigate("/knowledge-bases/" + doc.knowledge_base_id)
            }
          >
            ← 返回知识库
          </Button>
          <h1>{doc.name}</h1>
          <p className="subtitle">
            <Status value={doc.status} />{" "}
            <span className="help">{doc.relative_path}</span>
          </p>
        </div>
        <Space>
          {doc.storage_reason === "media_disabled" && (
            <Button
              variant="outline"
              onClick={() =>
                action(() => send("/knowledge/" + doc.id + "/reparse", {}))
              }
            >
              重新处理
            </Button>
          )}
          <Button
            variant="outline"
            href={resourceURL("/api/v1/knowledge/" + doc.id + "/download")}
          >
            下载源文件
          </Button>
        </Space>
      </div>
      <div className="section">
        <h2>{archive ? "ZIP 压缩包" : "源文件已保存"}</h2>
        <p className="help">
          {reasons[doc.storage_reason] ||
            "原 ZIP 已保留。递归解压得到的文件会独立列在知识库中，支持的文件自动进入解析流程；其他文件只保存。"}
        </p>
        {doc.source_archive_id && (
          <Button
            variant="text"
            onClick={() => navigate("/documents/" + doc.source_archive_id)}
          >
            查看来源压缩包
          </Button>
        )}
        <ErrorNotice message={tasks.error || extraction?.error?.message} />
        {extraction?.checkpoint?.archive_report && (
          <ArchiveReport report={extraction.checkpoint.archive_report} />
        )}
        {extraction && (
          <div className="form-actions">
            {["queued", "running"].includes(extraction.state) && (
              <Button
                variant="outline"
                onClick={() =>
                  action(
                    () => send("/tasks/" + extraction.id + "/cancel", {}),
                    tasks.reload,
                  )
                }
              >
                取消解压
              </Button>
            )}
            {["failed", "partially_failed", "cancelled"].includes(
              extraction.state,
            ) && (
              <Button
                onClick={() =>
                  action(
                    () => send("/tasks/" + extraction.id + "/retry", {}),
                    tasks.reload,
                  )
                }
              >
                重试解压
              </Button>
            )}
            <Button variant="outline" onClick={() => navigate("/tasks")}>
              查看任务中心
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
