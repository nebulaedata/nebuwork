import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Input,
  MessagePlugin,
  Radio,
  Space,
  Table,
  Tag,
} from "tdesign-react";
import {
  SearchIcon,
  RefreshIcon,
  CloseIcon,
  LinkIcon,
  ChevronRightIcon,
} from "tdesign-icons-react";
import { api, Row } from "./api";
import { navigate } from "./ui";
import NetworkCanvas, { NetworkFrame } from "./NetworkCanvas";
import { networkPalette } from "./networkLayout";

export default function GraphCanvas({
  graph,
  onRebuild,
  documentScoped = false,
}: {
  graph: Row;
  onRebuild?: () => void;
  documentScoped?: boolean;
}) {
  const [view, setView] = useState("graph"),
    [query, setQuery] = useState("");
  const [selected, setSelected] = useState(""),
    [edgeID, setEdgeID] = useState("");
  const signature = JSON.stringify(graph);
  const data: Row = useMemo(() => JSON.parse(signature), [signature]);
  const visualRelations: Row[] = useMemo(() => {
    if (!documentScoped) return data.relations;
    const groups = new Map<string, Row>();
    for (const r of data.relations) {
      const id = JSON.stringify([r.source, r.relation, r.target]);
      const group = groups.get(id);
      if (group) group.evidences.push(r);
      else groups.set(id, { ...r, id, evidences: [r] });
    }
    return [...groups.values()];
  }, [data, documentScoped]);
  const types: string[] = useMemo(
    () =>
      [
        ...new Set<string>(
          data.nodes.flatMap((n: Row) =>
            n.types?.length ? n.types : [n.type || "未分类"],
          ),
        ),
      ].sort(),
    [data],
  );
  useEffect(() => {
    if (selected && !data.nodes.some((n: Row) => n.name === selected))
      setSelected("");
    if (edgeID && !visualRelations.some((r: Row) => r.id === edgeID))
      setEdgeID("");
  }, [data, visualRelations, selected, edgeID]);
  const entity = data.nodes.find((n: Row) => n.name === selected);
  const relation = visualRelations.find((r: Row) => r.id === edgeID);
  const neighbors = visualRelations.filter(
    (r: Row) => r.source === selected || r.target === selected,
  );
  function focus(id: string) {
    setSelected(id);
    setEdgeID("");
  }
  function openSource(id: string) {
    api<Row>("/sources/" + id)
      .then((s) => navigate(s.preview_url))
      .catch((e) => MessagePlugin.error(e.message));
  }
  const tableRows = data.relations.filter((r: Row) =>
    [r.source, r.target, r.relation, r.quote].some((x) =>
      String(x || "")
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
  );
  return (
    <NetworkFrame>
      <div className="network-heading">
        <div>
          <b>实体知识图谱</b>
          <span>
            {documentScoped
              ? "本文件的实体、关系与原文证据"
              : "实体、事实关系与原文证据"}
          </span>
        </div>
        <Radio.Group
          variant="default-filled"
          size="small"
          value={view}
          onChange={(v) => setView(String(v))}
        >
          <Radio.Button value="graph">图谱</Radio.Button>
          <Radio.Button value="list">关系列表</Radio.Button>
        </Radio.Group>
        {onRebuild && (
          <Button
            size="small"
            variant="text"
            icon={<RefreshIcon />}
            onClick={onRebuild}
          >
            重建图谱
          </Button>
        )}
      </div>
      {data.truncated && (
        <div className="graph-limit">
          {documentScoped ? (
            "当前展示已加载的文档证据，可在下方继续加载；搜索与类型筛选作用于已加载范围。"
          ) : (
            <>
              当前为部分图谱，最多展示 {data.limits?.nodes} 个实体、
              {data.limits?.relations} 条关系。
            </>
          )}
        </div>
      )}
      {view === "graph" ? (
        <div
          className={`network-workspace ${entity || relation ? "has-detail" : ""}`}
        >
          <NetworkCanvas
            nodes={data.nodes.map((n: Row) => ({
              id: n.name,
              label: n.name,
              category: n.type || "未分类",
              categories: n.types?.length ? n.types : undefined,
              color:
                networkPalette[
                  Math.max(0, types.indexOf(n.type || "未分类")) %
                    networkPalette.length
                ],
            }))}
            links={visualRelations.map((r: Row) => ({
              id: r.id,
              source: r.source,
              target: r.target,
              label:
                r.relation +
                (r.evidences?.length > 1
                  ? ` · ${r.evidences.length} 条证据`
                  : ""),
            }))}
            selected={selected}
            selectedEdge={edgeID}
            onSelect={setSelected}
            onSelectEdge={setEdgeID}
            searchPlaceholder="搜索并定位实体"
          />
          {(entity || relation) && (
            <aside className="network-inspector" aria-label="实体与关系证据">
              <header>
                <span>{entity ? "实体详情" : "关系证据"}</span>
                <Button
                  size="small"
                  variant="text"
                  shape="square"
                  icon={<CloseIcon />}
                  aria-label="关闭图谱详情"
                  onClick={() => {
                    setSelected("");
                    setEdgeID("");
                  }}
                />
              </header>
              <div className="network-inspector-scroll">
                {entity ? (
                  <>
                    <Tag variant="light" size="small">
                      {entity.type || "未分类"}
                    </Tag>
                    <h2>{entity.name}</h2>
                    {documentScoped && entity.descriptions?.length ? (
                      entity.descriptions.map((d: Row, i: number) => (
                        <div
                          className="document-entity-description"
                          key={d.evidence_id + d.source_ref_id + i}
                        >
                          <p>{d.text}</p>
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => openSource(d.source_ref_id)}
                          >
                            查看此描述的来源
                          </Button>
                          {!d.synced && (
                            <Tag size="small" variant="light" theme="warning">
                              待同步全库图谱
                            </Tag>
                          )}
                        </div>
                      ))
                    ) : (
                      <p>{entity.description || "暂无实体描述"}</p>
                    )}
                    <h3>
                      关联关系 <span>{neighbors.length}</span>
                    </h3>
                    {neighbors.length ? (
                      neighbors.map((r: Row) => (
                        <Button
                          key={r.id}
                          className="graph-neighbor"
                          variant="text"
                          block
                          onClick={() => {
                            setEdgeID(r.id);
                            setSelected("");
                          }}
                        >
                          <span>
                            <small>
                              {r.relation} ·{" "}
                              {r.source === selected ? "指向" : "来自"}
                            </small>
                            <b>{r.source === selected ? r.target : r.source}</b>
                          </span>
                          <ChevronRightIcon />
                        </Button>
                      ))
                    ) : (
                      <p className="help">当前范围暂无关联关系</p>
                    )}
                    <h3>
                      原文来源 <span>{entity.source_ids?.length || 0}</span>
                    </h3>
                    <Space breakLine>
                      {(entity.source_ids || []).map(
                        (id: string, i: number) => (
                          <Button
                            key={id}
                            size="small"
                            variant="outline"
                            onClick={() => openSource(id)}
                          >
                            来源 {i + 1}
                          </Button>
                        ),
                      )}
                    </Space>
                  </>
                ) : relation ? (
                  <>
                    <Tag variant="light" theme="success" size="small">
                      {relation.relation}
                    </Tag>
                    <div className="graph-relation-pair">
                      <Button
                        variant="text"
                        onClick={() => focus(relation.source)}
                      >
                        {relation.source}
                      </Button>
                      <ChevronRightIcon />
                      <Button
                        variant="text"
                        onClick={() => focus(relation.target)}
                      >
                        {relation.target}
                      </Button>
                    </div>
                    <h3>
                      证据原文{" "}
                      {relation.evidences?.length > 1
                        ? `· ${relation.evidences.length} 条`
                        : ""}
                    </h3>
                    {(relation.evidences || [relation]).map((evidence: Row) => (
                      <div
                        className="graph-entity-description"
                        key={evidence.id}
                      >
                        {documentScoped && !evidence.synced && (
                          <Tag size="small" variant="light" theme="warning">
                            证据已验证，待同步全库图谱
                          </Tag>
                        )}
                        <blockquote>
                          {evidence.quote || "暂无证据摘录"}
                        </blockquote>
                        {evidence.source_ref_id && (
                          <Button
                            size="small"
                            variant="outline"
                            icon={<LinkIcon />}
                            onClick={() => openSource(evidence.source_ref_id)}
                          >
                            定位到原文
                          </Button>
                        )}
                      </div>
                    ))}
                  </>
                ) : null}
              </div>
            </aside>
          )}
        </div>
      ) : (
        <div className="graph-list-view">
          <Input
            value={query}
            onChange={setQuery}
            clearable
            prefixIcon={<SearchIcon />}
            placeholder="搜索实体、关系或证据"
            style={{ maxWidth: 320, marginBottom: 16 }}
          />
          <Table
            rowKey="id"
            tableContentWidth="max(100%, 680px)"
            size="small"
            tableLayout="fixed"
            data={tableRows}
            pagination={{
              pageSize: 10,
              total: tableRows.length,
              showPageSize: false,
            }}
            columns={[
              { colKey: "source", title: "实体", width: 160, ellipsis: true },
              { colKey: "relation", title: "关系", width: 80 },
              {
                colKey: "target",
                title: "关联实体",
                width: 160,
                ellipsis: true,
              },
              { colKey: "quote", title: "证据原文", ellipsis: true },
              {
                colKey: "source_ref_id",
                title: "来源",
                width: 96,
                cell: ({ row }) => (
                  <Button
                    variant="text"
                    size="small"
                    disabled={!row.source_ref_id}
                    onClick={() => openSource(row.source_ref_id)}
                  >
                    查看原文
                  </Button>
                ),
              },
            ]}
          />
        </div>
      )}
      <div className="network-footer">
        <span>颜色区分实体类型 · 节点大小表示相邻实体数量</span>
        <span>
          {data.nodes.length} 个实体 · {data.relations.length} 条关系
          {data.truncated ? "（部分数据）" : ""}
        </span>
      </div>
    </NetworkFrame>
  );
}
