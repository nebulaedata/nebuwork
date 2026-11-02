import { resourceURL } from "./integration";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Input,
  Pagination,
  Radio,
  Space,
  Tag,
  Tree,
} from "tdesign-react";
import { BookOpenIcon, SearchIcon, RefreshIcon } from "tdesign-icons-react";
import { api, Row } from "./api";
import { Busy, Empty, ErrorNotice, navigate, Status, useData } from "./ui";
import { WikiContent } from "./WikiContent";
const WikiGraph = lazy(() => import("./WikiGraph"));
const GraphCanvas = lazy(() => import("./GraphCanvas"));

export function RelatedStage({
  stats,
  kind,
}: {
  stats?: Row;
  kind: "wiki" | "graph";
}) {
  const stage = stats?.stages?.[kind];
  return (
    <div className="related-stage">
      <Space>
        {stage?.state === "empty" ? (
          <Tag size="small">暂无结果</Tag>
        ) : (
          <Status value={stage?.state || "pending"} />
        )}
        <span>
          {kind === "wiki"
            ? `${stats?.wiki_pages ?? "—"} 个 Wiki 页面`
            : `${stats?.entities ?? "—"} 个实体 · ${stats?.relations ?? "—"} 条关系`}
        </span>
        {stats && (
          <span className="muted">
            解析版本 {stats.parse_version_id?.slice(0, 8) || "尚未生成"}
            {!stats.is_current && " · 历史版本"}
          </span>
        )}
      </Space>
      <Button
        size="small"
        variant="text"
        onClick={() =>
          stats && navigate(stats[kind === "wiki" ? "wiki_url" : "graph_url"])
        }
      >
        查看知识库完整{kind === "wiki" ? " Wiki" : "图谱"}
      </Button>
      {stage?.error?.message && (
        <Alert
          theme="warning"
          message={stage.error.message}
          className="related-stage-error"
        />
      )}
      {kind === "graph" && stats && stats.pending_sync_records > 0 && (
        <span className="help">
          {stats.pending_sync_records} 条证据已保存，等待同步全库图谱
        </span>
      )}
    </div>
  );
}

