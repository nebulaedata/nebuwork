import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
} from "d3-force";

export type NetworkNode = {
  id: string;
  label: string;
  category: string;
  categories?: string[];
  color: string;
};
export type NetworkLink = {
  id: string;
  source: string;
  target: string;
  label?: string;
  dashed?: boolean;
};
export const networkPalette = [
  "#2ba471",
  "#0052d9",
  "#e37318",
  "#0594fa",
  "#8b5cf6",
  "#d54941",
  "#ad7b44",
];
export const nodeRadius = (degree: number) =>
  Math.min(19, 6 + Math.sqrt(degree) * 2.3);

// Lay out independent components separately so unlinked pages cannot push the
// useful network out of view. Input data and IDs are never changed by d3.
export function networkLayout(nodes: NetworkNode[], links: NetworkLink[]) {
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const adjacency = new Map(ordered.map((n) => [n.id, new Set<string>()]));
  for (const e of links)
    if (
      e.source !== e.target &&
      adjacency.has(e.source) &&
      adjacency.has(e.target)
    ) {
      adjacency.get(e.source)!.add(e.target);
      adjacency.get(e.target)!.add(e.source);
    }
  const degree = new Map(
    [...adjacency].map(([id, neighbors]) => [id, neighbors.size]),
  );
  const unseen = new Set(ordered.map((n) => n.id));
  const components: string[][] = [];
  for (const n of ordered) {
    if (!unseen.delete(n.id)) continue;
    const group = [n.id];
    for (let i = 0; i < group.length; i++)
      for (const next of adjacency.get(group[i])!) {
        if (unseen.delete(next)) group.push(next);
      }
    components.push(group);
  }
  components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  const landmarks = new Set<string>();
  const groups = components
    .filter((c) => c.length > 1)
    .map((ids) => {
      const members = new Set(ids);
      const ranked = [...ids].sort(
        (a, b) => degree.get(b)! - degree.get(a)! || a.localeCompare(b),
      );
      for (const id of ranked.slice(
        0,
        Math.max(1, Math.min(5, Math.ceil(ids.length / 30))),
      ))
        landmarks.add(id);
      const points = ids.map((id, i) => ({
        id,
        x: Math.cos(i * 2.39996) * 24 * Math.sqrt(i),
        y: Math.sin(i * 2.39996) * 24 * Math.sqrt(i),
      }));
      const edges = links
        .filter(
          (e) =>
            members.has(e.source) &&
            members.has(e.target) &&
            e.source !== e.target,
        )
        .map((e) => ({ source: e.source, target: e.target }));
      const simulation = forceSimulation(points)
        .force(
          "links",
          forceLink(edges)
            .id((n: any) => n.id)
            .distance(125)
            .strength(0.4),
        )
        .force("charge", forceManyBody().strength(-320))
        .force(
          "collide",
          forceCollide<any>(
            (p) => nodeRadius(degree.get(p.id) || 0) + 24,
          ).iterations(2),
        )
        .force("x", forceX(0).strength(0.035))
        .force("y", forceY(0).strength(0.045))
        .stop();
      simulation.tick(180);
      const minX = Math.min(...points.map((p) => p.x)),
        minY = Math.min(...points.map((p) => p.y));
      const width = Math.max(...points.map((p) => p.x)) - minX + 130;
      const height = Math.max(...points.map((p) => p.y)) - minY + 100;
      return { points, minX, minY, width, height };
    });
  const positions = new Map<string, { x: number; y: number }>();
  // Pack disconnected groups as an organic overview without inventing links.
  // The collision radius includes labels, keeping each real network distinct.
  const clusters = groups.map((g, i) => ({
    ...g,
    x: Math.cos(i * 2.39996) * 150 * Math.sqrt(i),
    y: Math.sin(i * 2.39996) * 150 * Math.sqrt(i),
    radius: Math.hypot(g.width, g.height) / 2,
  }));
  const packing = forceSimulation(clusters)
    .force("collide", forceCollide<any>((g) => g.radius + 12).iterations(3))
    .force("x", forceX(0).strength(0.025))
    .force("y", forceY(0).strength(0.05))
    .stop();
  packing.tick(200);
  const left = Math.min(0, ...clusters.map((g) => g.x - g.width / 2));
  const top = Math.min(0, ...clusters.map((g) => g.y - g.height / 2));
  for (const g of clusters) {
    for (const p of g.points)
      positions.set(p.id, {
        x: p.x - g.minX + g.x - g.width / 2 - left + 65,
        y: p.y - g.minY + g.y - g.height / 2 - top + 50,
      });
  }
  const isolated = components.filter((c) => c.length === 1).map((c) => c[0]);
  const isolatedY = groups.length
    ? Math.max(...clusters.map((g) => g.y + g.height / 2 - top)) + 100
    : 0;
  const columns = Math.max(3, Math.ceil(Math.sqrt(isolated.length * 0.65)));
  isolated.forEach((id, i) =>
    positions.set(id, {
      x: (i % columns) * 110 + 55,
      y: isolatedY + Math.floor(i / columns) * 72 + 40,
    }),
  );
  return {
    positions,
    degree,
    landmarks,
    isolatedY: groups.length && isolated.length ? isolatedY : undefined,
    adjacency,
  };
}
