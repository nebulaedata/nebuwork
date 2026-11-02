import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  type Node,
  type NodeProps,
  type Connection,
} from "@xyflow/react";
import { Code2 } from "lucide-react";
import type { Definition, Step } from "./types";
import { states } from "./types";
import "@xyflow/react/dist/style.css";

type StepNode = Node<{ label: string; code: string; state?: string }, "step">;
function StepCard({ data, selected }: NodeProps<StepNode>) {
  return (
    <div
      className={
        "step-node " + (selected ? "selected " : "") + (data.state ?? "")
      }
    >
      <Handle type="target" position={Position.Top} />
      <div className="node-heading">
        <span className="node-icon">
          <Code2 size={16} />
        </span>
        <strong>{data.label}</strong>
        {data.state && <span className={"node-state " + data.state} />}
      </div>
      <div className="node-code">{data.code}</div>
      {data.state && <div className="node-status">{states[data.state]}</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
const nodeTypes = { step: StepCard };
function positions(definition: Definition) {
  const result: Record<string, { x: number; y: number }> = {},
    levels: Record<string, number> = {};
  const entries = Object.entries(definition.steps);
  for (let pass = 0; pass < entries.length; pass++)
    for (const [id, spec] of entries) {
      if (
        levels[id] === undefined &&
        (spec.needs ?? []).every((n) => levels[n] !== undefined)
      )
        levels[id] =
          Math.max(-1, ...(spec.needs ?? []).map((n) => levels[n])) + 1;
    }
  const columns: Record<number, number> = {};
  for (const [id] of entries) {
    const level = levels[id] ?? 0,
      col = columns[level] ?? 0;
    columns[level] = col + 1;
    result[id] = definition.layout?.[id] ?? {
      x: 80 + col * 290,
      y: 50 + level * 175,
    };
  }
  return result;
}
export function Graph({
  definition,
  steps,
  onChange,
  onSelect,
}: {
  definition: Definition;
  steps?: Step[];
  onChange?: (value: Definition) => void;
  onSelect?: (id: string) => void;
}) {
  const coords = useMemo(() => positions(definition), [definition]);
  const initial = useMemo(
    () =>
      Object.entries(definition.steps).map(([id, spec]) => ({
        id,
        type: "step" as const,
        position: coords[id],
        data: {
          label: id,
          code: spec.code,
          state: steps?.find((s) => s.name === id)?.state,
        },
      })),
    [definition, steps, coords],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>(initial);
  useEffect(() => setNodes(initial), [initial, setNodes]);
  const edges = Object.entries(definition.steps).flatMap(([id, spec]) =>
    (spec.needs ?? []).map((from) => ({
      id: from + "->" + id,
      source: from,
      target: id,
      type: "smoothstep",
      animated: steps?.find((s) => s.name === id)?.state === "running",
    })),
  );
  const connect = ({ source, target }: Connection) => {
    if (onChange && source && target && source !== target)
      onChange({
        ...definition,
        steps: {
          ...definition.steps,
          [target]: {
            ...definition.steps[target],
            needs: [
              ...new Set([...(definition.steps[target].needs ?? []), source]),
            ],
          },
        },
      });
  };
  return (
    <div className="graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={connect}
        nodesDraggable={!!onChange}
        nodesConnectable={!!onChange}
        elementsSelectable
        onNodeClick={(_, node) => onSelect?.(node.id)}
        onNodeDragStop={(_, node) =>
          onChange?.({
            ...definition,
            layout: { ...coords, [node.id]: node.position },
          })
        }
        onEdgesDelete={(removed) => {
          if (!onChange) return;
          const copy = structuredClone(definition);
          for (const edge of removed)
            copy.steps[edge.target].needs = (
              copy.steps[edge.target].needs ?? []
            ).filter((n) => n !== edge.source);
          onChange(copy);
        }}
        deleteKeyCode={onChange ? ["Backspace", "Delete"] : null}
        onNodesDelete={(removed) => {
          if (!onChange) return;
          const copy = structuredClone(definition);
          for (const node of removed) {
            delete copy.steps[node.id];
            for (const spec of Object.values(copy.steps))
              spec.needs = (spec.needs ?? []).filter((n) => n !== node.id);
          }
          onChange(copy);
        }}
        fitView
        minZoom={0.25}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#dddddd" gap={22} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
