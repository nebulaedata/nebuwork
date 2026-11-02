import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Dialog,
  Input,
  Textarea,
  Table,
  Space,
  Select,
  Tree,
  Tooltip,
  Radio,
} from "tdesign-react";
import {
  AddIcon,
  SearchIcon,
  FileIcon,
  FolderIcon,
  RefreshIcon,
  EditIcon,
  HistoryIcon,
  DeleteIcon,
  BookOpenIcon,
} from "tdesign-icons-react";
import { api, send, Row } from "./api";
import {
  action,
  Busy,
  confirmDelete,
  Empty,
  ErrorNotice,
  Status,
  useData,
  usePath,
} from "./ui";
import { WikiContent, wikiHeadings, cleanWikiContent } from "./WikiContent";

const WikiGraph = lazy(() => import("./WikiGraph"));

export function Wiki({
  id,
  onRebuild,
}: {
  id: string;
  onRebuild?: () => void;
}) {
  const graph = useData<Row>(
    "/knowledge-bases/" + id + "/wiki/graph?view=overview",
    10000,
  );
  const [view, setView] = useState("reader");
  const folders = useData<Row[]>("/knowledge-bases/" + id + "/wiki/folders");
  const locationPath = usePath();
  const [selected, setSelected] = useState(
    new URLSearchParams(location.search).get("wiki_page") || "",
  );
  useEffect(() => {
    const page = new URLSearchParams(location.search).get("wiki_page");
    if (page) {
      setSelected(page);
      setView("reader");
    }
  }, [locationPath]);
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<Row | null>(null);
  const [history, setHistory] = useState(false);
  const [revisions, setRevisions] = useState<Row[]>([]);
  const [folderName, setFolderName] = useState("");
  const reader = useRef<HTMLDivElement>(null);
  const catalog: Row[] = graph.data?.nodes || [];
  const pageID = catalog.some((p) => p.id === selected)
    ? selected
    : catalog[0]?.id;
  const detail = useData<Row>(
    pageID ? `/knowledge-bases/${id}/wiki/pages/${pageID}` : "",
    10000,
  );
  const current = detail.data;
  const pages = {
    ...graph,
    data: graph.data?.nodes as Row[] | undefined,
    reload: () => {
      graph.reload();
      detail.reload();
    },
  };
  const headings = useMemo(
    () => wikiHeadings(current?.content || ""),
    [current?.content],
  );
  function selectPage(value: string) {
    setSelected(value);
    setView("reader");
    reader.current?.scrollTo({ top: 0 });
  }
  const tree = useMemo(() => {
    const visible = (pages.data || []).filter((p) =>
      p.title.toLowerCase().includes(search.toLowerCase()),
    );
    const leaf = (p: Row) => ({
      value: p.id,
      label: p.title,
      icon: <FileIcon />,
      state: p.state,
    });
    if (search) return visible.map(leaf);
    const folderNodes = (folders.data || []).map((f) => ({
      value: `folder:${f.id}`,
      label: f.name,
      icon: <FolderIcon />,
      activable: false,
      children: visible.filter((p) => p.folder_id === f.id).map(leaf),
    }));
    const folderIds = new Set((folders.data || []).map((f) => f.id));
    return [
      ...folderNodes,
      ...visible.filter((p) => !folderIds.has(p.folder_id)).map(leaf),
    ];
  }, [pages.data, folders.data, search]);
  async function save() {
    if (!edit) return;
    const saved = await send(
      "/knowledge-bases/" + id + "/wiki/pages" + (edit.id ? "/" + edit.id : ""),
      {
        title: edit.title,
        content: edit.content,
        source_ids: edit.source_ids || [],
        folder_id: edit.folder_id || null,
      },
      edit.id ? "PUT" : "POST",
    );
    setSelected(saved.id);
    setEdit(null);
    pages.reload();
  }
  return (
    <div className="wiki-workspace">
      <div className="wiki-view-toolbar">
        <Radio.Group
          variant="default-filled"
          theme="button"
          size="small"
          value={view}
          onChange={(v) => setView(String(v))}
          options={[
            { value: "reader", label: "页面阅读" },
            { value: "graph", label: "Wiki 页面关系图" },
          ]}
        />
        <span>文章之间的引用与关联</span>
        <Button
          size="small"
          variant="text"
          icon={<RefreshIcon />}
          onClick={pages.reload}
        >
          刷新
        </Button>
      </div>
      <ErrorNotice message={pages.error || folders.error || detail.error} />
      {view === "graph" ? (
        graph.data ? (
          <Suspense fallback={<Busy />}>
            <WikiGraph
              graph={graph.data}
              knowledgeBaseId={id}
              folders={folders.data || []}
              onOpen={selectPage}
            />
          </Suspense>
        ) : graph.error ? null : (
          <Busy />
        )
      ) : (
        <div className="wiki-browser">
          <aside className="wiki-sidebar" aria-label="Wiki 页面目录">
            <div className="wiki-sidebar-head">
              <span>
                <BookOpenIcon /> 知识页面 <b>{pages.data?.length ?? 0}</b>
              </span>
              <Tooltip content="新建页面">
                <Button
                  variant="text"
                  shape="square"
                  size="small"
                  icon={<AddIcon />}
                  aria-label="新建 Wiki 页面"
                  onClick={() =>
                    setEdit({ title: "", content: "", source_ids: [] })
                  }
                />
              </Tooltip>
            </div>
            <div className="wiki-search">
              <Input
                prefixIcon={<SearchIcon />}
                clearable
                value={search}
                onChange={setSearch}
                placeholder="搜索 Wiki 页面"
              />
            </div>
            <div className="wiki-directory">
              {pages.loading && !pages.data ? (
                <Busy />
              ) : tree.length ? (
                <Tree
                  data={tree}
                  icon={(node) => node.data.icon}
                  activable
                  actived={current ? [current.id] : []}
                  expandLevel={1}
                  expandOnClickNode
                  transition={false}
                  label={(node) => (
                    <Tooltip content={String(node.label)} placement="right">
                      <span className="wiki-tree-label">
                        {String(node.label)}
                        {node.data.state === "stale" && (
                          <i className="wiki-stale-dot" />
                        )}
                      </span>
                    </Tooltip>
                  )}
                  onActive={(values) => {
                    const value = String(values[0] || "");
                    if (value && !value.startsWith("folder:"))
                      selectPage(value);
                  }}
                />
              ) : (
                <div className="wiki-sidebar-empty">
                  {search ? "没有匹配的页面" : "还没有知识页面"}
                </div>
              )}
            </div>
            <div className="wiki-sidebar-foot">
              <span>
                {search
                  ? `${tree.length} 个匹配页面`
                  : `${pages.data?.length || 0} 个页面`}
              </span>
              <Button
                size="small"
                variant="text"
                icon={<RefreshIcon />}
                onClick={
                  onRebuild ||
                  (() =>
                    action(() =>
                      send("/knowledge-bases/" + id + "/wiki/rebuild", {}),
                    ))
                }
              >
                重新生成
              </Button>
            </div>
          </aside>
          {pageID && !current ? (
            <Busy />
          ) : current ? (
            <div className="wiki-reader">
              <div className="wiki-reader-toolbar">
                <span className="wiki-breadcrumb">
                  <BookOpenIcon /> Wiki <span>/</span>{" "}
                  {folders.data?.find((f) => f.id === current.folder_id)
                    ?.name || "全部页面"}
                </span>
                <Space size={2}>
                  <Tooltip content="编辑页面">
                    <Button
                      size="small"
                      variant="text"
                      shape="square"
                      icon={<EditIcon />}
                      aria-label="编辑 Wiki 页面"
                      onClick={() => setEdit({ ...current })}
                    />
                  </Tooltip>
                  <Tooltip content="修订记录">
                    <Button
                      size="small"
                      variant="text"
                      shape="square"
                      icon={<HistoryIcon />}
                      aria-label="Wiki 修订记录"
                      onClick={() =>
                        action(async () => {
                          setRevisions(
                            await api(
                              "/knowledge-bases/" +
                                id +
                                "/wiki/pages/" +
                                current.id +
                                "/revisions",
                            ),
                          );
                          setHistory(true);
                        })
                      }
                    />
                  </Tooltip>
                  <Tooltip content="删除页面">
                    <Button
                      size="small"
                      variant="text"
                      shape="square"
                      icon={<DeleteIcon />}
                      aria-label="删除 Wiki 页面"
                      onClick={() =>
                        confirmDelete(
                          current.title,
                          () =>
                            api(
                              "/knowledge-bases/" +
                                id +
                                "/wiki/pages/" +
                                current.id,
                              { method: "DELETE" },
                            ),
                          pages.reload,
                        )
                      }
                    />
                  </Tooltip>
                </Space>
              </div>
              <div className="wiki-reading-layout">
                <div className="wiki-reader-scroll" ref={reader}>
                  <article className="wiki-article">
                    <header>
                      <h1>{current.title}</h1>
                      <div className="wiki-reader-meta">
                        <Status value={current.state} />
                        <span>
                          更新于{" "}
                          {new Date(current.updated_at).toLocaleString(
                            "zh-CN",
                            {
                              year: "numeric",
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </span>
                        <span>{current.source_ids?.length || 0} 条来源</span>
                      </div>
                    </header>
                    <WikiContent
                      text={current.content}
                      pages={pages.data || []}
                      onSelectPage={selectPage}
                    />
                  </article>
                </div>
                {headings.length > 1 && (
                  <nav className="wiki-contents" aria-label="本页目录">
                    <span>本页目录</span>
                    {headings.map((h) => (
                      <Button
                        key={h.id}
                        variant="text"
                        size="small"
                        title={h.text}
                        className={h.level > 2 ? "is-nested" : ""}
                        onClick={() => {
                          const el = reader.current?.querySelector(
                            `[id="${h.id}"]`,
                          );
                          if (el && reader.current)
                            reader.current.scrollTo({
                              top:
                                reader.current.scrollTop +
                                el.getBoundingClientRect().top -
                                reader.current.getBoundingClientRect().top -
                                20,
                              behavior: "smooth",
                            });
                        }}
                      >
                        {h.text}
                      </Button>
                    ))}
                  </nav>
                )}
              </div>
            </div>
          ) : (
            <div className="wiki-reader">
              <Empty
                title="暂无 Wiki 页面"
                detail="生成完成后，可在左侧目录浏览知识页面和原文来源。"
                action={
                  <Button
                    onClick={() =>
                      setEdit({ title: "", content: "", source_ids: [] })
                    }
                  >
                    新建页面
                  </Button>
                }
              />
            </div>
          )}
        </div>
      )}
      <Dialog
        header={edit?.id ? "编辑 Wiki" : "新建 Wiki"}
        visible={!!edit}
        width="min(760px, calc(100vw - 32px))"
        closeOnOverlayClick={false}
        onClose={() => setEdit(null)}
        onConfirm={() => action(save)}
      >
        {edit && (
          <div className="field-stack">
            <Input
              value={edit.title}
              onChange={(v) => setEdit({ ...edit, title: v })}
              placeholder="页面标题"
            />
            <Select
              clearable
              value={edit.folder_id || ""}
              placeholder="选择目录"
              options={(folders.data || []).map((f) => ({
                value: f.id,
                label: f.name,
              }))}
              onChange={(v) => setEdit({ ...edit, folder_id: v || null })}
            />
            <div className="responsive-stack">
              <Input
                value={folderName}
                onChange={setFolderName}
                placeholder="新目录名称"
              />
              <Button
                variant="outline"
                onClick={() =>
                  action(async () => {
                    await send("/knowledge-bases/" + id + "/wiki/folders", {
                      name: folderName,
                    });
                    setFolderName("");
                    folders.reload();
                  })
                }
              >
                创建目录
              </Button>
            </div>
            <Textarea
              value={edit.content}
              onChange={(v) => setEdit({ ...edit, content: v })}
              autosize={{ minRows: 12, maxRows: 25 }}
              placeholder="支持 Markdown，页面链接使用 [[页面标题]]，来源引用使用 [来源](source:来源ID)"
            />
          </div>
        )}
      </Dialog>
      <Dialog
        header="Wiki 修订记录"
        visible={history}
        closeOnOverlayClick={false}
        onClose={() => setHistory(false)}
        footer={false}
        width={720}
      >
        <Table
          rowKey="id"
          tableLayout="fixed"
          data={revisions}
          columns={[
            {
              colKey: "created_at",
              title: "保存时间",
              width: 180,
              cell: ({ row }) =>
                new Date(row.created_at).toLocaleString("zh-CN"),
            },
            {
              colKey: "content",
              title: "内容",
              ellipsis: true,
              cell: ({ row }) =>
                cleanWikiContent(row.content).trim().slice(0, 100),
            },
            {
              colKey: "action",
              title: "操作",
              width: 120,
              cell: ({ row }) => (
                <Button
                  variant="text"
                  onClick={() =>
                    action(async () => {
                      await send(
                        "/knowledge-bases/" +
                          id +
                          "/wiki/pages/" +
                          current!.id +
                          "/revert",
                        { revision_id: row.id },
                      );
                      setHistory(false);
                      pages.reload();
                    })
                  }
                >
                  恢复此版本
                </Button>
              ),
            },
          ]}
        />
      </Dialog>
    </div>
  );
}
