import { useState } from "react";
import { Alert, Button, Dialog } from "tdesign-react";
import { api, Row } from "./api";
import { createId } from "./id";
import { ErrorNotice, navigate, useData } from "./ui";
import { knowledgeTasksURL } from "./CancelKnowledgeTasksDialog";

const reasons: Record<string, string> = {
  STATE_CHANGED: "任务状态已变化",
  TASK_TYPE_UNSUPPORTED: "该类任务不支持保留结果重试",
  DOCUMENT_UNAVAILABLE: "文件已不存在或不属于当前库",
  DOCUMENT_DELETING: "文件正在删除",
  STALE_VERSION: "文件已有新版本",
  TASK_ACTIVE: "文件已有排队、运行或待配置任务",
  TASK_SUPERSEDED: "旧任务已被后续任务替代",
  CHECKPOINT_INVALID: "检查点无效，需查看任务详情",
  TRANSCRIPTION_REPARSE_REQUIRED:
    "音视频转写需更新正文，请在文件详情单独重新处理",
};

export function RetryFailedTasksDialog({
  libraryId,
  libraryName,
  onClose,
  onSubmitted,
}: {
  libraryId: string;
  libraryName: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const root = `/knowledge-bases/${encodeURIComponent(libraryId)}/tasks`;
  const stats = useData<Row>(root + "/stats", 3000);
  const [key] = useState(createId);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [result, setResult] = useState<Row>();
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setAttempted(true);
    setError("");
    try {
      const receipt = await api<Row>(root + "/retry-failed", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: "{}",
      });
      setResult(receipt);
      stats.reload();
      onSubmitted();
    } catch (e) {
      setError((e as Error).message + "。再次提交会核对同一次重试操作。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      header={result ? "失败任务重试结果" : "当前知识库 · 失败任务全部重试"}
      visible
      width={600}
      top="10vh"
      closeOnOverlayClick={false}
      closeOnEscKeydown={!busy}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <div className="form-actions">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {result ? "完成" : "返回"}
          </Button>
          {result ? (
            <Button
              onClick={() => {
                onClose();
                navigate(knowledgeTasksURL(libraryId));
              }}
            >
              查看当前库任务
            </Button>
          ) : (
            <Button
              loading={busy}
              disabled={
                !attempted &&
                (!stats.data ||
                  !!stats.error ||
                  !(stats.data.failed + stats.data.partially_failed))
              }
              onClick={submit}
            >
              {attempted ? "重新核对并提交" : "确认重试失败任务"}
            </Button>
          )}
        </div>
      }
    >
      <div className="field-stack">
        <div className="rebuild-scope">
          <b>{libraryName}</b>
          <span className="help">
            仅处理当前知识库，覆盖全部分页的失败及部分失败任务。
          </span>
        </div>
        {result ? (
          <>
            <Alert
              theme={result.accepted ? "success" : "info"}
              message={`检查 ${result.total} 个失败或部分失败任务，已重新排队 ${result.accepted} 个，跳过 ${result.skipped} 个。`}
            />
            {Object.entries(result.reasons || {}).map(([reason, count]) => (
              <p className="help" key={reason}>
                {reasons[reason] || reason}：{String(count)} 个
              </p>
            ))}
            <p className="help">
              已提交的任务从已有检查点继续，可在当前库任务中查看进度和失败原因。
            </p>
          </>
        ) : (
          <>
            {stats.data && (
              <p>
                失败 {stats.data.failed} 个 · 部分失败{" "}
                {stats.data.partially_failed} 个
              </p>
            )}
            {stats.data &&
              stats.data.failed + stats.data.partially_failed === 0 && (
                <Alert
                  theme="info"
                  message="当前知识库没有失败或部分失败任务。"
                />
              )}
            <Alert
              theme="info"
              message="成功的处理阶段和已保存结果会保留；Wiki、图谱及条款提取复用已成功的批次，只补跑失败或未完成的部分。前序失败尚未执行的必要后续阶段会继续处理。"
            />
            <p className="help">
              已有活动任务、文件版本过期、已被后续处理替代或转写需更新正文的任务会跳过，结果会列明原因。排队中、运行中、已取消及待配置任务不在本次重试范围。
            </p>
          </>
        )}
        <ErrorNotice message={error || stats.error} />
      </div>
    </Dialog>
  );
}
