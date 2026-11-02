/** Bounded, deterministic layout of the returned subgraph; IDs and edges stay intact. */
export function graphPositions(nodes, edges) {
  const points = nodes.map((node, i) => {
    const radius = Math.sqrt((i + .5) / Math.max(1, nodes.length)) * 180, angle = i * 2.399963;
    return { id: node.id || node.slug, x: 340 + Math.cos(angle) * radius * 1.4, y: 230 + Math.sin(angle) * radius, vx: 0, vy: 0 };
  });
  const indices = new Map(points.map((point, i) => [point.id, i]));
  const links = edges.map(edge => [indices.get(edge.source), indices.get(edge.target)]).filter(([a,b]) => a != null && b != null && a !== b);
  for (let step = 0; step < 100; step++) {
    const forces = points.map(point => ({ x: (340-point.x)*.004, y: (230-point.y)*.004 }));
    for (let i = 0; i < points.length; i++) for (let j = i+1; j < points.length; j++) {
      const dx = points[i].x-points[j].x, dy = points[i].y-points[j].y, distance = Math.max(1,Math.hypot(dx,dy)), force = 2400/(distance*distance+40);
      forces[i].x += dx/distance*force;forces[i].y += dy/distance*force;forces[j].x -= dx/distance*force;forces[j].y -= dy/distance*force;
    }
    for (const [a,b] of links) {
      const dx = points[b].x-points[a].x, dy = points[b].y-points[a].y, distance = Math.max(1,Math.hypot(dx,dy)), force = (distance-85)*.012;
      forces[a].x += dx/distance*force;forces[a].y += dy/distance*force;forces[b].x -= dx/distance*force;forces[b].y -= dy/distance*force;
    }
    points.forEach((point, i) => {
      point.vx = (point.vx+forces[i].x)*.7;point.vy = (point.vy+forces[i].y)*.7;
      point.x = Math.min(615,Math.max(65,point.x+Math.max(-5,Math.min(5,point.vx))));point.y = Math.min(415,Math.max(45,point.y+Math.max(-5,Math.min(5,point.vy))));
    });
  }
  return new Map(points.map(({id,x,y}) => [id,{x,y}]));
}

/** Reserve label rectangles in priority order instead of painting overlapping names. */
export function graphLabels(nodes, edges, positions, selected, hovered, zoom) {
  const degree = new Map();for (const edge of edges) for (const id of [edge.source,edge.target]) degree.set(id,(degree.get(id)||0)+1);
  const priority = node => (node.id||node.slug) === hovered ? 20000 : (node.id||node.slug) === selected ? 10000 : degree.get(node.id||node.slug)||0;
  const rectangles=[], labels=new Map(), size=10/zoom;
  for (const node of [...nodes].sort((a,b) => priority(b)-priority(a))) {
    const id=node.id||node.slug, position=positions.get(id);if(!position)continue;
    const full=String(node.name||node.title||node.slug||''), limit=id===selected||id===hovered?18:12, label=full.length>limit?full.slice(0,limit)+'…':full;
    const width=[...label].reduce((sum,char) => sum+(char.charCodeAt(0)>255?size:size*.58),0);
    const box={left:position.x-width/2-3/zoom,right:position.x+width/2+3/zoom,top:position.y-25/zoom,bottom:position.y-9/zoom};
    if(rectangles.some(other => box.left<other.right&&box.right>other.left&&box.top<other.bottom&&box.bottom>other.top))continue;
    rectangles.push(box);labels.set(id,label);
  }
  return labels;
}
