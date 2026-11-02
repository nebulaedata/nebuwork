import { Alert, Input, Select, App as AntApp } from "antd";
import { useEffect, useRef, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/languages/definitions/python/register.js";
import "monaco-editor/languages/definitions/javascript/register.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { FileCode2, Save, Plus, History, RotateCcw } from "lucide-react";
import { api, date } from "./api";
import { Button, ErrorNotice, Modal, useJob } from "./ui";
import type { Revision, Source, Workflow } from "./types";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

export function SourceDiff({
  original,
  modified,
  language,
}: {
  original: string;
  modified: string;
  language: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const before = monaco.editor.createModel(original, language);
    const after = monaco.editor.createModel(modified, language);
    const editor = monaco.editor.createDiffEditor(container.current, {
      readOnly: true,
      theme: "vs",
      minimap: { enabled: false },
      automaticLayout: true,
    });
    editor.setModel({ original: before, modified: after });
    return () => {
      // Detach first: Monaco 0.57 requires models to outlive their diff widget.
      editor.setModel(null);
      editor.dispose();
      before.dispose();
      after.dispose();
    };
  }, [original, modified, language]);
  return <div ref={container} style={{ height: "55vh" }} />;
}

export function CodeEditor({
  workflow,
  refresh,
  onDirty,
}: {
  workflow: Workflow;
  refresh: () => Promise<void>;
  onDirty?: (dirty: boolean) => void;
}) {
  const { modal } = AntApp.useApp();
  const [file, setFile] = useState(
    workflow.files.find((f) => f.endsWith(".py")) ?? "workflow.json",
  );
  const [source, setSource] = useState<Source | null>(null),
    [text, setText] = useState("");
  const [revisions, setRevisions] = useState<Revision[]>([]),
    [selected, setSelected] = useState<Revision | null>(null);
  const [showHistory, setShowHistory] = useState(false),
    [newFile, setNewFile] = useState<string | null>(null);
  const { busy, error, setError, run } = useJob();
  const dirty = !!source && source.content !== text;
  useEffect(() => { onDirty?.(dirty); return () => onDirty?.(false); }, [dirty, onDirty]);
  const [remoteChanged, setRemoteChanged] = useState(false);
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail !== workflow.id) return;
      api<Source>(
        `/workflows/${workflow.id}/source?path=${encodeURIComponent(file)}`,
      )
        .then((value) => {
          if (value.revision === source?.revision) return;
          if (dirty) {
            setRemoteChanged(true);
            return;
          }
          setSource(value);
          setText(value.content);
          setRemoteChanged(false);
        })
        .catch((e) => setError(e.message));
    };
    window.addEventListener("nebulae:workflow-change", changed);
    return () => window.removeEventListener("nebulae:workflow-change", changed);
  }, [workflow.id, file, source?.revision, dirty]);
  useEffect(() => {
    let active = true;
    setSource(null);
    setRemoteChanged(false);
    api<Source>(
      `/workflows/${workflow.id}/source?path=${encodeURIComponent(file)}`,
    )
      .then((value) => {
        if (active) {
          setSource(value);
          setText(value.content);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [file, workflow.id, setError]);
  const save = () =>
    run(async () => {
      const value = await api<Source>(
        `/workflows/${workflow.id}/source?path=${encodeURIComponent(file)}`,
        "PUT",
        { content: text, expected_revision: source?.revision },
      );
      setSource(value);
      setText(value.content);
      await refresh();
    });
  const history = () =>
    run(async () => {
      const items = await api<Revision[]>(
        `/workflows/${workflow.id}/revisions?path=${encodeURIComponent(file)}`,
      );
      setRevisions(items);
      setSelected(items[0] ?? null);
      setShowHistory(true);
    });
  return (
    <div>
      {remoteChanged && (
        <Alert
          type="warning"
          title="助手已修改此文件，当前未保存草稿已保留。保存时将检查版本，请先查看历史差异并合并。"
        />
      )}
      <div className="code-workspace">
        <aside className="file-tree">
          <div className="tree-title">
            源码文件
            <Button
              aria-label="新增文件"
              disabled={workflow.archived || busy}
              className="icon-button"
              onClick={() => setNewFile("steps/new_step.py")}
            >
              <Plus size={16} />
            </Button>
          </div>
          {workflow.files.map((path) => (
            <Button
              key={path}
              className={file === path ? "active" : ""}
              onClick={() => {
                if (!dirty || file === path) {
                  setFile(path);
                  return;
                }
                modal.confirm({
                  title: "当前文件有未保存修改",
                  content: "切换文件将放弃当前编辑内容。",
                  okText: "放弃并切换",
                  cancelText: "继续编辑",
                  onOk: () => setFile(path),
                });
              }}
            >
              <FileCode2 size={15} />
              <span>{path}</span>
            </Button>
          ))}
        </aside>
        <section className="editor-panel">
          <div className="editor-toolbar">
            <span>
              {file}
              {dirty && <i className="unsaved" />}
            </span>
            <div>
              <Button onClick={history} disabled={busy}>
                <History size={15} />
                版本历史
              </Button>
              <Button
                className="primary"
                onClick={save}
                disabled={workflow.archived || busy || !source || !dirty}
              >
                <Save size={15} />
                保存代码
              </Button>
            </div>
          </div>
          <ErrorNotice message={error} clear={() => setError("")} />
          <Editor
            height="100%"
            path={workflow.id + "/" + file}
            language={
              file.endsWith(".py")
                ? "python"
                : file.endsWith(".json")
                  ? "json"
                  : "plaintext"
            }
            theme="vs"
            value={text}
            onChange={(value) => setText((value ?? "").replace(/\r\n?/g, "\n"))}
            options={{
              readOnly: workflow.archived,
              minimap: { enabled: false },
              fontSize: 14,
              tabSize: 4,
              padding: { top: 12 },
              automaticLayout: true,
              scrollBeyondLastLine: false,
              ariaLabel: "步骤代码编辑器",
            }}
            loading={<div className="empty">正在加载代码编辑器…</div>}
          />
          <div className="editor-statusbar">
            <span>
              {file.endsWith(".py")
                ? "Python"
                : file.endsWith(".json")
                  ? "JSON"
                  : "纯文本"}
              <span className="sep">·</span>UTF-8
            </span>
            <span>保存后，下一个启动的步骤使用新代码</span>
          </div>
        </section>
        {newFile !== null && (
          <Modal title="新增源码文件" close={() => setNewFile(null)}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api(
                    `/workflows/${workflow.id}/source?path=${encodeURIComponent(newFile)}`,
                    "PUT",
                    {
                      content: newFile.endsWith(".py")
                        ? 'def run(ctx):\n    ctx.task.save_json("result", {})\n'
                        : newFile.endsWith(".json")
                          ? "{}\n"
                          : "",
                      expected_revision: null,
                    },
                  );
                  await refresh();
                  setFile(newFile);
                  setNewFile(null);
                });
              }}
            >
              <label>
                相对路径
                <Input
                  autoFocus
                  value={newFile}
                  onChange={(e) => setNewFile(e.target.value)}
                />
              </label>
              <p className="muted">文件保存在当前工作流目录内。</p>
              <ErrorNotice message={error} clear={() => setError("")} />
              <footer>
                <Button type="button" onClick={() => setNewFile(null)}>
                  取消
                </Button>
                <Button type="submit" className="primary" disabled={busy}>
                  创建文件
                </Button>
              </footer>
            </form>
          </Modal>
        )}
        {showHistory && (
          <Modal
            title={"代码版本 · " + file}
            wide
            close={() => setShowHistory(false)}
          >
            <div className="revision-picker">
              <Select
                aria-label="历史版本"
                value={selected?.id}
                placeholder="尚无版本记录"
                onChange={(value) =>
                  setSelected(revisions.find((r) => r.id === value) ?? null)
                }
                options={revisions.map((r) => ({
                  value: r.id,
                  label:
                    "#" +
                    r.id +
                    " · " +
                    date(r.created_at) +
                    " · " +
                    r.digest.slice(0, 8),
                }))}
              />

              <Button
                disabled={workflow.archived || !selected || busy}
                onClick={() =>
                  run(async () => {
                    if (!selected) return;
                    const restored = await api<Source>(
                      `/workflows/${workflow.id}/restore?path=${encodeURIComponent(file)}`,
                      "POST",
                      {
                        revision_id: selected.id,
                        expected_revision: source?.revision,
                      },
                    );
                    setSource(restored);
                    setText(restored.content);
                    setShowHistory(false);
                    await refresh();
                  })
                }
              >
                <RotateCcw size={15} />
                恢复此版本
              </Button>
            </div>
            <p className="muted">
              左侧为历史版本，右侧为当前编辑内容。恢复会保留版本记录。
            </p>
            <ErrorNotice message={error} clear={() => setError("")} />
            {selected ? (
              <SourceDiff
                original={selected.content}
                modified={text}
                language={file.endsWith(".py") ? "python" : "json"}
              />
            ) : (
              <p>尚无已保存版本。</p>
            )}
          </Modal>
        )}
      </div>
    </div>
  );
}
