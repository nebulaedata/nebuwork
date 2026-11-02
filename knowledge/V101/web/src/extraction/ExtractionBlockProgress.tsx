import { Table, Tag } from "tdesign-react";
import { type Row, stateLabel } from "../api";
import { useData } from "../ui";
import "./extraction.css";

const phases: Record<string, string> = {
  block_attempt: "准备提取",
  v3_extract: "模型抽取",
  validation: "程序校验",
  v3_repair: "必要修复",
  v3_gap_check: "空结果复查",
  coverage: "覆盖检查",
  block_save: "保存分块",
  retry_wait: "等待重试",
  split: "拆分过长分块",
  finished: "处理结束",
  skipped: "已跳过元信息",
  reused: "已复用结果",
  model_retry_wait: "模型调用等待重试",
  model_schema_repair: "结构化输出修复",
};

export function ExtractionBlockProgress({ task }: { task: Row }) {
  const recorded = task.checkpoint?.extraction;
  const legacy = useData<Row>(
    typeof recorded?.total_blocks !== "number" && task.config?.run_id
      ? "/extractions/" + task.config.run_id
      : "",
  );
  const p: Row | undefined =
    typeof recorded?.total_blocks === "number"
      ? recorded
      : legacy.data
        ? {
            total_blocks: legacy.data.blocks,
            completed_blocks: legacy.data.completed_blocks,
            failed_blocks: legacy.data.failed_blocks,
            records: legacy.data.records,
            needs_review: legacy.data.needs_review,
          }
        : undefined;
  if (!p) return null;
  const active: Row[] = p.active_blocks || [];
  const recent: Row[] = p.recent_blocks || [];
  return (
    <div className="extraction-block-progress">
      <p className="help">
        分块：已完成 {p.completed_blocks} / {p.total_blocks} · 失败{" "}
        {p.failed_blocks}
        {typeof p.reused_blocks === "number"
          ? ` · 本次复用 ${p.reused_blocks} · 本次跳过 ${p.skipped_blocks}`
          : ""}{" "}
        · 已保存 {p.records} 条 · 待核验 {p.needs_review} 条
      </p>
      {!!(active.length || recent.length) && (
        <details open={active.length > 0}>
          <summary>
            分块详情 · 当前并行 {active.length} 个 · 最近处理 {recent.length} 个
          </summary>
          <Table
            rowKey="root_id"
            size="small"
            tableLayout="fixed"
            data={[
              ...active,
              ...[...recent]
                .reverse()
                .filter((b) => !active.some((a) => a.root_id === b.root_id)),
            ]}
            columns={[
              {
                colKey: "block_id",
                title: "分块",
                width: 160,
                cell: ({ row }) => (
                  <span title={row.root_id}>{row.block_id}</span>
                ),
              },
              {
                colKey: "phase",
                title: "当前步骤",
                width: 150,
                cell: ({ row }) =>
                  phases[row.phase] ||
                  (row.phase?.includes("repair")
                    ? "结构化输出修复"
                    : row.phase),
              },
              {
                colKey: "status",
                title: "状态",
                width: 90,
                cell: ({ row }) => (
                  <Tag
                    theme={
                      row.status === "running"
                        ? "primary"
                        : row.status === "failed"
                          ? "danger"
                          : "default"
                    }
                  >
                    {row.reused ? "已复用" : stateLabel(row.status)}
                  </Tag>
                ),
              },
              {
                colKey: "attempt",
                title: "重试",
                width: 120,
                cell: ({ row }) =>
                  row.reused
                    ? "—"
                    : row.model_attempt
                      ? `模型已尝试 ${row.model_attempt} 次`
                      : row.attempt > 1
                        ? `分块 ${row.attempt - 1} / ${row.max_retries}`
                        : row.phase === "retry_wait"
                          ? `等待 ${row.attempt} / ${row.max_retries}`
                          : "首次执行",
              },
              {
                colKey: "error",
                title: "详情",
                cell: ({ row }) =>
                  row.error ||
                  (row.reused ? "复用已保存结果，不重复执行" : "—"),
              },
            ]}
          />
          <p className="help">
            展示当前并行分块及最近 20 个已结束分块；完整质量问题见“覆盖与问题”。
          </p>
        </details>
      )}
    </div>
  );
}
