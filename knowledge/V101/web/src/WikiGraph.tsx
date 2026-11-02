import { useEffect, useMemo, useState } from "react";
import { Button, Select, Tag, Tabs } from "tdesign-react";
import { BookOpenIcon, CloseIcon, ChevronRightIcon } from "tdesign-icons-react";
import { Row } from "./api";
import { Busy, Empty, ErrorNotice, Status, useData } from "./ui";
import NetworkCanvas, { NetworkFrame } from "./NetworkCanvas";
import { networkPalette } from "./networkLayout";
import { WikiContent } from "./WikiContent";
const { TabPanel } = Tabs;

export default function WikiGraph({
  graph,
  knowledgeBaseId,
  folders = [],
  onOpen,
  documentScope,
}: {
  graph: Row;
  knowledgeBaseId: string;
  folders?: Row[];
  onOpen: (id: string) => void;
  documentScope?: { id: string; query: string };
}) {
  const [selected, setSelected] = useState("");
  const [scope, setScope] = useState(graph.edges.length ? "linked" : "all");
  const signature = JSON.stringify(graph);
  const data: Row = useMemo(() => JSON.parse(signature), [signature]);
  const connected = useMemo(
    () =>
      new Set<string>(
        data.edges.flatMap((e: Row) => [e.source_id, e.target_id]),
      ),
    [data],
  );
  const visible = useMemo(
    () =>
      data.nodes.filter(
        (n: Row) =>
          scope === "all" ||
          (scope === "linked" ? connected.has(n.id) : !connected.has(n.id)),
      ),
    [data, scope, connected],
  );
  const page = data.nodes.find((n: Row) => n.id === selected);
  const detail = useData<Row>(
    selected
      ? documentScope
        ? `/knowledge/${documentScope.id}/wiki/pages/${selected}?${documentScope.query}`
        : `/knowledge-bases/${knowledgeBaseId}/wiki/pages/${selected}`
      : "",
  );
  useEffect(() => {
    if (selected && !page) setSelected("");
  }, [page, selected]);
  const outgoing = data.edges.filter((e: Row) => e.source_id === selected);
  const incoming = data.edges.filter((e: Row) => e.target_id === selected);
  function select(id: string) {
    setSelected(id);
    if (id && !visible.some((n: Row) => n.id === id)) setScope("all");
  }
  const nodes = visible.map((n: Row) => {
    const index = folders.findIndex((f) => f.id === n.folder_id);
    return {
      id: n.id,
      label: n.title,
      category: !connected.has(n.id)
        ? "未关联页面"
        : index >= 0
          ? folders[index].name
          : "Wiki 页面",
      color: !connected.has(n.id)
        ? "#a5afbb"
        : networkPalette[Math.max(0, index) % networkPalette.length],
    };
  });
  const links = data.edges.map((e: Row) => ({
    id: `${e.source_id}:${e.target_id}`,
    source: e.source_id,
    target: e.target_id,
    label: e.kind === "related" ? "关联页面" : "页面引用",
    dashed: e.kind === "related",
  }));
  const relationList = (edges: Row[], inward: boolean) =>
    edges.length ? (
      edges.map((e) => (
        <Button
          key={e.source_id + e.target_id}
          variant="text"
          className="wiki-related-page"
          title={inward ? e.source_title : e.target_title}
          onClick={() => select(inward ? e.source_id : e.target_id)}
        >
          <BookOpenIcon />
          <span>{inward ? e.source_title : e.target_title}</span>
          <ChevronRightIcon />
        </Button>
      ))
    ) : (
      <p className="help">暂无页面关系</p>
    );
  return (
    <NetworkFrame>
      <div className="network-heading">
        <div>
          <b>Wiki 页面关系图</b>
          <span>
            {documentScope ? "本文件贡献内容中的页面关系" : "文章引用与关联"}
          </span>
        </div>
        <span>
          {data.nodes.length} 个页面 · {data.edges.length} 条关系
        </span>
      </div>
      <div className={`network-workspace ${page ? "has-detail" : ""}`}>
        {visible.length ? (
          <NetworkCanvas
            nodes={nodes}
            links={links}
            selected={selected}
            onSelect={select}
            onOpen={onOpen}
            searchPlaceholder="搜索当前范围的 Wiki 页面"
            legendTitle={folders.length ? "页面目录" : "页面关系"}
            hint="点击阅读文章 · 双击打开页面"
            scopeControl={
              <Select
                size="small"
                value={scope}
                onChange={(v) => {
                  setScope(String(v));
                  setSelected("");
                }}
                options={[
                  { value: "all", label: `全部页面 · ${data.nodes.length}` },
                  { value: "linked", label: `已关联 · ${connected.size}` },
                  {
                    value: "isolated",
                    label: `未关联 · ${data.nodes.length - connected.size}`,
                  },
                ]}
              />
            }
          />
        ) : (
          <div className="network-no-data">
            <Select
              value={scope}
              onChange={(v) => setScope(String(v))}
              options={[
                { value: "all", label: "全部页面" },
                { value: "linked", label: "已关联" },
                { value: "isolated", label: "未关联" },
              ]}
            />
            <Empty
              title="此范围暂无页面"
              detail="切换范围查看其他 Wiki 页面。"
            />
          </div>
        )}
        {page && (
          <aside
            className="network-inspector wiki-network-reader"
            aria-label="Wiki 页面关系详情"
          >
            <header>
              <span>
                <BookOpenIcon /> Wiki 页面
              </span>
              <Button
                size="small"
                variant="text"
                shape="square"
                icon={<CloseIcon />}
                aria-label="关闭页面关系详情"
                onClick={() => setSelected("")}
              />
            </header>
            <div className="network-inspector-scroll" key={selected}>
              <h2>{page.title}</h2>
              <div className="network-detail-meta">
                <Status value={page.state} />
                <Tag size="small" variant="light">
                  {incoming.length + outgoing.length} 条页面关系
                </Tag>
              </div>
              <Button
                size="small"
                variant="outline"
                icon={<BookOpenIcon />}
                onClick={() => onOpen(page.id)}
              >
                {documentScope ? "阅读本文件内容" : "打开完整页面"}
              </Button>
              <Tabs defaultValue="article">
                <TabPanel value="article" label="页面内容">
                  <ErrorNotice message={detail.error} />
                  {documentScope && detail.data?.shared && (
                    <Tag size="small" variant="light">
                      共享 Wiki 页面 · 当前仅展示本文件内容
                    </Tag>
                  )}
                  {documentScope && detail.data?.reason && (
                    <p className="help">{detail.data.reason}</p>
                  )}
                  {documentScope && detail.data?.full_page_url && (
                    <Button
                      size="small"
                      variant="text"
                      href={detail.data.full_page_url}
                    >
                      查看完整 Wiki 页面
                    </Button>
                  )}
                  {!detail.data && detail.loading ? (
                    <Busy />
                  ) : (
                    detail.data && (
                      <WikiContent
                        text={detail.data.content || ""}
                        pages={data.nodes}
                        onSelectPage={select}
                      />
                    )
                  )}
                </TabPanel>
                <TabPanel value="links" label="页面关系">
                  <h3>
                    指向的页面 <span>{outgoing.length}</span>
                  </h3>
                  {relationList(outgoing, false)}
                  <h3>
                    链接到本页 <span>{incoming.length}</span>
                  </h3>
                  {relationList(incoming, true)}
                </TabPanel>
              </Tabs>
            </div>
          </aside>
        )}
      </div>
      <div className="network-footer">
        <span>实线：正文引用 · 虚线：关联页面 · 节点大小表示相邻页面数量</span>
        <span>
          {scope === "linked" && data.nodes.length > connected.size
            ? `${data.nodes.length - connected.size} 个未关联页面可在范围中查看`
            : data.unresolved_references
              ? `${data.unresolved_references} 处引用${documentScope ? "位于本文件范围之外或未匹配" : "未匹配到已有页面"}`
              : "仅显示已有页面之间的真实关系"}
        </span>
      </div>
    </NetworkFrame>
  );
}
