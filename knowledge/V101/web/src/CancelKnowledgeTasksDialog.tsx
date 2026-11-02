import { useState } from "react";
import { Alert, Button, Dialog } from "tdesign-react";
import { api, Row } from "./api";
import { createId } from "./id";
import { ErrorNotice, navigate, useData } from "./ui";

export const knowledgeTasksURL = (id: string) =>
  "/tasks?knowledge_base_id=" + encodeURIComponent(id);

export function CancelKnowledgeTasksDialog({
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
  const [result, setResult] = useState<Row>();
  const stats = useData<Row>(
    root +
      "/stats" +
      (result ? "?after_cancel=" + encodeURIComponent(result.request_id) : ""),
    2000,
  );
  const [key] = useState(createId);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setAttempted(true);
    setError("");
    try {
      const receipt = await api<Row>(root + "/cancel", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: "{}",
      });
      setResult(receipt);
      stats.reload();
      onSubmitted();
    } catch (e) {
      setError((e as Error).message + "。重试会核对同一次终止操作。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      header={result ? "任务终止结果" : "终止当前知识库的全部任务"}
      visible
      width={580}
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
            <>
              {result.document_status_pending && (
                <Button variant="outline" loading={busy} onClick={submit}>
                  重新核对
                </Button>
              )}
              <Button
                onClick={() => {
                  onClose();
                  navigate(knowledgeTasksURL(libraryId));
                }}
              >
                查看当前库任务
              </Button>
            </>
          ) : (
            <Button
              theme="danger"
              loading={busy}
              disabled={
                !attempted &&
                (!stats.data || !!stats.error || !stats.data.active)
              }
              onClick={submit}
            >
              {attempted ? "重试终止" : "确认全部终止"}
            </Button>
          )}
        </div>
      }
    >
      <div className="field-stack">
        <div className="rebuild-scope">
          <b>{libraryName}</b>
          <span className="help">
            范围仅限当前知识库，包含全部分页及解析、重建、解压、预览和条款提取任务。
          </span>
        </div>
        {result ? (
          <>
            <Alert
              theme="success"
              message={`已取消 ${result.cancelled} 个排队或待配置任务；已向 ${result.stop_requested} 个运行中任务发送终止请求。`}
            />
            {stats.data && !stats.error && (
              <p className="help">
                {stats.data.stopping
                  ? `仍有 ${stats.data.stopping} 个任务正在停止，状态每 2 秒更新。`
                  : "当前没有正在停止的任务。"}
              </p>
            )}
            {result.document_status_pending && (
              <Alert
                theme="warning"
                message="任务终止已提交，文件状态刷新暂未完成，可点击重新核对。"
              />
            )}
            <p className="help">
              已保存的文件和处理结果会保留。后续新创建或重新提交的任务需另行终止。
            </p>
          </>
        ) : (
          <>
            {stats.data && (
              <p>
                排队 {stats.data.queued} 个 · 运行中 {stats.data.running} 个 ·
                待配置 {stats.data.waiting_configuration} 个 · 正在停止{" "}
                {stats.data.stopping} 个
              </p>
            )}
            {stats.data?.active === 0 ? (
              <Alert theme="info" message="当前知识库没有待终止的任务。" />
            ) : (
              <Alert
                theme="warning"
                message="排队及待配置任务会立即取消；运行中任务会先显示正在终止，待执行进程退出后变为已取消。已保存的文件及处理结果会保留。"
              />
            )}
          </>
        )}
        <ErrorNotice message={error || stats.error} />
      </div>
    </Dialog>
  );
}