export function DocumentWiki({
  id,
  query,
  stats,
}: {
  id: string;
  query: string;
  stats?: Row;
}) {
  const [view, setView] = useState("reader"),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState("");
  const list = useData<Row[]>(
    `/knowledge/${id}/wiki/pages?${query}&page=${page}&page_size=20&q=${encodeURIComponent(search)}`,
    5000,
  );
  const graph = useData<Row>(`/knowledge/${id}/wiki/graph?${query}`, 5000);
  const pages: Row[] = graph.data?.nodes || [];
  const pageID = selected || list.data?.[0]?.id || "";
  const detail = useData<Row>(
    pageID ? `/knowledge/${id}/wiki/pages/${pageID}?${query}` : "",
    5000,
  );
  const current = detail.data;
  // Match the reader's inline citation numbering; append other saved sources.
  const references = [
    ...new Set<string>([
      ...[
        ...String(current?.content || "").matchAll(/\]\(source:([\w-]+)\)/g),
      ].map((m) => m[1]),
      ...(current?.source_ids || []),
    ]),
  ];
  function select(id: string) {
    setSelected(id);
    setView("reader");
  }
  return (
    <div className="document-related">
      <RelatedStage stats={stats} kind="wiki" />
      <div className="wiki-view-toolbar">
        <Radio.Group
          variant="default-filled"
          value={view}
          onChange={(v) => setView(String(v))}
          size="small"
        >
          <Radio.Button value="reader">页面阅读</Radio.Button>
          <Radio.Button value="graph">Wiki 页面关系图</Radio.Button>
        </Radio.Group>
        <span className="help">仅展示本文件贡献的内容与引用</span>
        <Button
          size="small"
          variant="text"
          icon={<RefreshIcon />}
          onClick={() => {
            list.reload();
            graph.reload();
            detail.reload();
          }}
        >
          刷新
        </Button>
      </div>
      <ErrorNotice message={list.error || graph.error} />
      {view === "graph" ? (
        graph.data?.nodes.length ? (
          <Suspense fallback={<Busy />}>
            <WikiGraph
              graph={graph.data}
              knowledgeBaseId={stats?.knowledge_base_id || ""}
              documentScope={{ id, query }}
              onOpen={select}
            />
          </Suspense>
        ) : graph.loading ? (
          <Busy />
        ) : (
          <Empty
            title="此版本暂无关联 Wiki 页面"
            detail="已成功生成的结果会在这里显示。"
          />
        )
      ) : (
        <div className="wiki-browser document-wiki-browser">
          <aside className="wiki-sidebar" aria-label="本文件 Wiki 页面">
            <div className="wiki-sidebar-head">
              <BookOpenIcon />
              <b>本文件 Wiki</b>
              <Tag size="small">{(list.data as any)?.meta?.total ?? 0}</Tag>
            </div>
            <div className="wiki-search">
              <Input
                value={search}
                onChange={(v) => {
                  setSearch(v);
                  setPage(1);
                  setSelected("");
                }}
                prefixIcon={<SearchIcon />}
                clearable
                placeholder="搜索本文件 Wiki"
              />
            </div>
            <div className="wiki-directory">
              {list.data?.length ? (
                <Tree
                  activable
                  actived={[pageID]}
                  data={list.data.map((p) => ({ value: p.id, label: p.title }))}
                  onActive={(values) => values[0] && select(String(values[0]))}
                />
              ) : (
                <Empty
                  title="暂无匹配页面"
                  detail="生成完成后显示本文件的关联页面。"
                />
              )}
            </div>
            <Pagination
              size="small"
              theme="simple"
              current={page}
              pageSize={20}
              total={(list.data as any)?.meta?.total || 0}
              showPageSize={false}
              onCurrentChange={(v) => {
                setPage(v);
                setSelected("");
              }}
            />
          </aside>
          <div className="wiki-reader">
            <ErrorNotice message={detail.error} />
            {current ? (
              <>
                <div className="wiki-reader-toolbar">
                  <span className="muted">本文件贡献内容</span>
                  <Button
                    size="small"
                    variant="outline"
                    onClick={() => navigate(current.full_page_url)}
                  >
                    查看完整 Wiki 页面
                  </Button>
                </div>
                <div className="wiki-reader-scroll" key={pageID}>
                  <article className="wiki-article">
                    <h1>{current.title}</h1>
                    <Space>
                      <Status value={current.state} />
                      {current.shared && (
                        <Tag theme="primary" variant="light" size="small">
                          共享 Wiki 页面
                        </Tag>
                      )}
                      {current.revision_id && (
                        <Tag size="small" variant="light">
                          历史修订内容
                        </Tag>
                      )}
                    </Space>
                    {current.reason && (
                      <Alert
                        theme="warning"
                        message={current.reason}
                        style={{ marginTop: 16 }}
                      />
                    )}
                    {current.content && (
                      <WikiContent
                        text={current.content}
                        pages={pages}
                        onSelectPage={select}
                      />
                    )}
                    <div className="document-wiki-sources">
                      <h3>本文件原文引用</h3>
                      <Space breakLine>
                        {references.map((ref: string, i: number) => (
                          <Button
                            size="small"
                            variant="outline"
                            key={ref}
                            href={resourceURL(`/documents/${id}?source_ref_id=${ref}&${query}`)}
                          >
                            来源 {i + 1}
                          </Button>
                        ))}
                      </Space>
                    </div>
                  </article>
                </div>
              </>
            ) : pageID && !detail.error ? (
              <Busy />
            ) : (
              <Empty
                title="选择一篇 Wiki"
                detail="这里显示所选文档版本贡献的正文；完整页面可能还包含其他文件的内容。"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Evidence pages may mention the same entity. Merge evidence, not just the
// display name/description, so every contributing source remains accessible.
export function mergeDocumentGraph(pages: Row[]) {
  const nodes = new Map<string, Row>(),
    relations = new Map<string, Row>();
  for (const page of pages) {
    for (const n of page.nodes) {
      const old = nodes.get(n.name);
      if (!old) {
        nodes.set(n.name, { ...n });
        continue;
      }
      const descriptions = [
        ...new Map(
          [...old.descriptions, ...n.descriptions].map((d) => [
            `${d.evidence_id}:${d.source_ref_id}:${d.text}`,
            d,
          ]),
        ).values(),
      ];
      const types = [...new Set<string>([...old.types, ...n.types])].sort();
      nodes.set(n.name, {
        ...n,
        types,
        type: types[0] || "未分类",
        descriptions,
        description: [...new Set(descriptions.map((d) => d.text))].join("\n\n"),
        source_ids: [...new Set([...old.source_ids, ...n.source_ids])],
      });
    }
    for (const r of page.relations) relations.set(r.id, r);
  }
  return {
    nodes: [...nodes.values()],
    relations: [...relations.values()],
    truncated: !!pages.at(-1)?.meta.has_more,
  };
}

export function DocumentGraph({
  id,
  query,
  stats,
}: {
  id: string;
  query: string;
  stats?: Row;
}) {
  const [pages, setPages] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pagesRef = useRef<Row[]>([]),
    request = useRef(false);
  const base = `/knowledge/${id}/graph?${query}&page_size=100`;
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    pagesRef.current = [];
    setPages([]);
    setError("");
    async function refresh() {
      if (request.current) return;
      request.current = true;
      setBusy(true);
      try {
        const refreshed: Row[] = [];
        let cursor = "";
        // Refresh the already-loaded range, retaining it on transient failure.
        const count = Math.max(1, pagesRef.current.length);
        for (let i = 0; i < count; i++) {
          const next = await api<Row>(
            base + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""),
            { signal: controller.signal },
          );
          refreshed.push(next);
          cursor = next.meta.next_cursor;
          if (!next.meta.has_more) break;
        }
        if (active) {
          pagesRef.current = refreshed;
          setPages(refreshed);
          setError("");
        }
      } catch (e) {
        if (active && (e as Error).name !== "AbortError")
          setError((e as Error).message);
      } finally {
        request.current = false;
        if (active) setBusy(false);
      }
    }
    void refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [base]);
  async function more() {
    if (request.current) return;
    const last = pagesRef.current.at(-1);
    if (!last?.meta.has_more) return;
    request.current = true;
    setBusy(true);
    try {
      const next = await api<Row>(
        base + `&cursor=${encodeURIComponent(last.meta.next_cursor)}`,
      );
      const updated = [...pagesRef.current, next];
      pagesRef.current = updated;
      setPages(updated);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      request.current = false;
      setBusy(false);
    }
  }
  const graph = useMemo(() => mergeDocumentGraph(pages), [pages]);
  const loaded = pages.reduce((sum, p) => sum + p.meta.returned_records, 0),
    last = pages.at(-1);
  return (
    <div className="document-related">
      <RelatedStage stats={stats} kind="graph" />
      <ErrorNotice message={error} />
      {!pages.length && busy ? (
        <Busy />
      ) : graph.nodes.length ? (
        <Suspense fallback={<Busy />}>
          <GraphCanvas graph={graph} documentScoped />
        </Suspense>
      ) : (
        <Empty
          title="此版本暂无实体与关系"
          detail="已验证的抽取结果会陆续显示，不需要等待其他分块全部完成。"
        />
      )}
      <div className="related-pagination">
        <span>
          已加载 {loaded} /{" "}
          {last?.meta.total_records ?? stats?.evidence_records ?? 0} 条证据 ·
          当前 {graph.nodes.length} 个实体 / {graph.relations.length} 条关系
        </span>
        {last?.meta.has_more && (
          <Button variant="outline" size="small" loading={busy} onClick={more}>
            继续加载
          </Button>
        )}
      </div>
    </div>
  );
}
