import { resourceURL } from "./integration";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogPlugin,
  ImageViewer,
  Input,
  MessagePlugin,
  Pagination,
  Select,
  Textarea,
} from "tdesign-react";
import { AddIcon, ChatIcon, SettingIcon } from "tdesign-icons-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, Row, send, supportsPurpose } from "./api";
import { ErrorNotice, navigate, useData } from "./ui";
import { createId } from "./id";
import "./qa.css";

const activeStates = ["queued", "running"];
const labels: Record<string, string> = {
  queued: "排队中",
  running: "回答中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已停止",
  interrupted: "已中断",
};
async function catalog(path: string, limit = 1000) {
  const out: Row[] = [];
  for (let page = 1; out.length < limit; page++) {
    const rows = await api<Row[]>(
      `${path}${path.includes("?") ? "&" : "?"}page_size=100&page=${page}`,
    );
    out.push(...rows);
    if (!(rows as any).meta?.has_more) break;
  }
  return out.slice(0, limit);
}
function locationText(source: Row) {
  return (source.locators || [])
    .map((l: Row) =>
      l.cell_range
        ? `${l.sheet || "工作表"} ${l.cell_range}`
        : l.page
          ? `第 ${l.page} 页`
          : l.start_ms != null || l.time_ms != null
            ? `${((l.start_ms ?? l.time_ms) / 1000).toFixed(1)} 秒`
            : l.paragraph != null
              ? `段落 ${l.paragraph}`
              : "文档位置",
    )
    .join("；");
}
function SourceAnchor({
  source,
  children,
}: {
  source: Row;
  children: React.ReactNode;
}) {
  return source.available === false || !source.preview_url ? (
    <span className="qa-missing">{children}（来源不可用）</span>
  ) : (
    <a
      href={resourceURL(source.preview_url)}
      target="_blank"
      rel="noreferrer"
      title={`${source.file_name || source.name || "原文"} · ${locationText(source)}`}
    >
      {children}
    </a>
  );
}
function OriginalImage({ image }: { image: Row }) {
  const [zoom, setZoom] = useState(false);
  const [broken, setBroken] = useState(false);
  return (
    <span className="qa-original-image">
      {image.available === false || broken ? (
        <span className="qa-missing">原文图片不可用</span>
      ) : (
        <button
          className="qa-image-button"
          onClick={() => setZoom(true)}
          title="放大原文图片"
        >
          <img
            src={resourceURL(image.content_url)}
            alt="原文图片"
            loading="lazy"
            onError={() => setBroken(true)}
          />
        </button>
      )}
      <span className="qa-image-caption">
        原文图片 · {image.name} · {locationText(image)}{" "}
        <SourceAnchor source={image}>定位原文 ↗</SourceAnchor>
      </span>
      {zoom && (
        <ImageViewer
          visible
          images={[image.content_url]}
          title="原文图片"
          trigger={<></>}
          onClose={() => setZoom(false)}
          zIndex={6000}
        />
      )}
    </span>
  );
}
const QAReferences = createContext<{ sources: Row[]; images: Row[] }>({
  sources: [],
  images: [],
});
// Stable renderers keep image viewers open across polling and focus updates.
const qaMarkdownComponents: Components = {
  a: function QALink({ href, children }) {
    const { sources } = useContext(QAReferences);
    const source = sources.find((s) => "source:" + s.source_ref_id === href);
    return source ? (
      <SourceAnchor source={source}>{children}</SourceAnchor>
    ) : (
      <span className="qa-missing">{children}（引用不可用）</span>
    );
  },
  img: function QAImage({ src }) {
    const { images } = useContext(QAReferences);
    const image = images.find((i) => "asset:" + i.id === src);
    return image ? (
      <OriginalImage image={image} />
    ) : (
      <span className="qa-missing">图片引用不可用</span>
    );
  },
};
function Answer({ message }: { message: Row }) {
  return (
    <QAReferences.Provider
      value={{ sources: message.sources || [], images: message.images || [] }}
    >
      <div className="qa-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          urlTransform={(url) =>
            /^(source|asset):[\w-]+$/.test(url) ? url : ""
          }
          components={qaMarkdownComponents}
        >
          {message.content ||
            (activeStates.includes(message.state) ? "正在准备回答…" : "")}
        </ReactMarkdown>
      </div>
    </QAReferences.Provider>
  );
}

