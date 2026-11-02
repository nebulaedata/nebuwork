import { Button } from "tdesign-react";
import { Row, stateLabel } from "./api";
import { stageLabel } from "./ProcessingPipeline";
import { ErrorNotice } from "./ui";

export const documentStatusOptions = [
  ["", "全部状态"],
  ["processing", "处理中"],
  ["parsing", "正在解析原文"],
  ["queued", "排队中"],
  ["pausing", "正在暂停"],
  ["paused", "已暂停"],
  ["succeeded", "已完成"],
  ["partially_failed", "部分失败"],
  ["failed", "失败"],
  ["waiting_configuration", "待配置"],
  ["stopping", "正在终止"],
  ["cancelled", "已取消"],
  ["stored", "仅保存，暂不解析"],
  ["extracted", "已解压"],
  ["partially_extracted", "部分解压"],
  ["deleting", "删除中"],
];
export function documentStatusCount(
  data: Row | undefined,
  status: string,
): number | undefined {
  if (!data) return undefined;
  if (!status) return data.total_documents;
  if (status === "parsing") return data.parsing_documents || 0;
  return data.counts?.[status] || 0;
}
const countText = (value: number | undefined) =>
  value == null ? "—" : value.toLocaleString();

export function KnowledgeProgress({
  data,
  error,
  selected,
  onFilter,
  onRefresh,
}: {
  data?: Row;
  error: string;
  selected: string;
  onFilter: (value: string) => void;
  onRefresh: () => void;
}) {
  const counts = data?.counts || {};
  const state = counts.pausing
    ? "pausing"
    : data?.tasks_paused
      ? "paused"
      : counts.processing
        ? "processing"
        : counts.stopping
          ? "stopping"
          : counts.queued
            ? "queued"
            : counts.waiting_configuration
              ? "waiting_configuration"
              : counts.failed || counts.partially_failed
                ? "partially_failed"
                : data?.processable_documents &&
                    data.completed_documents === data.processable_documents
                  ? "succeeded"
                  : counts.cancelled
                    ? "cancelled"
                    : "";
  const percentage = data?.completion_percent;
  const chips = [
    "",
    "processing",
    "queued",
    "pausing",
    "paused",
    "succeeded",
    "partially_failed",
    "failed",
    "waiting_configuration",
    "stopping",
    "cancelled",
  ];
  return (
    <section className="section knowledge-progress" aria-label="知识库处理进度">
      <div className="knowledge-progress-heading">
        <div>
          <h3>知识库处理进度</h3>
          <span className="help">
            {data
              ? state
                ? stateLabel(state)
                : "暂无待处理任务"
              : "正在读取进度…"}{" "}
            · 每 5 秒更新
          </span>
        </div>
        <Button variant="text" onClick={onRefresh}>
          刷新进度
        </Button>
      </div>
      {data && (
        <>
          <div className="knowledge-progress-totals">
            <b>
              全部处理阶段已完成 {countText(data.completed_documents)} /{" "}
              {countText(data.processable_documents)} 个文档
            </b>
            <strong>
              {percentage == null ? "暂无可处理文档" : `${percentage}%`}
            </strong>
          </div>
          {percentage != null && (
            <div
              className="knowledge-progress-track"
              role="progressbar"
              aria-label="全部阶段完成率"
              aria-valuenow={percentage}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div style={{ width: `${percentage}%` }} />
            </div>
          )}
          {data.parse_availability_percent != null && (
            <>
              <div className="knowledge-parse-totals">
                <span>
                  已有原文解析结果 {countText(data.parsed_documents)} /{" "}
                  {countText(data.processable_documents)} 个文档
                </span>
                <b>{data.parse_availability_percent}%</b>
              </div>
              <div
                className="knowledge-progress-track is-parse"
                role="progressbar"
                aria-label="原文解析结果可用率"
                aria-valuenow={data.parse_availability_percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div style={{ width: `${data.parse_availability_percent}%` }} />
              </div>
            </>
          )}
          <p className="help knowledge-progress-explanation">
            完成率按全部处理阶段成功的文档统计；原文解析数量包含已有版本
            {data.excluded_documents
              ? `；ZIP、仅保存及删除中的 ${countText(data.excluded_documents)} 个文件另计`
              : ""}
            。
          </p>
          {Object.keys(data.running_stages || {}).length > 0 && (
            <p className="knowledge-running-stages">
              正在执行：
              {Object.entries(data.running_stages)
                .map(([stage, n]) => `${stageLabel(stage)} ${n} 个`)
                .join(" · ")}
            </p>
          )}
        </>
      )}
      <div className="knowledge-status-chips" aria-label="按处理状态筛选">
        {chips.map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={selected === value}
            onClick={() => onFilter(value)}
          >
            <span>{value ? stateLabel(value) : "全部"}</span>
            <b>{countText(documentStatusCount(data, value))}</b>
          </button>
        ))}
      </div>
      <ErrorNotice message={error} />
    </section>
  );
}
