import { useState } from "react";
import { Alert, Button, Checkbox, Dialog, Radio } from "tdesign-react";
import { api, Row } from "./api";
import { createId } from "./id";
import { ErrorNotice, navigate } from "./ui";
import { knowledgeTasksURL } from "./CancelKnowledgeTasksDialog";

const stages = [
  ["keyword", "关键词索引", "更新关键词检索索引"],
  ["embedding", "文本向量", "重新生成文本检索向量"],
  ["outline", "文件目录", "重新提取并核验目录结构"],
  ["wiki", "Wiki", "重新生成知识页面"],
  ["graph", "实体知识图谱", "重新提取实体、关系和证据"],
  ["images", "图片理解", "补充已提取图片的理解内容"],
  ["image_embedding", "图片向量", "重新生成图片检索向量"],
  ["preview", "原文预览", "单独重新生成预览文件"],
];
const reasons: Record<string, string> = {
  TASK_ACTIVE: "已有排队或处理中的任务",
  PARSE_NOT_READY: "尚无解析结果，请先完整重做",
  FORMAT_NOT_SUPPORTED: "当前格式暂不支持解析",
  ARCHIVE_TASK_REQUIRED: "ZIP 保留原解压结果，解压后的文件独立处理",
  FILE_NOT_READY: "尚无可处理的源文件",
  DELETING: "文件正在删除",
  MEDIA_DISABLED: "当前配置已关闭音视频处理",
  PREVIEW_DISABLED: "当前配置已关闭原文预览",
};

export function RebuildDialog({
  libraryId,
  libraryName,
  count,
  document,
  initialStages,
  onClose,
  onSubmitted,
}: {
  libraryId: string;
  libraryName: string;
  count?: number;
  document?: Row;
  initialStages?: string[];
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [mode, setMode] = useState(initialStages ? "stages" : "reparse");
  const [selected, setSelected] = useState(
    initialStages || ["embedding", "wiki", "graph"],
  );
  const [key] = useState(createId);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Row>();
  const scope = document ? "文件" : "全库";
  function select(stage: string, checked: boolean) {
    setSelected((current) =>
      checked
        ? stage === "preview"
          ? [stage]
          : [...current.filter((value) => value !== "preview"), stage]
        : current.filter((value) => value !== stage),
    );
  }
  async function submit() {
    setAttempted(true);
    setBusy(true);
    setError("");
    try {
      const value = await api<Row>(`/knowledge-bases/${libraryId}/rebuild`, {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({
          mode,
          ...(document ? { knowledge_ids: [document.id] } : {}),
          ...(mode === "stages" ? { stages: selected } : {}),
        }),
      });
      setResult(value);
      onSubmitted();
    } catch (e) {
      setError(
        (e as Error).message + "。可重试提交，系统会使用同一操作标识核对结果。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      header={
        result
          ? "重做提交结果"
          : `${scope}${mode === "reparse" ? "重做" : "部分重建"}`
      }
      visible
      width={680}
      top="7vh"
      className="rebuild-dialog"
      closeOnOverlayClick={false}
      closeOnEscKeydown={!busy}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <div className="form-actions">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {result ? "完成" : "取消"}
          </Button>
          {result ? (
            <Button
              onClick={() => {
                onClose();
                navigate(knowledgeTasksURL(libraryId));
              }}
            >
              查看任务中心
            </Button>
          ) : (
            <Button
              loading={busy}
              disabled={mode === "stages" && !selected.length}
              onClick={submit}
            >
              {attempted
                ? "重试提交"
                : mode === "reparse"
                  ? `确认${scope}重做`
                  : "确认部分重建"}
            </Button>
          )}
        </div>
      }
    >
      <div className="field-stack">
        <div className="rebuild-scope">
          <b>{document?.name || libraryName}</b>
          <span className="help">
            {document
              ? "仅处理当前文件"
              : `当前知识库的全部文件${count == null ? "" : `（共 ${count.toLocaleString()} 个）`}，包含所有分页`}
          </span>
        </div>
        {result ? (
          <>
            <Alert
              theme={result.skipped ? "warning" : "success"}
              message={`已检查 ${result.total} 个文件，提交 ${result.accepted} 个，跳过 ${result.skipped} 个。`}
            />
            <p className="help">
              已提交的任务进入处理队列，可在任务中心查看进度。关闭此弹窗不影响已提交任务。
            </p>
            {Object.entries(result.reasons || {}).map(([reason, total]) => (
              <div className="rebuild-result-row" key={reason}>
                <span>{reasons[reason] || reason}</span>
                <b>{String(total)} 个</b>
              </div>
            ))}
          </>
        ) : (
          <>
            <Radio.Group
              value={mode}
              disabled={attempted}
              onChange={(value) => setMode(String(value))}
            >
              <Radio value="reparse">完整重做</Radio>
              <Radio value="stages">部分重建</Radio>
            </Radio.Group>
            {mode === "reparse" ? (
              <p className="help">
                从原文件重新解析，并按当前知识库及文件配置生成目录、索引、Wiki、图谱等已启用的结果。需要模型的阶段会使用当前模型配置。
              </p>
            ) : (
              <>
                <p className="help">
                  复用当前解析结果，只执行选中的阶段。尚未解析的文件需先完整重做；原文预览单独提交。
                </p>
                <div className="rebuild-stage-grid">
                  {stages.map(([value, label, description]) => (
                    <div
                      className={`rebuild-stage ${selected.includes(value) ? "is-selected" : ""}`}
                      key={value}
                    >
                      <Checkbox
                        checked={selected.includes(value)}
                        disabled={attempted}
                        onChange={(checked) => select(value, checked)}
                      >
                        {label}
                      </Checkbox>
                      <p className="help">{description}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
            <Alert
              theme="info"
              message="已有排队或处理中的任务会跳过。ZIP 本身不重复解压，解压后的文件独立处理；提交结果会列明跳过数量和原因。"
            />
            <ErrorNotice message={error} />
          </>
        )}
      </div>
    </Dialog>
  );
}
