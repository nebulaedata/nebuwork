import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { kindNames } from './systemModel.js';
import { usageText } from '../../tasks/usage.js';

const colors = { workbench: 0x8165ef, project: 0x53a5e8, expert: 0xc28ae9, task: 0x55bfa6 };
const sizes = { workbench: 17, project: 11, expert: 13, task: 6 };
export default function Graph3D({ graph, positions, selected, focus, reset, onSelect, onUnavailable }) {
  const host = useRef(null), runtime = useRef(null), current = useRef({ onSelect, onUnavailable });
  current.current = { onSelect, onUnavailable };
  useEffect(() => {
    let renderer, controls, observer, labels, live = true, darkObserver;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, .1, 100000);
    camera.position.set(470, 390, 620);
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.domElement.setAttribute('aria-label', '可旋转三维系统关系图'); renderer.domElement.setAttribute('role', 'img');
      renderer.domElement.tabIndex = 0;
      host.current.appendChild(renderer.domElement);
      labels = new CSS2DRenderer(); labels.domElement.className = 'cmd-3d-labels'; host.current.appendChild(labels.domElement);
      controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .09; controls.minDistance = 65; controls.maxDistance = 20000;
      controls.listenToKeyEvents(renderer.domElement);
      scene.add(new THREE.AmbientLight(0xffffff, 2));
      const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(100, 300, 200); scene.add(light);
      const violet = new THREE.PointLight(0xa58bff, 80, 1000, .5); violet.position.set(-200, 200, -150); scene.add(violet);
      const group = new THREE.Group(); scene.add(group);
      const r = { renderer, controls, camera, scene, group, labels, meshes: [], target: null, initialized: false, visible: true };
      runtime.current = r;
      const resize = () => { if (!live || !host.current) return; const width = host.current.clientWidth, height = host.current.clientHeight; r.visible = !!(width && height); if (!r.visible) return;
        const aspect = width / height;
        if (r.initialized) { const ratio = Math.min(1, camera.aspect) / Math.min(1, aspect); camera.position.sub(controls.target).multiplyScalar(ratio).add(controls.target); if (r.target) r.target.camera.sub(r.target.center).multiplyScalar(ratio).add(r.target.center); }
        camera.aspect = aspect; camera.updateProjectionMatrix(); renderer.setSize(width, height); labels.setSize(width, height); };
      observer = new ResizeObserver(resize); observer.observe(host.current); resize();
      const isDark = () => { const background = getComputedStyle(host.current).getPropertyValue('--surface').trim(); host.current.classList.toggle('is-dark', !!background && !['#fff', '#ffffff', 'white'].includes(background.toLowerCase()) && document.documentElement.getAttribute('data-theme') === 'dark'); };
      darkObserver = new MutationObserver(isDark); darkObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] }); isDark();
      const animate = () => {
        if (document.hidden || !live || !r.visible) return;
        if (r.target) { camera.position.lerp(r.target.camera, .12); controls.target.lerp(r.target.center, .12); if (camera.position.distanceTo(r.target.camera) < .3) r.target = null; }
        controls.update(); renderer.render(scene, camera); labels.render(scene, camera);
      };
      const visible = () => renderer.setAnimationLoop(document.hidden ? null : animate);
      const lost = event => { event.preventDefault(); current.current.onUnavailable('三维显示暂不可用，已切换关系列表。'); };
      renderer.domElement.addEventListener('webglcontextlost', lost); document.addEventListener('visibilitychange', visible); visible();
      let down;
      const pointerDown = event => { down = { x: event.clientX, y: event.clientY }; r.target = null; renderer.domElement.focus({ preventScroll: true }); };
      const select = event => {
        if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
        const rect = renderer.domElement.getBoundingClientRect(), pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
        const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, camera); const hit = ray.intersectObjects(r.meshes)[0]; if (hit) current.current.onSelect(hit.object.userData.key);
      };
      renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointerup', select);
      r.cleanup = () => { document.removeEventListener('visibilitychange', visible); renderer.domElement.removeEventListener('webglcontextlost', lost); renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointerup', select); };
    } catch { current.current.onUnavailable('此浏览器未提供可用的三维渲染，已切换关系列表。'); }
    return () => {
      live = false; runtime.current?.cleanup?.(); observer?.disconnect(); darkObserver?.disconnect(); controls?.dispose(); renderer?.setAnimationLoop(null);
      scene.traverse(object => { object.geometry?.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(m => { m?.map?.dispose(); m?.dispose(); }); });
      renderer?.dispose(); renderer?.domElement.remove(); labels?.domElement.remove(); runtime.current = null;
    };
  }, []);
  useEffect(() => {
    const r = runtime.current; if (!r) return;
    r.group.traverse(object => { object.element?.remove(); object.geometry?.dispose(); object.material?.dispose(); }); r.group.clear(); r.meshes = [];
    const visible = new Map(graph.nodes.map(n => [n.key, n])), focused = new Set(focus || []);
    const adjacent = new Set([selected, ...focused]);
    const primary = new Set(adjacent); graph.edges.forEach(e => { if (primary.has(e.source) || primary.has(e.target)) { adjacent.add(e.source); adjacent.add(e.target); } });
    for (const node of graph.nodes) {
      const position = positions.get(node.key); if (!position) continue;
      const active = !selected && !focused.size || adjacent.has(node.key), radius = sizes[node.kind];
      const material = new THREE.MeshStandardMaterial({ color: colors[node.kind], roughness: .27, metalness: .14, transparent: !active, opacity: active ? 1 : .22, emissive: colors[node.kind], emissiveIntensity: node.key === selected || focused.has(node.key) ? .45 : .08 });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 18), material); mesh.position.set(position.x, position.y, position.z); mesh.userData.key = node.key; r.group.add(mesh); r.meshes.push(mesh);
      if (node.key === selected || node.kind === 'workbench') { const ring = new THREE.Mesh(new THREE.TorusGeometry(radius + 5, .3, 6, 64), new THREE.MeshBasicMaterial({ color: colors[node.kind], transparent: true, opacity: .25 })); ring.rotation.x = Math.PI / 2; ring.position.copy(mesh.position); r.group.add(ring); }
      const element = document.createElement('button'); element.type = 'button'; element.className = `cmd-3d-label kind-${node.kind}${node.key === selected ? ' selected' : ''}`;
      element.setAttribute('aria-label', `${kindNames[node.kind]}：${node.label}`); element.title = `${node.label}\n${usageText(node.usage)}`;
      element.style.opacity = active ? '1' : '.35';
      const name = document.createElement('span'); name.textContent = node.label; element.append(name);
      const usage = document.createElement('small'); usage.textContent = usageText(node.usage); element.append(usage);
      element.addEventListener('click', () => current.current.onSelect(node.key));
      const label = new CSS2DObject(element); label.position.set(position.x, position.y - radius - 10, position.z); r.group.add(label);
    }
    for (const edge of graph.edges) {
      if (!visible.has(edge.source) || !visible.has(edge.target)) continue;
      const a = positions.get(edge.source), b = positions.get(edge.target); if (!a || !b) continue;
      const start = new THREE.Vector3(a.x, a.y, a.z), end = new THREE.Vector3(b.x, b.y, b.z), middle = start.clone().lerp(end, .5); middle.y += Math.min(40, start.distanceTo(end) * .12);
      const points = new THREE.QuadraticBezierCurve3(start, middle, end).getPoints(28), geometry = new THREE.BufferGeometry().setFromPoints(points);
      const active = !selected && !focused.size || primary.has(edge.source) || primary.has(edge.target);
      const options = { color: edge.configured ? 0xb4a3ec : 0x829dc8, transparent: true, opacity: active ? .52 : .1 };
      const material = edge.configured ? new THREE.LineDashedMaterial({ ...options, dashSize: 4, gapSize: 3 }) : new THREE.LineBasicMaterial(options);
      const line = new THREE.Line(geometry, material); line.computeLineDistances(); r.group.add(line);
    }
    if (!r.initialized && graph.nodes.length) { const box = new THREE.Box3().setFromObject(r.group); const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length(); r.controls.target.copy(center); r.camera.position.copy(center).add(new THREE.Vector3(.7, .55, 1).normalize().multiplyScalar(Math.max(420, size * 1.35) / Math.min(1, r.camera.aspect))); r.initialized = true; }
  }, [graph, positions, selected, focus]);
  useEffect(() => {
    const r = runtime.current; if (!r) return;
    const keys = focus?.length ? focus : selected ? [selected] : [];
    const points = keys.map(key => positions.get(key)).filter(Boolean).map(p => new THREE.Vector3(p.x, p.y, p.z));
    if (!points.length && !reset) return;
    const box = new THREE.Box3().setFromPoints(points.length ? points : [...positions.values()].map(p => new THREE.Vector3(p.x, p.y, p.z)));
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3()), distance = Math.max(points.length === 1 ? 230 : 420, box.getSize(new THREE.Vector3()).length() * 1.4) / Math.min(1, r.camera.aspect);
    r.target = { center, camera: center.clone().add(new THREE.Vector3(.7, .55, 1).normalize().multiplyScalar(distance)) };
  }, [selected, focus, reset]);
  return <div className="cmd-3d" ref={host}/>;
}
