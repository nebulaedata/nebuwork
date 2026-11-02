import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ReactFlow,
  Handle,
  Position,
  useNodesState,
  useViewport,
  BaseEdge,
  EdgeLabelRenderer,
  MarkerType,
  type NodeProps,
  type EdgeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button, Checkbox, Select, Tooltip } from "tdesign-react";
import {
  SearchIcon,
  AddIcon,
  MinusIcon,
  Fullscreen1Icon,
  CloseIcon,
  RefreshIcon,
  LinkIcon,
} from "tdesign-icons-react";
import {
  networkLayout,
  nodeRadius,
  type NetworkNode,
  type NetworkLink,
} from "./networkLayout";

function Dot({ data, selected }: NodeProps) {
  const { zoom } = useViewport();
  const visible = data.labelY !== undefined;
  return (
    <div
      className={`network-dot ${selected ? "is-selected" : ""}`}
      style={
        {
          "--node-color": String(data.color),
          "--dot-scale": Math.max(1, Math.min(4, 0.7 / zoom)),
          "--label-scale": Math.max(0.65, Math.min(4, 1 / zoom)),
          "--label-y": `${Number(data.labelY || 0)}px`,
        } as React.CSSProperties
      }
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <span className="network-dot-fill" />
      {visible && (
        <span
          className={`network-node-label ${selected || data.active ? "is-active" : ""}`}
        >
          {String(data.label)}
        </span>
      )}
      <span className="network-node-tooltip">
        {String(data.label)} · {String(data.degree)} 个邻居
      </span>
    </div>
  );
}
function Connection({
  id,
  data,
  style,
  markerEnd,
  interactionWidth,
}: EdgeProps) {
  const { zoom } = useViewport();
  const a = data?.from as { x: number; y: number; r: number },
    b = data?.to as typeof a;
  if (!a || !b) return null;
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = Math.hypot(dx, dy) || 1;
  const sx = a.x + (dx / length) * (a.r + 2),
    sy = a.y + (dy / length) * (a.r + 2);
  const tx = b.x - (dx / length) * (b.r + 4),
    ty = b.y - (dy / length) * (b.r + 4);
  const offset = Number(data?.offset || 0),
    cx = (sx + tx) / 2 - (dy / length) * offset,
    cy = (sy + ty) / 2 + (dx / length) * offset;
  const loop = data?.self;
  const path = loop
    ? `M ${a.x - a.r} ${a.y} C ${a.x - 70} ${a.y - 80}, ${a.x + 70} ${a.y - 80}, ${a.x + a.r} ${a.y}`
    : `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          ...style,
          // React Flow scales the surrounding HTML viewport. SVG's
          // non-scaling-stroke cannot compensate for that CSS transform.
          strokeWidth: Number(style?.strokeWidth || 1) / zoom,
          strokeDasharray: style?.strokeDasharray
            ? `${4 / zoom} ${3 / zoom}`
            : undefined,
        }}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth || 16}
      />
      {data?.showLabel && (
        <EdgeLabelRenderer>
          <span
            className="network-edge-label"
            style={{
              transform: `translate(-50%, -50%) translate(${loop ? a.x : (sx + 2 * cx + tx) / 4}px,${loop ? a.y - 58 : (sy + 2 * cy + ty) / 4}px) scale(${Math.min(3, 1 / zoom)})`,
            }}
          >
            {String(data.label || "")}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
const nodeTypes = { dot: Dot },
  edgeTypes = { connection: Connection };

export function NetworkFrame({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", escape);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", escape);
      document.body.style.overflow = previous;
    };
  }, [expanded]);
  return (
    <div className={`network-frame ${expanded ? "is-expanded" : ""}`}>
      <Tooltip content={expanded ? "退出全屏（Esc）" : "全屏查看"}>
        <Button
          className="network-expand"
          variant="text"
          shape="square"
          size="small"
          icon={expanded ? <CloseIcon /> : <Fullscreen1Icon />}
          aria-label={expanded ? "退出图谱全屏" : "全屏查看图谱"}
          onClick={() => setExpanded((v) => !v)}
        />
      </Tooltip>
      {children}
    </div>
  );
}

export default function NetworkCanvas({
  nodes: input,
  links,
  selected,
  selectedEdge = "",
  onSelect,
  onSelectEdge,
  onOpen,
  scopeControl,
  searchPlaceholder,
  legendTitle = "节点类型",
  hint,
}: {
  nodes: NetworkNode[];
  links: NetworkLink[];
  selected: string;
  selectedEdge?: string;
  onSelect: (id: string) => void;
  onSelectEdge?: (id: string) => void;
  onOpen?: (id: string) => void;
  scopeControl?: ReactNode;
  searchPlaceholder: string;
  legendTitle?: string;
  hint?: string;
}) {
  const [hidden, setHidden] = useState<string[]>([]),
    [hover, setHover] = useState("");
  const [hoverEdge, setHoverEdge] = useState("");
  const [zoom, setZoom] = useState(1);
  const [allLabels, setAllLabels] = useState(false),
    [arrows, setArrows] = useState(false),
    [ego, setEgo] = useState("");
  const [flow, setFlow] = useState<ReactFlowInstance<any, any>>();
  const canvas = useRef<HTMLDivElement>(null);
  const selection = useRef("");
  selection.current = selected || selectedEdge;
  const key = JSON.stringify({ input, links });
  const stable = useMemo(
    () => JSON.parse(key) as { input: NetworkNode[]; links: NetworkLink[] },
    [key],
  );
  const layout = useMemo(
    () => networkLayout(stable.input, stable.links),
    [stable],
  );
  const categories = useMemo(
    () =>
      [
        ...new Set(stable.input.flatMap((n) => n.categories || [n.category])),
      ].map((name) => ({
        name,
        color: stable.input.find(
          (n) => n.category === name || n.categories?.includes(name),
        )!.color,
        count: stable.input.filter(
          (n) => n.category === name || n.categories?.includes(name),
        ).length,
      })),
    [stable],
  );
  const major = useMemo(
    () =>
      new Set(
        [...layout.landmarks]
          .sort(
            (a, b) =>
              (layout.degree.get(b) || 0) - (layout.degree.get(a) || 0) ||
              a.localeCompare(b),
          )
          .slice(0, 8),
      ),
    [layout],
  );
  const initial = useMemo(
    () =>
      stable.input.map((n) => {
        const degree = layout.degree.get(n.id) || 0,
          radius = nodeRadius(degree),
          point = layout.positions.get(n.id)!;
        return {
          id: n.id,
          type: "dot",
          position: { x: point.x - radius, y: point.y - radius },
          style: { width: radius * 2, height: radius * 2 },
          data: {
            ...n,
            radius,
            degree,
            major: major.has(n.id) || stable.input.length <= 24,
            landmark: layout.landmarks.has(n.id) || stable.input.length <= 24,
          },
          ariaLabel: n.label,
        };
      }),
    [stable, layout, major],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initial);
  useEffect(
    () =>
      setNodes((old) =>
        initial.map((n) => ({
          ...n,
          position: old.find((p) => p.id === n.id)?.position || n.position,
        })),
      ),
    [initial, setNodes],
  );
  const visibility = useMemo(
    () =>
      new Set(
        stable.input
          .filter(
            (n) =>
              (n.categories || [n.category]).some((c) => !hidden.includes(c)) &&
              (!ego || n.id === ego || layout.adjacency.get(ego)?.has(n.id)),
          )
          .map((n) => n.id),
      ),
    [stable, hidden, ego, layout],
  );
  useEffect(() => {
    if (ego && !stable.input.some((n) => n.id === ego)) setEgo("");
  }, [stable, ego]);
  useEffect(() => {
    if (!selected) return;
    const category = stable.input.find((n) => n.id === selected)?.category;
    setHidden((old) =>
      old.includes(category || "") ? old.filter((c) => c !== category) : old,
    );
    if (ego && selected !== ego && !layout.adjacency.get(ego)?.has(selected))
      setEgo("");
  }, [selected, stable, ego, layout]);
  const filterKey = [...visibility].sort().join("|");
  const previousFilter = useRef("");
  useEffect(() => {
    if (!flow || filterKey === previousFilter.current) return;
    previousFilter.current = filterKey;
    const timer = setTimeout(
      () =>
        flow.fitView({
          nodes: [...visibility].map((id) => ({ id })),
          padding: 0.25,
          maxZoom: 1.35,
          duration: 250,
        }),
      100,
    );
    return () => clearTimeout(timer);
  }, [filterKey, flow]);
  useEffect(() => {
    if (!canvas.current || !flow) return;
    let timer: ReturnType<typeof setTimeout>;
    let previous: { width: number; height: number } | undefined;
    const observer = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      const size = entry.contentRect;
      const old = previous;
      previous = { width: size.width, height: size.height };
      timer = setTimeout(() => {
        if (selection.current && old) {
          const viewport = flow.getViewport();
          void flow.setViewport({
            ...viewport,
            x: viewport.x + (size.width - old.width) / 2,
            y: viewport.y + (size.height - old.height) / 2,
          });
        } else
          void flow.fitView({ padding: 0.25, maxZoom: 1.35, duration: 200 });
      }, 120);
    });
    observer.observe(canvas.current);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [flow]);
  const active = hover || selected;
  const edge = links.find((e) => e.id === (hoverEdge || selectedEdge));
  const adjacent = new Set(
    active
      ? [active, ...(layout.adjacency.get(active) || [])]
      : edge
        ? [edge.source, edge.target]
        : [],
  );
  const byID = new Map(nodes.map((n) => [n.id, n]));
  const pairs = new Map<string, NetworkLink[]>();
  for (const e of stable.links) {
    const pair = [e.source, e.target].sort().join("\0");
    pairs.set(pair, [...(pairs.get(pair) || []), e]);
  }
  const edges = stable.links
    .filter((e) => byID.has(e.source) && byID.has(e.target))
    .map((e) => {
      const source = byID.get(e.source)!,
        target = byID.get(e.target)!;
      const focused =
        e.id === selectedEdge ||
        e.id === hoverEdge ||
        e.source === active ||
        e.target === active;
      const group = pairs.get([e.source, e.target].sort().join("\0"))!;
      const offset =
        (group.indexOf(e) - (group.length - 1) / 2) *
        22 *
        (e.source < e.target ? 1 : -1);
      const stroke = focused ? source.data.color : "#8fa99a";
      const center = (n: typeof source) => ({
        x: n.position.x + n.data.radius,
        y: n.position.y + n.data.radius,
        r: n.data.radius,
      });
      return {
        id: e.id,
        type: "connection",
        source: e.source,
        target: e.target,
        hidden: !visibility.has(e.source) || !visibility.has(e.target),
        markerEnd:
          arrows || focused
            ? {
                type: MarkerType.ArrowClosed,
                width: 11,
                height: 11,
                color: stroke,
              }
            : undefined,
        style: {
          stroke,
          strokeWidth: focused ? 1.6 : 1.2,
          opacity: adjacent.size && !focused ? 0.1 : focused ? 0.95 : 0.8,
          strokeDasharray: e.dashed ? "4 4" : undefined,
        },
        data: {
          from: center(source),
          to: center(target),
          offset,
          self: e.source === e.target,
          label: e.label,
          showLabel: (e.id === selectedEdge || e.id === hoverEdge) && !!e.label,
        },
        ariaLabel: e.label,
      };
    });
  function locate(id: string) {
    onSelect(id);
    onSelectEdge?.("");
    setHidden((old) =>
      old.filter((c) => c !== stable.input.find((n) => n.id === id)?.category),
    );
    if (ego && id !== ego && !layout.adjacency.get(ego)?.has(id)) setEgo("");
    const node = byID.get(id);
    if (node)
      flow?.setCenter(node.position.x, node.position.y, {
        zoom: 1.25,
        duration: 300,
      });
  }
  function fit() {
    void flow?.fitView({
      nodes: [...visibility].map((id) => ({ id })),
      padding: 0.25,
      maxZoom: 1.35,
      duration: 300,
    });
  }
  // Place screen-space labels in priority order. Long Chinese titles must not
  // overlap when a small neighborhood is selected or the viewport is resized.
  const labelY = new Map<string, number>();
  const occupied: { x: number; y: number; w: number; h: number }[] = [];
  const labelScale = zoom * Math.max(0.65, Math.min(4, 1 / zoom));
  const dotScale = Math.max(1, Math.min(4, 0.7 / zoom));
  const labeled = nodes
    .filter(
      (n) =>
        visibility.has(n.id) &&
        (n.id === selected ||
          adjacent.has(n.id) ||
          allLabels ||
          (n.data.landmark && (n.data.major || zoom > 0.7)) ||
          zoom > 1.15),
    )
    .sort(
      (a, b) =>
        Number(b.id === selected) - Number(a.id === selected) ||
        Number(adjacent.has(b.id)) - Number(adjacent.has(a.id)) ||
        b.data.degree - a.data.degree ||
        a.id.localeCompare(b.id),
    );
  for (const n of labeled) {
    const width =
      Math.min(
        n.id === selected || adjacent.has(n.id) ? 200 : 125,
        [...n.data.label].reduce(
          (sum, c) => sum + (c.charCodeAt(0) > 255 ? 11 : 6),
          6,
        ),
      ) * labelScale;
    const height = 17 * labelScale;
    const x = (n.position.x + n.data.radius) * zoom - width / 2;
    const y = (n.position.y + n.data.radius) * zoom;
    const gap = n.data.radius * dotScale * zoom + 6;
    const offsets = [
      gap,
      -gap - height,
      gap + height + 4,
      -gap - 2 * height - 4,
    ];
    const offset = offsets.find(
      (dy) =>
        !occupied.some(
          (r) =>
            x < r.x + r.w + 5 &&
            x + width + 5 > r.x &&
            y + dy < r.y + r.h + 3 &&
            y + dy + height + 3 > r.y,
        ),
    );
    if (offset === undefined && !allLabels) continue;
    const dy = offset ?? gap;
    labelY.set(n.id, dy / zoom);
    occupied.push({ x, y: y + dy, w: width, h: height });
  }
  return (
    <div className="network-canvas" ref={canvas}>
      <ReactFlow
        nodes={nodes.map((n) => ({
          ...n,
          hidden: !visibility.has(n.id),
          selected: n.id === selected,
          data: {
            ...n.data,
            active: adjacent.has(n.id),
            labelY: labelY.get(n.id),
          },
          style: {
            ...n.style,
            opacity: adjacent.size && !adjacent.has(n.id) ? 0.16 : 1,
          },
        }))}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onInit={setFlow}
        onMove={(_, viewport) => setZoom(viewport.zoom)}
        onNodeClick={(_, n) => {
          onSelect(n.id);
          onSelectEdge?.("");
        }}
        onNodeDoubleClick={(_, n) => onOpen?.(n.id)}
        onNodeMouseEnter={(_, n) => setHover(n.id)}
        onNodeMouseLeave={() => setHover("")}
        onEdgeMouseEnter={(_, e) => setHoverEdge(e.id)}
        onEdgeMouseLeave={() => setHoverEdge("")}
        onEdgeClick={(_, e) => {
          if (onSelectEdge) {
            onSelect("");
            onSelectEdge(e.id);
          } else onSelect(e.source);
        }}
        onPaneClick={() => {
          onSelect("");
          onSelectEdge?.("");
        }}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.35 }}
        minZoom={0.04}
        maxZoom={3}
        nodesConnectable={false}
        selectionOnDrag={false}
        onlyRenderVisibleElements
      />
      <div className="network-search">
        <Select
          filterable
          clearable
          prefixIcon={<SearchIcon />}
          value={selected}
          placeholder={searchPlaceholder}
          options={stable.input.map((n) => ({ value: n.id, label: n.label }))}
          onChange={(v) => (v ? locate(String(v)) : onSelect(""))}
        />
        {scopeControl}
      </div>
      <aside className="network-legend" aria-label="图谱显示设置">
        <div className="network-legend-title">{legendTitle}</div>
        <div className="network-legend-items">
          {categories.map((c) => (
            <Button
              key={c.name}
              variant="text"
              size="small"
              className={hidden.includes(c.name) ? "is-hidden" : ""}
              aria-pressed={!hidden.includes(c.name)}
              title={c.name}
              onClick={() => {
                setHidden((old) =>
                  old.includes(c.name)
                    ? old.filter((n) => n !== c.name)
                    : [...old, c.name],
                );
                if (
                  stable.input.find((n) => n.id === selected)?.category ===
                  c.name
                )
                  onSelect("");
              }}
            >
              <i style={{ background: c.color }} />
              <span>{c.name}</span>
              <small>{c.count}</small>
            </Button>
          ))}
        </div>
        <div className="network-legend-options">
          <Checkbox checked={allLabels} onChange={setAllLabels}>
            全部名称
          </Checkbox>
          <Checkbox checked={arrows} onChange={setArrows}>
            关系箭头
          </Checkbox>
        </div>
        <div className="network-legend-count">
          <b>{visibility.size}</b> / {input.length} 个节点
          <span>{ego ? "当前节点及相邻节点" : "当前展示范围"}</span>
        </div>
      </aside>
      {!visibility.size && (
        <div className="network-empty">
          当前筛选下没有节点
          <Button
            variant="text"
            onClick={() => {
              setHidden([]);
              setEgo("");
            }}
          >
            重置筛选
          </Button>
        </div>
      )}
      <div className="network-actions">
        {selected && (
          <Button
            size="small"
            variant="outline"
            icon={<LinkIcon />}
            onClick={() => {
              setHidden([]);
              setEgo(selected);
            }}
          >
            只看相邻节点
          </Button>
        )}
        {ego && (
          <Button
            size="small"
            variant="outline"
            icon={<RefreshIcon />}
            onClick={() => setEgo("")}
          >
            返回全图
          </Button>
        )}
      </div>
      <div className="network-zoom">
        <Tooltip content="放大">
          <Button
            variant="text"
            shape="square"
            icon={<AddIcon />}
            aria-label="放大图谱"
            onClick={() => flow?.zoomIn({ duration: 200 })}
          />
        </Tooltip>
        <Tooltip content="缩小">
          <Button
            variant="text"
            shape="square"
            icon={<MinusIcon />}
            aria-label="缩小图谱"
            onClick={() => flow?.zoomOut({ duration: 200 })}
          />
        </Tooltip>
        <Tooltip content="适应画布">
          <Button
            variant="text"
            shape="square"
            icon={<Fullscreen1Icon />}
            aria-label="适应画布"
            onClick={fit}
          />
        </Tooltip>
      </div>
      <div className="network-hint">
        拖动节点与画布 · 滚轮缩放 · {hint || "点击节点或连线查看详情"}
      </div>
    </div>
  );
}
