import { useState } from "react";
import { Button, Dialog } from "tdesign-react";
import type { ApplicationProgressProps } from "../DocumentApplications";
import { type Row, stateLabel } from "../api";
import { Busy, ErrorNotice } from "../ui";
import {
  currentWork,
  PipelineView,
  useTaskStream,
} from "../ProcessingPipeline";

export function extractionSummary(task?: Row, run?: Row) {
  if (!task && !run) return "尚未提取，需手动启动";
  const p = task?.checkpoint?.extraction;
  return [
    task
      ? currentWork(task)
      : run?.state === "running"
        ? "提取中"
        : run?.state === "partially_failed"
          ? "部分完成"
          : stateLabel(run?.state),
    (p?.total_blocks ?? run?.blocks ?? 0) > 0
      ? `已完成 ${p?.completed_blocks ?? run?.completed_blocks ?? 0} / ${p?.total_blocks ?? run?.blocks} 块`
      : "分块计划待生成",
    `失败 ${p?.failed_blocks ?? run?.failed_blocks ?? 0} 块`,
    `已保存 ${p?.records ?? run?.records ?? 0} 条`,
    `待核验 ${p?.needs_review ?? run?.needs_review ?? 0} 条`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function ExtractionProgress({ run, name }: ApplicationProgressProps) {
  const task = useTaskStream(run?.task_id || "");
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="processing-summary extraction-progress-summary">
        <div>
          <span className="field-label">参数提取进度</span>
          <span className="help">
            {task.error || extractionSummary(task.data, run)}
          </span>
        </div>
        <Button
          size="small"
          variant="outline"
          disabled={!run?.task_id}
          onClick={() => setOpen(true)}
        >
          参数提取流水线
        </Button>
      </div>
      <Dialog
        header={
          <div className="pipeline-dialog-heading">
            <span>参数提取流水线</span>
            <h2 className="pipeline-dialog-title" title={name}>
              {name}
            </h2>
          </div>
        }
        visible={open}
        width="min(1000px, calc(100vw - 48px))"
        footer={false}
        closeOnOverlayClick={false}
        onClose={() => setOpen(false)}
        className="pipeline-dialog"
        placement="center"
        destroyOnClose
      >
        <ErrorNotice message={task.error} />
        {task.data ? (
          <PipelineView task={task.data} connected={task.connected} />
        ) : (
          <Busy />
        )}
      </Dialog>
    </>
  );
}
