import { useState } from "react";
import { Alert, Button, Dialog, Tag } from "tdesign-react";
import { api, Row } from "./api";
import { createId } from "./id";
import { ErrorNotice, useData } from "./ui";

export function KnowledgeTaskControls({
  libraryId,
  libraryName,
  onSubmitted,
}: {
  libraryId: string;
  libraryName: string;
  onSubmitted: () => void;
}) {
  const root = `/knowledge-bases/${encodeURIComponent(libraryId)}/tasks`;
  const stats = useData<Row>(root + "/stats", 3000);
  const [operation, setOperation] = useState<{
    mode: "pause" | "resume";
    key: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Row>();
  const [error, setError] = useState("");
  function open(mode: "pause" | "resume") {
    setResult(undefined);
    setError("");
    setOperation({ mode, key: createId() });
  }
  async function submit() {
    if (!operation) return;
    setBusy(true);
    setError("");
    try {
      const receipt = await api<Row>(root + "/" + operation.mode, {
        method: "POST",
        headers: { "Idempotency-Key": operation.key },
        body: "{}",
      });
      setResult(receipt);
      stats.reload();
      onSubmitted();
    } catch (e) {
      setError((e as Error).message + "。再次提交会核对同一次操作。");
    } finally {
      setBusy(false);
    }
  }
  const pause = operation?.mode === "pause";
  return (
    <>
      {stats.data?.library_paused && (
        <Tag theme="warning">当前库任务已暂停</Tag>
      )}
      <Button
        variant="outline"
        disabled={!stats.data || !!stats.error || stats.data.library_paused}
        onClick={() => open("pause")}
      >
        暂停全部任务
      </Button>
      <Button
        variant="outline"
        disabled={!stats.data || !!stats.error || !stats.data.library_paused}
        onClick={() => open("resume")}
      >
        启动全部任务
      </Button>
      {!!stats.error && <span className="help">任务调度状态读取失败</span>}
      {operation && (
        <Dialog
          visible
          width={600}
          top="10vh"
          header={pause ? "暂停当前知识库全部任务" : "启动当前知识库全部任务"}
          closeOnOverlayClick={false}
          closeOnEscKeydown={!busy}
          onClose={() => {
            if (!busy) setOperation(undefined);
          }}
          footer={
            <div className="form-actions">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setOperation(undefined)}
              >
                {result ? "完成" : "返回"}
              </Button>
              {!result && (
                <Button loading={busy} onClick={submit}>
                  {error
                    ? "重新核对并提交"
                    : pause
                      ? "确认暂停全部任务"
                      : "确认启动全部任务"}
                </Button>
              )}
            </div>
          }
        >
          <div className="field-stack">
            <div className="rebuild-scope">
              <b>{libraryName}</b>
              <span className="help">
                操作仅限当前知识库，覆盖全部分页、文档处理、重建、解压、预览及条款提取任务。
              </span>
            </div>
            {result ? (
              <>
                <Alert
                  theme="success"
                  message={
                    pause
                      ? "已暂停当前库任务调度。"
                      : "已启动当前库任务调度，等待中的任务将继续执行。"
                  }
                />
                {stats.data && (
                  <p className="help">
                    当前调度：{stats.data.library_paused ? "已暂停" : "已启动"}{" "}
                    · 已暂停 {stats.data.paused} 个 · 正在暂停{" "}
                    {stats.data.pausing} 个 · 排队 {stats.data.queued} 个
                  </p>
                )}
                {pause && !!stats.data?.pausing && (
                  <p className="help">
                    运行中的任务正在退出，请等待检查点保存，数量每 3 秒更新。
                  </p>
                )}
              </>
            ) : (
              <>
                {stats.data && (
                  <p>
                    排队 {stats.data.queued} 个 · 运行中 {stats.data.running} 个
                    · 待配置 {stats.data.waiting_configuration} 个
                  </p>
                )}
                <Alert
                  theme="info"
                  message={
                    pause
                      ? "立即停止领取新任务；运行中的任务会保存已提交的检查点并退出，正在进行的请求可能需要几秒结束。已成功的阶段和结果保留，启动后继续未完成的处理。"
                      : "恢复当前库已暂停和排队任务的执行，从原检查点继续。失败、部分失败及已终止的任务不会自动重做；待配置任务需先完成配置。"
                  }
                />
                <p className="help">
                  暂停状态会保存，刷新页面或重启服务后仍有效。暂停期间上传或新建的任务也会等待启动。
                </p>
              </>
            )}
            <ErrorNotice message={error || stats.error} />
          </div>
        </Dialog>
      )}
    </>
  );
}