export function QA({ id = "" }: { id?: string }) {
  const [listPage, setListPage] = useState(1);
  const sessions = useData<Row[]>(
    `/qa/sessions?page_size=20&page=${listPage}`,
    5000,
  );
  const session = useData<Row>(id ? `/qa/sessions/${id}` : "");
  const messages = useData<Row[]>(
    id ? `/qa/sessions/${id}/messages?page_size=50` : "",
    2500,
  );
  const [older, setOlder] = useState<Row[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyMore, setHistoryMore] = useState(false);
  const [kbs, setKBs] = useState<Row[]>([]);
  const [docs, setDocs] = useState<Row[]>([]);
  const [kbIDs, setKBIDs] = useState<string[]>([]);
  const [docIDs, setDocIDs] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [settings, setSettings] = useState<Row>({});
  const [draftSettings, setDraftSettings] = useState<Row>({
    title: "新对话",
    system_prompt: null,
    enable_wiki: false,
    enable_graph: false,
  });
  const [showSources, setShowSources] = useState(true);
  const [focused, setFocused] = useState("");
  const [stream, setStream] = useState<Row | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const key = useRef<{ query: string; key: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const draftSession = useRef("");
  useEffect(() => {
    let live = true;
    catalog("/knowledge-bases", 100)
      .then((rows) => {
        if (live) {
          setKBs(rows);
          if (!id && rows[0]) setKBIDs([rows[0].id]);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id]);
  useEffect(() => {
    if (session.data && !initialized.current) {
      initialized.current = true;
      setKBIDs(session.data.knowledge_base_ids || []);
      setDocIDs(session.data.knowledge_ids || []);
    }
  }, [session.data]);
  useEffect(() => {
    let live = true;
    Promise.all(kbIDs.map((kb) => catalog(`/knowledge-bases/${kb}/knowledge`)))
      .then((groups) => {
        if (live) setDocs(groups.flat());
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [kbIDs.join(",")]);
  useEffect(() => {
    if (historyPage === 1)
      setHistoryMore(!!(messages.data as any)?.meta?.has_more);
  }, [messages.data, historyPage]);
  const byID = new Map<string, Row>();
  [...older, ...(messages.data || [])].forEach((m) => byID.set(m.id, m));
  const all = [...byID.values()].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) ||
      (a.role === b.role
        ? a.id.localeCompare(b.id)
        : a.role === "user"
          ? -1
          : 1),
  );
  const active = all.find((m) => activeStates.includes(m.state));
  useEffect(() => {
    if (!active?.id) return;
    const messageID = active.id;
    let text = "";
    const es = new EventSource(resourceURL(`/api/v1/qa/messages/${messageID}/events`));
    setStream({ ...active, content: active.content, id: messageID });
    es.addEventListener("stage", (event) => {
      const value = JSON.parse((event as MessageEvent).data);
      setStream((old) => ({ ...old, id: messageID, stage: value.stage }));
    });
    es.addEventListener("delta", (event) => {
      text += JSON.parse((event as MessageEvent).data).delta;
      setStream((old) => ({ ...old, id: messageID, content: text }));
    });
    es.addEventListener("evidence", (event) => {
      const value = JSON.parse((event as MessageEvent).data);
      setStream((old) => ({ ...old, ...value, id: messageID }));
    });
    es.addEventListener("warning", (event) => {
      const value = JSON.parse((event as MessageEvent).data);
      setStream((old) => ({
        ...old,
        id: messageID,
        warnings: [...(old?.warnings || []), value.message],
      }));
    });
    es.addEventListener("done", (event) => {
      const value = JSON.parse((event as MessageEvent).data);
      if (value.content != null)
        setStream((old) => ({ ...old, ...value, id: messageID }));
      es.close();
      messages.reload();
      sessions.reload();
    });
    return () => es.close();
  }, [active?.id]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [all.length, stream?.content]);
  const display = all.map((m) =>
    stream?.id === m.id && activeStates.includes(m.state)
      ? { ...m, ...stream }
      : m,
  );
  const selectedMessage =
    display.find((m) => m.id === focused) ||
    [...display].reverse().find((m) => m.role === "assistant");
  async function saveRange(sessionID: string) {
    await send(
      `/qa/sessions/${sessionID}`,
      { knowledge_base_ids: kbIDs, knowledge_ids: docIDs },
      "PATCH",
    );
  }
  async function ask() {
    if (!query.trim() || !kbIDs.length || active || busy) return;
    setBusy(true);
    setSubmitting(true);
    setError("");
    try {
      if (!key.current || key.current.query !== query.trim())
        key.current = { query: query.trim(), key: createId() };
      let sessionID = id || draftSession.current;
      if (!sessionID) {
        const created = await send("/qa/sessions", {
          ...draftSettings,
          knowledge_base_ids: kbIDs,
          knowledge_ids: docIDs,
        });
        sessionID = created.id;
        draftSession.current = sessionID;
      }
      await saveRange(sessionID);
      await api(`/qa/sessions/${sessionID}/messages`, {
        method: "POST",
        headers: { "Idempotency-Key": key.current.key },
        body: JSON.stringify({ query: query.trim() }),
      });
      key.current = null;
      setQuery("");
      setStream(null);
      setFocused("");
      if (!id) navigate(`/qa/${sessionID}`);
      else {
        messages.reload();
        sessions.reload();
        session.reload();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setSubmitting(false);
    }
  }
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      messages.reload();
      sessions.reload();
      session.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadOlder() {
    await action(async () => {
      const page = historyPage + 1;
      const rows = await api<Row[]>(
        `/qa/sessions/${id}/messages?page_size=50&page=${page}`,
      );
      setOlder((old) => [...old, ...rows]);
      setHistoryPage(page);
      setHistoryMore(!!(rows as any).meta?.has_more);
    });
  }
  function saveConversation() {
    return action(async () => {
      const value = {
        title: (settings.title || "").trim(),
        system_prompt: settings.system_prompt || null,
        enable_wiki: !!settings.enable_wiki,
        enable_graph: !!settings.enable_graph,
      };
      if (!value.title || value.title.length > 120)
        throw new Error("会话标题须为 1–120 字");
      const sessionID = id || draftSession.current;
      if (sessionID) await send(`/qa/sessions/${sessionID}`, value, "PATCH");
      if (!id) setDraftSettings(value);
      setEdit(false);
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>知识库问答</h1>
          <p className="subtitle">
            依据知识资料回答，原图随文展示，引用直达原文。
          </p>
        </div>
        <Button variant="outline" onClick={() => setShowSources(!showSources)}>
          {showSources ? "收起来源" : "展开来源"}
        </Button>
      </div>
      <ErrorNotice
        message={error || sessions.error || session.error || messages.error}
      />
      <div className={`qa-workspace ${showSources ? "" : "qa-hide-sources"}`}>
        <aside className="qa-sessions">
          <Button block icon={<AddIcon />} onClick={() => navigate("/qa")}>
            新建对话
          </Button>
          <div className="qa-session-items">
            {(sessions.data || []).map((s) => (
              <button
                className={`qa-session-item ${s.id === id ? "selected" : ""}`}
                key={s.id}
                onClick={() => navigate(`/qa/${s.id}`)}
              >
                <ChatIcon />
                <span>{s.title}</span>
              </button>
            ))}
          </div>
          {(sessions.data as any)?.meta?.total > 20 && (
            <Pagination
              size="small"
              theme="simple"
              current={listPage}
              pageSize={20}
              total={(sessions.data as any).meta.total}
              onCurrentChange={setListPage}
            />
          )}
        </aside>
        <section className="qa-chat">
          <div className="qa-chat-header">
            <strong>{session.data?.title || draftSettings.title}</strong>
            {
              <Button
                variant="text"
                size="small"
                icon={<SettingIcon />}
                onClick={() => {
                  setSettings(id ? { ...session.data } : { ...draftSettings });
                  setEdit(true);
                }}
              >
                会话设置
              </Button>
            }
          </div>
          <div className="qa-scope">
            <Select
              multiple
              filterable
              value={kbIDs}
              placeholder="选择知识库"
              options={kbs.map((k) => ({ value: k.id, label: k.name }))}
              onChange={(value) => {
                setKBIDs(value as string[]);
                setDocIDs([]);
              }}
              disabled={!!active || busy}
            />
            <Select
              multiple
              filterable
              clearable
              value={docIDs}
              placeholder="全部文档（可限定）"
              options={docs.map((d) => ({ value: d.id, label: d.name }))}
              onChange={(value) => setDocIDs(value as string[])}
              disabled={!!active || busy}
            />
          </div>
          <div className="qa-messages" aria-live="polite">
            {historyMore && (
              <Button variant="text" loading={busy} onClick={loadOlder}>
                加载更早的消息
              </Button>
            )}
            {!display.length && (
              <div className="qa-welcome">
                <ChatIcon size="40px" />
                <h2>从知识中寻找答案</h2>
                <p>选择知识库后提问，支持连续追问和原文图片解读。</p>
                <p className="help">
                  关键结论附来源；点击引用，可直接查看原文位置。
                </p>
              </div>
            )}
            {display.map((m) => (
              <article
                className={`qa-message qa-${m.role}`}
                key={m.id}
                onClick={() => m.role === "assistant" && setFocused(m.id)}
              >
                <div className="qa-message-label">
                  {m.role === "user" ? "你" : "知识库助手"}
                  {m.role === "assistant" && (
                    <span>
                      {activeStates.includes(m.state)
                        ? m.stage || labels[m.state]
                        : labels[m.state]}
                    </span>
                  )}
                </div>
                {m.role === "user" ? (
                  <div className="qa-user-text">{m.content}</div>
                ) : (
                  <>
                    <Answer message={m} />
                    {m.error?.message && (
                      <Alert
                        theme={m.state === "failed" ? "error" : "warning"}
                        message={m.error.message}
                      />
                    )}
                    {!!m.warnings?.length && (
                      <details className="qa-warnings">
                        <summary>本轮提示（{m.warnings.length}）</summary>
                        {[...new Set<string>(m.warnings)].map((warning) => (
                          <p key={warning}>{warning}</p>
                        ))}
                      </details>
                    )}
                    <div className="qa-message-actions">
                      <Button
                        size="small"
                        variant="text"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!navigator.clipboard?.writeText) {
                            MessagePlugin.warning(
                              "当前浏览器不支持自动复制，请选中答案复制",
                            );
                            return;
                          }
                          navigator.clipboard
                            .writeText(m.content || "")
                            .then(() => MessagePlugin.success("已复制"))
                            .catch(() => MessagePlugin.error("复制失败"));
                        }}
                      >
                        复制
                      </Button>
                      {!activeStates.includes(m.state) && (
                        <Button
                          size="small"
                          variant="text"
                          disabled={busy || !!active}
                          onClick={() =>
                            action(() =>
                              api(`/qa/messages/${m.id}/retry`, {
                                method: "POST",
                                headers: {
                                  "Idempotency-Key": createId(),
                                },
                              }),
                            )
                          }
                        >
                          重试回答
                        </Button>
                      )}
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => {
                          setFocused(m.id);
                          setShowSources(true);
                        }}
                      >
                        来源 {m.sources?.length || 0}
                      </Button>
                    </div>
                  </>
                )}
              </article>
            ))}
            <div ref={bottom} />
          </div>
          <div className="qa-composer">
            <Textarea
              value={query}
              onChange={setQuery}
              placeholder="输入问题，例如：这款接入箱的安装要求是什么？"
              autosize={{ minRows: 2, maxRows: 6 }}
              maxlength={4096}
              disabled={!!active}
              onKeydown={(_, context) => {
                if (
                  context.e.key === "Enter" &&
                  !context.e.shiftKey &&
                  !context.e.nativeEvent.isComposing
                ) {
                  context.e.preventDefault();
                  ask();
                }
              }}
            />
            <div className="qa-composer-actions">
              <span className="help">Enter 发送 · Shift+Enter 换行</span>
              {active ? (
                <Button
                  theme="danger"
                  variant="outline"
                  loading={busy}
                  onClick={() =>
                    action(() =>
                      api(`/qa/messages/${active.id}/stop`, { method: "POST" }),
                    )
                  }
                >
                  停止生成
                </Button>
              ) : (
                <Button
                  loading={submitting}
                  disabled={busy || !query.trim() || !kbIDs.length}
                  onClick={ask}
                >
                  发送问题
                </Button>
              )}
            </div>
          </div>
        </section>
        {showSources && (
          <aside className="qa-evidence">
            <h3>本轮来源</h3>
            {selectedMessage?.rewritten_query && (
              <p className="help">
                检索问题：{selectedMessage.rewritten_query}
              </p>
            )}
            {!(selectedMessage?.sources || []).length && (
              <p className="help">回答使用的证据和原图将在这里显示。</p>
            )}
            {(selectedMessage?.sources || []).map(
              (source: Row, index: number) => (
                <div className="qa-source-card" key={source.source_ref_id}>
                  <strong>
                    <SourceAnchor source={source}>
                      [{index + 1}] {source.file_name}
                    </SourceAnchor>
                  </strong>
                  <p className="help">{locationText(source)}</p>
                  <p className="qa-source-quote">
                    {source.display_quote || source.quote || "原文图片"}
                  </p>
                  {source.partial && (
                    <p className="help">{source.mapping_reason}</p>
                  )}
                </div>
              ),
            )}
            {(selectedMessage?.images || []).map((image: Row) => (
              <OriginalImage key={image.id} image={image} />
            ))}
            {selectedMessage?.image_analysis && (
              <details>
                <summary>本轮图片解读（模型生成）</summary>
                <p className="qa-user-text">{selectedMessage.image_analysis}</p>
              </details>
            )}
          </aside>
        )}
      </div>
      <Dialog
        header="会话设置"
        visible={edit}
        onClose={() => setEdit(false)}
        confirmLoading={busy}
        onConfirm={saveConversation}
        footer={
          <div className="qa-dialog-footer">
            {id && (
              <Button
                theme="danger"
                variant="text"
                disabled={busy}
                onClick={() => {
                  const dialog = DialogPlugin.confirm({
                    header: "删除会话",
                    body: "删除该会话及全部问答记录？",
                    confirmBtn: { content: "删除", theme: "danger" },
                    onConfirm: () =>
                      action(async () => {
                        await api(`/qa/sessions/${id}`, { method: "DELETE" });
                        dialog.destroy();
                        navigate("/qa");
                      }),
                  });
                }}
              >
                删除会话
              </Button>
            )}
            <Button variant="outline" onClick={() => setEdit(false)}>
              取消
            </Button>
            <Button loading={busy} onClick={saveConversation}>
              保存
            </Button>
          </div>
        }
      >
        <label className="field">
          <span>会话标题</span>
          <Input
            value={settings.title || ""}
            maxlength={120}
            onChange={(v) => setSettings({ ...settings, title: v })}
          />
        </label>
        <label className="field">
          <span>系统提示词</span>
          <Textarea
            value={settings.system_prompt || ""}
            onChange={(v) => setSettings({ ...settings, system_prompt: v })}
            placeholder="留空沿用全局系统提示词"
            autosize={{ minRows: 6, maxRows: 14 }}
            maxlength={16000}
          />
        </label>
        <Button
          variant="text"
          onClick={() => setSettings({ ...settings, system_prompt: null })}
        >
          恢复沿用全局
        </Button>
        <div className="qa-enhancements">
          <Checkbox
            checked={!!settings.enable_wiki}
            onChange={(v) => setSettings({ ...settings, enable_wiki: v })}
          >
            Wiki 增强
          </Checkbox>
          <Checkbox
            checked={!!settings.enable_graph}
            onChange={(v) => setSettings({ ...settings, enable_graph: v })}
          >
            知识图谱增强
          </Checkbox>
        </div>
        <p className="help">设置影响后续提问，历史回答保留当时的配置和来源。</p>
      </Dialog>
    </>
  );
}

export function QASettings() {
  const setting = useData<Row>("/settings/qa-defaults");
  const models = useData<Row[]>("/models");
  const [value, setValue] = useState<Row>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (setting.data) setValue(setting.data);
  }, [setting.data]);
  return (
    <div className="tab-content">
      <h2>知识库问答设置</h2>
      <p className="help">
        全局默认可被会话提示词覆盖。每轮保存实际配置，修改仅影响后续提问。
      </p>
      <ErrorNotice message={error || setting.error || models.error} />
      <div className="form-grid">
        <label className="field">
          <span>回答模型</span>
          <Select
            value={value.model_id || ""}
            options={[
              { value: "", label: "沿用系统文本生成模型" },
              ...(models.data || [])
                .filter((m) => supportsPurpose(m.purpose, "text"))
                .map((m) => ({ value: m.id, label: m.name })),
            ]}
            onChange={(v) => setValue({ ...value, model_id: v })}
          />
        </label>
        <label className="field">
          <span>图片理解模型</span>
          <Select
            value={value.vision_model_id || ""}
            options={[
              { value: "", label: "沿用系统图片理解模型" },
              ...(models.data || [])
                .filter(
                  (m) =>
                    m.purpose === "vision" ||
                    (m.purpose === "text" && m.config?.allow_image_input),
                )
                .map((m) => ({ value: m.id, label: m.name })),
            ]}
            onChange={(v) => setValue({ ...value, vision_model_id: v })}
          />
        </label>
      </div>
      <p className="help">
        回答模型支持图片输入时直接看图，否则先由图片理解模型读取原图。未配置读图模型时明确提示。
      </p>
      <label className="field">
        <span>默认系统提示词</span>
        <Textarea
          value={value.system_prompt || ""}
          onChange={(v) => setValue({ ...value, system_prompt: v })}
          autosize={{ minRows: 8, maxRows: 18 }}
          maxlength={16000}
        />
      </label>
      <div className="form-actions">
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await send(
                "/settings/qa-defaults",
                {
                  system_prompt: value.system_prompt,
                  model_id: value.model_id || "",
                  vision_model_id: value.vision_model_id || "",
                },
                "PUT",
              );
              setting.reload();
              MessagePlugin.success("问答设置已保存");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          保存问答设置
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            setValue({
              ...value,
              system_prompt:
                setting.data?.default_system_prompt || value.system_prompt,
              model_id: "",
              vision_model_id: "",
            })
          }
        >
          恢复默认
        </Button>
      </div>
    </div>
  );
}
