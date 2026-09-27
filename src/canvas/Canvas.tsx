import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { BASE_SCALE, screenToWorld, worldToScreen, zoomAt } from '../core/coordinates';
import { boundsOf, cutShape, moveHandle, objectAnchors, projectToPath, resolveAnchor, translateObjects } from '../core/geometry';
import { isObjectDefined } from '../core/defined';
import { snapPoint } from '../core/snapping';
import type { Anchor, ObjectType, PathBinding, Scene, SceneObject, ToolId, Vec, Viewport } from '../core/types';
import { findPlanarFaceAtPoint, pointInPolygon, shapeBoundary } from '../core/planar';
import { makeObject } from '../tools/registry';
import type { DrawingObject, DrawingObjectType } from '../tools/registry';
import { SceneShape } from './SceneShape';
import { drawingHasExtent, polygonHasValidReferences } from './construction';

export interface CanvasProps {
  scene: Scene; selection: string[]; tool: ToolId; viewport: Viewport;
  onSelect: (ids: string[]) => void; onTool: (tool: ToolId) => void; onViewport: (view: Viewport) => void;
  onChange: (scene: Scene, label: string) => void; onBegin: () => void;
  onPreview: (scene: Scene) => void; onCommit: (label: string) => void; onCancel: () => void;
  onCursor?: (point: Vec) => void;
}

type Gesture =
  | { kind: 'pan'; start: Vec; viewport: Viewport }
  | { kind: 'marquee'; start: Vec; end: Vec; initial: string[] }
  | { kind: 'move'; start: Vec; anchor: Vec; base: Scene; ids: string[]; moved: boolean }
  | { kind: 'handle'; base: Scene; id: string; index: number; moved: boolean }
  | { kind: 'draw'; base: Scene; first: Anchor; object: DrawingObject; startScreen: Vec; moved: boolean };
type SnapGuide = { point: Anchor; kind: string };
type CutStage = { objectId: string; scene: Scene; first: Vec | null; hover: Vec | null; error?: string };
type PerpendicularStage = { scene: Scene; origin: Anchor; error?: string };
type PerpendicularTarget = { object: SceneObject; point: Vec; binding: PathBinding; distance: number };

function inInput(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"], .monaco-editor'));
}

function polygonArea(points: Vec[]) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);
}

function namedObject(type: DrawingObjectType, anchors: Anchor[], scene: Scene, binding?: PathBinding): DrawingObject {
  const object = makeObject(type, anchors, binding);
  if (type === 'point') {
    const count = scene.objects.filter(item => item.type === 'point').length;
    let index = count;
    let name = '';
    do { name = `${String.fromCharCode(65 + index % 26)}${index >= 26 ? Math.floor(index / 26) : ''}`; index++; } while (scene.objects.some(item => item.name === name));
    return { ...object, name };
  }
  const count = scene.objects.filter(item => item.type === type).length + 1;
  return { ...object, name: `${object.name} ${count}` };
}

function constrained(first: Vec, second: Anchor, type: ObjectType, shift: boolean): Anchor {
  if (!shift || type === 'circle') return second;
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  if (type === 'rectangle') {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: first.x + Math.sign(dx || 1) * side, y: first.y + Math.sign(dy || 1) * side };
  }
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const length = Math.hypot(dx, dy);
  return { x: first.x + Math.cos(angle) * length, y: first.y + Math.sin(angle) * length };
}

export function Canvas(props: CanvasProps) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const polygonRef = useRef<Anchor[]>([]);
  const cutRef = useRef<CutStage | null>(null);
  const perpendicularRef = useRef<PerpendicularStage | null>(null);
  const lastSnapRef = useRef<ReturnType<typeof snapPoint> | null>(null);
  const spaceRef = useRef(false);
  const [space, setSpace] = useState(false);
  const [size, setSize] = useState({ width: 800, height: 660 });
  const [gestureUI, setGestureUI] = useState<Gesture | null>(null);
  const [polygon, setPolygon] = useState<Anchor[]>([]);
  const [hover, setHover] = useState<Anchor | null>(null);
  const [guide, setGuide] = useState<SnapGuide | null>(null);
  const [cut, setCut] = useState<CutStage | null>(null);
  const [perpendicular, setPerpendicular] = useState<PerpendicularStage | null>(null);
  const [perpendicularPreview, setPerpendicularPreview] = useState<PerpendicularTarget | null>(null);
  const { scene, selection, tool, viewport } = props;

  const screenPoint = (event: { clientX: number; clientY: number }): Vec => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };
  const capture = (event: ReactPointerEvent<SVGElement>) => {
    svgRef.current?.setPointerCapture(event.pointerId);
    svgRef.current?.focus({ preventScroll: true });
  };
  const snap = (point: Vec, excludeIds: string[] = []): Anchor => {
    const state = propsRef.current;
    const result = snapPoint(point, state.scene.objects, state.viewport, state.scene.settings, excludeIds);
    lastSnapRef.current = result;
    setGuide(result.kind === 'none' ? null : result);
    return result.point;
  };
  const clearPolygon = () => { polygonRef.current = []; setPolygon([]); setHover(null); };
  const updateCut = (stage: CutStage | null) => { cutRef.current = stage; setCut(stage); };
  const beginCut = (object: SceneObject) => {
    const state = propsRef.current;
    if (object.locked || !object.visible || !isObjectDefined(object, state.scene.objects) || !['line', 'arrow', 'rectangle', 'polygon', 'circle', 'arc', 'sector', 'plot'].includes(object.type)) return;
    updateCut({ objectId: object.id, scene: state.scene, first: null, hover: null });
    state.onSelect([object.id]);
    setGuide(null);
  };
  const finishCut = (world: Vec) => {
    const state = propsRef.current;
    const stage = cutRef.current;
    if (!stage) return;
    if (stage.scene !== state.scene || !state.scene.objects.some(object => object.id === stage.objectId)) { updateCut(null); return; }
    const point = snapPoint(world, state.scene.objects, state.viewport, state.scene.settings, [stage.objectId]).point;
    if (!stage.first) { updateCut({ ...stage, first: { x: point.x, y: point.y }, hover: { x: point.x, y: point.y }, error: undefined }); return; }
    const result = cutShape(state.scene.objects, stage.objectId, stage.first, point);
    if (!result) {
      updateCut({ ...stage, hover: { x: point.x, y: point.y }, error: '절단선이 도형을 가로지르도록 두 점을 찍으세요.' });
      return;
    }
    updateCut(null);
    setGuide(null);
    state.onChange({ ...state.scene, objects: result.objects }, '도형 자르기');
    state.onSelect(result.pieceIds);
    state.onTool('select');
  };
  const updatePerpendicular = (stage: PerpendicularStage | null) => { perpendicularRef.current = stage; setPerpendicular(stage); };
  const nearestSupport = (world: Vec): PerpendicularTarget | null => {
    const state = propsRef.current;
    const tolerance = 16 / (BASE_SCALE * state.viewport.zoom);
    let best: PerpendicularTarget | null = null;
    for (const object of state.scene.objects) {
      if ((object.type !== 'line' && object.type !== 'arrow') || !object.visible || !isObjectDefined(object, state.scene.objects)) continue;
      const projection = projectToPath(world, object, state.scene.objects);
      if (!projection) continue;
      const distance = Math.hypot(projection.point.x - world.x, projection.point.y - world.y);
      if (distance <= tolerance && (!best || distance < best.distance)) best = { object, point: projection.point, binding: projection.binding, distance };
    }
    return best;
  };
  const addPerpendicular = (world: Vec) => {
    const state = propsRef.current, stage = perpendicularRef.current;
    if (!stage) { updatePerpendicular({ scene: state.scene, origin: snap(world) }); setPerpendicularPreview(null); return; }
    if (stage.scene !== state.scene) { updatePerpendicular(null); return; }
    const target = nearestSupport(world);
    if (!target) { updatePerpendicular({ ...stage, error: '기준 선분 가까이를 클릭하세요.' }); setPerpendicularPreview(null); return; }
    const origin = resolveAnchor(stage.origin, state.scene.objects);
    if (Math.hypot(target.point.x - origin.x, target.point.y - origin.y) < 1e-7) {
      updatePerpendicular({ ...stage, error: '점과 수선의 발이 겹칩니다. 다른 점이나 선분을 선택하세요.' }); setPerpendicularPreview(null); return;
    }
    const foot = namedObject('point', [target.point], state.scene, target.binding);
    const line = namedObject('line', [stage.origin, { ...target.point, pointId: foot.id }], state.scene);
    foot.name = '수선의 발';
    state.onChange({ ...state.scene, objects: [...state.scene.objects, foot, line] }, '수선 내리기');
    state.onSelect([line.id, foot.id]);
    setGuide(null);
    updatePerpendicular(null);
    setPerpendicularPreview(null);
    state.onTool('select');
  };
  const fillArea = (world: Vec) => {
    const state = propsRef.current;
    const boundary = findPlanarFaceAtPoint(state.scene.objects, world);
    const topmost = [...state.scene.objects].reverse().find(object => {
      if (object.locked || !object.visible || !isObjectDefined(object, state.scene.objects)) return false;
      const shape = shapeBoundary(object, state.scene.objects);
      return !!shape && pointInPolygon(world, shape) && (!boundary || polygonArea(boundary) >= polygonArea(shape) - 1e-6);
    });
    if (topmost) {
      state.onChange({ ...state.scene, objects: state.scene.objects.map(object => object.id === topmost.id ? { ...object, style: { ...object.style, fill: '#f3d486' } } : object) }, '영역 색칠');
      state.onSelect([topmost.id]);
      return;
    }
    if (!boundary) return;
    const count = state.scene.objects.filter(object => object.type === 'polygon' && object.name.startsWith('영역')).length + 1;
    const base = namedObject('polygon', boundary, state.scene);
    const region: SceneObject = { ...base, name: `영역 ${count}`, style: { ...base.style, stroke: 'none', fill: '#f3d486', opacity: 0.56 } };
    state.onChange({ ...state.scene, objects: [...state.scene.objects, region] }, '영역 색칠');
    state.onSelect([region.id]);
  };
  const cancel = () => {
    const active = gestureRef.current;
    if (active && active.kind !== 'pan' && active.kind !== 'marquee') propsRef.current.onCancel();
    gestureRef.current = null;
    setGestureUI(null);
    clearPolygon();
    updateCut(null);
    updatePerpendicular(null);
    setPerpendicularPreview(null);
    setGuide(null);
  };
  const finishPolygon = () => {
    const points = polygonRef.current;
    if (points.length < 3) return;
    const state = propsRef.current;
    if (!polygonHasValidReferences(points, state.scene.objects)) {
      clearPolygon();
      setGuide(null);
      state.onTool('select');
      return;
    }
    const object = namedObject('polygon', points, state.scene);
    clearPolygon();
    state.onChange({ ...state.scene, objects: [...state.scene.objects, object] }, '다각형 만들기');
    state.onSelect([object.id]);
    state.onTool('select');
    setGuide(null);
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let previousSize: { width: number; height: number } | null = null;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const nextSize = { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
      if (previousSize?.width === nextSize.width && previousSize.height === nextSize.height) return;
      if (previousSize) {
        const state = propsRef.current;
        state.onViewport({ ...state.viewport, x: state.viewport.x + (nextSize.width - previousSize.width) / 2, y: state.viewport.y + (nextSize.height - previousSize.height) / 2 });
      }
      previousSize = nextSize;
      setSize(nextSize);
    });
    observer.observe(svg);
    const wheel = (event: WheelEvent) => {
      if (svg.closest('[inert]')) return;
      event.preventDefault();
      if (gestureRef.current) return;
      const state = propsRef.current;
      state.onViewport(zoomAt(state.viewport, screenPoint(event), state.viewport.zoom * Math.exp(-event.deltaY * 0.0015)));
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); svg.removeEventListener('wheel', wheel); };
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (svgRef.current?.closest('[inert]')) return;
      if (inInput(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        if (cutRef.current || perpendicularRef.current || polygonRef.current.length) { cancel(); propsRef.current.onTool('select'); }
        return;
      }
      if (event.code === 'Space') { event.preventDefault(); spaceRef.current = true; setSpace(true); }
      if (event.key === 'Escape') { cancel(); propsRef.current.onTool('select'); }
      if (event.key === 'Enter' && polygonRef.current.length) { event.preventDefault(); finishPolygon(); }
    };
    const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') { spaceRef.current = false; setSpace(false); } };
    const blur = () => { spaceRef.current = false; setSpace(false); cancel(); };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); };
  }, []);

  useEffect(() => {
    cancel();
    if (tool === 'cut') {
      const state = propsRef.current;
      const selectedObject = state.scene.objects.find(object => state.selection.includes(object.id) && ['line', 'arrow', 'rectangle', 'polygon', 'circle', 'arc', 'sector', 'plot'].includes(object.type));
      if (selectedObject) beginCut(selectedObject);
    }
  }, [tool]);
  useEffect(() => {
    if (cutRef.current && cutRef.current.scene !== scene) {
      updateCut(null);
      setGuide(null);
      propsRef.current.onTool('select');
    }
    if (perpendicularRef.current && perpendicularRef.current.scene !== scene) {
      updatePerpendicular(null);
      setPerpendicularPreview(null);
      setGuide(null);
      propsRef.current.onTool('select');
    }
  }, [scene]);

  function startShape(event: ReactPointerEvent<SVGGElement>, object: SceneObject) {
    const state = propsRef.current;
    if (state.tool === 'cut' && !spaceRef.current && event.button === 0) {
      event.stopPropagation();
      capture(event);
      if (cutRef.current) finishCut(screenToWorld(screenPoint(event), state.viewport));
      else beginCut(object);
      return;
    }
    if (state.tool === 'fill' && !spaceRef.current && event.button === 0) {
      event.stopPropagation();
      fillArea(screenToWorld(screenPoint(event), state.viewport));
      return;
    }
    if (state.tool !== 'select' || spaceRef.current || event.button !== 0) return;
    if (object.locked) return;
    event.stopPropagation();
    capture(event);
    const previous = state.selection;
    const ids = event.shiftKey ? previous.includes(object.id) ? previous.filter(id => id !== object.id) : [...previous, object.id] : previous.includes(object.id) ? previous : [object.id];
    state.onSelect(ids);
    if (!ids.includes(object.id)) return;
    const movable = ids.filter(id => !state.scene.objects.find(item => item.id === id)?.locked);
    const point = screenToWorld(screenPoint(event), state.viewport);
    const first = objectAnchors(object, state.scene.objects)[0] ?? point;
    state.onBegin();
    gestureRef.current = { kind: 'move', start: point, anchor: first, base: state.scene, ids: movable, moved: false };
    setGestureUI(gestureRef.current);
  }

  function startHandle(event: ReactPointerEvent<SVGCircleElement>, id: string, index: number) {
    if (event.button !== 0 || spaceRef.current || propsRef.current.tool !== 'select') return;
    event.stopPropagation();
    if (event.shiftKey) { propsRef.current.onSelect(propsRef.current.selection.filter(selectedId => selectedId !== id)); return; }
    capture(event);
    const state = propsRef.current;
    state.onBegin();
    gestureRef.current = { kind: 'handle', base: state.scene, id, index, moved: false };
    setGestureUI(gestureRef.current);
  }

  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const state = propsRef.current;
    if (event.button !== 0 && event.button !== 1) return;
    if (gestureRef.current) return;
    const screen = screenPoint(event);
    const world = screenToWorld(screen, state.viewport);
    capture(event);
    event.preventDefault();
    if (event.button === 1 || spaceRef.current || state.tool === 'hand') {
      gestureRef.current = { kind: 'pan', start: screen, viewport: state.viewport };
      setGestureUI(gestureRef.current);
      return;
    }
    if (state.tool === 'select') {
      const initial = event.shiftKey ? state.selection : [];
      state.onSelect(initial);
      gestureRef.current = { kind: 'marquee', start: world, end: world, initial };
      setGestureUI(gestureRef.current);
      return;
    }
    if (state.tool === 'cut') {
      if (cutRef.current) finishCut(world);
      else {
        const selectedObject = state.scene.objects.find(object => state.selection.includes(object.id));
        if (selectedObject) beginCut(selectedObject);
      }
      return;
    }
    if (state.tool === 'fill') { fillArea(world); return; }
    if (state.tool === 'perpendicular') { addPerpendicular(world); return; }
    const point = snap(world);
    if (state.tool === 'polygon') {
      const points = polygonRef.current;
      if (points.length >= 3) {
        const first = worldToScreen(resolveAnchor(points[0], state.scene.objects), state.viewport);
        if (Math.hypot(first.x - screen.x, first.y - screen.y) < 12) { finishPolygon(); return; }
      }
      const last = points.at(-1);
      if (last && Math.hypot(last.x - point.x, last.y - point.y) < 1e-6) return;
      polygonRef.current = [...points, point];
      setPolygon(polygonRef.current);
      setHover(point);
      return;
    }
    if (state.tool === 'point' || state.tool === 'text' || state.tool === 'math') {
      if (state.tool === 'point' && point.pointId && state.scene.objects.some(object => object.id === point.pointId && object.type === 'point')) {
        state.onSelect([point.pointId]);
        state.onTool('select');
        setGuide(null);
        return;
      }
      const object = namedObject(state.tool, [point], state.scene, state.tool === 'point' ? lastSnapRef.current?.binding : undefined);
      state.onChange({ ...state.scene, objects: [...state.scene.objects, object] }, `${object.name} 만들기`);
      state.onSelect([object.id]);
      state.onTool('select');
      setGuide(null);
      return;
    }
    const object = namedObject(state.tool, [point, point], state.scene);
    state.onBegin();
    gestureRef.current = { kind: 'draw', base: state.scene, first: point, object, startScreen: screen, moved: false };
    setGestureUI(gestureRef.current);
  }

  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (svgRef.current?.closest('[inert]')) return;
    const state = propsRef.current;
    const screen = screenPoint(event);
    const world = screenToWorld(screen, state.viewport);
    state.onCursor?.(world);
    const active = gestureRef.current;
    if (!active) {
      if (state.tool === 'cut') {
        if (cutRef.current) updateCut({ ...cutRef.current, hover: world });
        else setGuide(null);
        return;
      }
      if (state.tool === 'perpendicular') {
        if (perpendicularRef.current) {
          const target = nearestSupport(world);
          setGuide(target ? { point: target.point, kind: 'path' } : null);
          setPerpendicularPreview(target);
          setPerpendicular({ ...perpendicularRef.current, error: target ? undefined : '기준 선분 가까이를 클릭하세요.' });
        } else { setPerpendicularPreview(null); snap(world); }
        return;
      }
      if (state.tool !== 'select' && state.tool !== 'hand') setHover(snap(world));
      else setGuide(null);
      return;
    }
    if (active.kind === 'pan') {
      state.onViewport({ ...active.viewport, x: active.viewport.x + screen.x - active.start.x, y: active.viewport.y + screen.y - active.start.y });
    } else if (active.kind === 'marquee') {
      active.end = world;
      const minX = Math.min(active.start.x, world.x), maxX = Math.max(active.start.x, world.x);
      const minY = Math.min(active.start.y, world.y), maxY = Math.max(active.start.y, world.y);
      const hits = state.scene.objects.filter(object => {
        if (!object.visible || object.locked || !isObjectDefined(object, state.scene.objects)) return false;
        const bounds = boundsOf([object], state.scene.objects);
        return bounds && bounds.minX >= minX && bounds.maxX <= maxX && bounds.minY >= minY && bounds.maxY <= maxY;
      }).map(object => object.id);
      state.onSelect([...new Set([...active.initial, ...hits])]);
      setGestureUI({ ...active });
    } else if (active.kind === 'move') {
      const rawDelta = { x: world.x - active.start.x, y: world.y - active.start.y };
      if (Math.hypot(rawDelta.x, rawDelta.y) * BASE_SCALE * state.viewport.zoom < 2 && !active.moved) return;
      const target = snap({ x: active.anchor.x + rawDelta.x, y: active.anchor.y + rawDelta.y }, active.ids);
      active.moved = true;
      state.onPreview({ ...active.base, objects: translateObjects(active.base.objects, active.ids, { x: target.x - active.anchor.x, y: target.y - active.anchor.y }) });
    } else if (active.kind === 'handle') {
      const point = snap(world, [active.id]);
      active.moved = true;
      state.onPreview({ ...active.base, objects: moveHandle(active.base.objects, active.id, active.index, point) });
    } else {
      const point = constrained(active.first, snap(world, [active.object.id]), active.object.type, event.shiftKey);
      const geometry = makeObject(active.object.type, [active.first, point]);
      active.object = { ...geometry, id: active.object.id, name: active.object.name, style: active.object.style };
      active.moved = Math.hypot(screen.x - active.startScreen.x, screen.y - active.startScreen.y) >= 3;
      state.onPreview({ ...active.base, objects: [...active.base.objects, active.object] });
    }
  }

  function pointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const active = gestureRef.current;
    if (!active) return;
    gestureRef.current = null;
    setGestureUI(null);
    setGuide(null);
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
    const state = propsRef.current;
    if (active.kind === 'draw') {
      if (!active.moved || !drawingHasExtent(active.object)) { state.onCancel(); return; }
      state.onCommit(`${active.object.name} 만들기`);
      state.onSelect([active.object.id]);
      state.onTool('select');
    } else if (active.kind === 'move' || active.kind === 'handle') {
      if (active.moved) state.onCommit(active.kind === 'move' ? '객체 이동' : '도형 조절');
      else state.onCancel();
    }
  }

  const activeObjects = scene.objects.filter(object => selection.includes(object.id) && object.visible && isObjectDefined(object, scene.objects));
  const bounds = boundsOf(activeObjects, scene.objects);
  if (bounds) for (const object of activeObjects) {
    if (object.type !== 'text' && object.type !== 'math') continue;
    const position = resolveAnchor(object.position, scene.objects);
    const fontSize = object.fontSize * 4 / 3;
    const halfWidth = Math.max(fontSize * 2, object.text.length * fontSize * 0.64) / BASE_SCALE / 2;
    bounds.maxX = Math.max(bounds.maxX, position.x + halfWidth);
    bounds.minX = Math.min(bounds.minX, position.x - halfWidth);
    bounds.maxY = Math.max(bounds.maxY, position.y + fontSize * 0.9 / BASE_SCALE);
    bounds.minY = Math.min(bounds.minY, position.y - fontSize * 0.9 / BASE_SCALE);
  }
  const boundStart = bounds ? worldToScreen({ x: bounds.minX, y: bounds.maxY }, viewport) : null;
  const boundEnd = bounds ? worldToScreen({ x: bounds.maxX, y: bounds.minY }, viewport) : null;
  const selected = activeObjects.length === 1 && !activeObjects[0].locked ? activeObjects[0] : null;
  const handles = selected && selected.type !== 'plot' ? objectAnchors(selected, scene.objects) : [];
  const gridStep = scene.settings.gridSize * BASE_SCALE * viewport.zoom;
  const gridSpacing = gridStep < 12 ? gridStep * Math.ceil(12 / gridStep) : gridStep;
  const marquee = gestureUI?.kind === 'marquee' ? gestureUI : null;
  const marqueeStart = marquee ? worldToScreen(marquee.start, viewport) : null;
  const marqueeEnd = marquee ? worldToScreen(marquee.end, viewport) : null;
  const guideScreen = guide ? worldToScreen(guide.point, viewport) : null;
  const guideLabel = guide?.kind === 'point' ? '점' : guide?.kind === 'endpoint' ? '끝점' : guide?.kind === 'midpoint' ? '중점' : guide?.kind === 'path' ? '도형 위' : guide?.kind === 'intersection' ? '교점' : '격자';
  const polygonPoints = [...polygon.map(point => resolveAnchor(point, scene.objects)), ...(hover ? [hover] : [])].map(point => worldToScreen(point, viewport));
  const cursor = gestureUI?.kind === 'pan' ? 'grabbing' : space || tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
  const desiredTickStep = 58 / (BASE_SCALE * viewport.zoom);
  const tickMagnitude = 10 ** Math.floor(Math.log10(desiredTickStep));
  const tickStep = ([1, 2, 5, 10].find(value => value * tickMagnitude >= desiredTickStep) ?? 10) * tickMagnitude;
  const visibleMin = screenToWorld({ x: 0, y: size.height }, viewport);
  const visibleMax = screenToWorld({ x: size.width, y: 0 }, viewport);
  const axisTicks = (min: number, max: number) => Array.from({ length: Math.min(200, Math.max(0, Math.floor(max / tickStep) - Math.ceil(min / tickStep) + 1)) }, (_, index) => Number(((Math.ceil(min / tickStep) + index) * tickStep).toPrecision(10))).filter(value => value !== 0);
  const cutFirst = cut?.first ? worldToScreen(cut.first, viewport) : null;
  const cutHover = cut?.hover ? worldToScreen(cut.hover, viewport) : null;
  const cutHint = !cut ? '자를 도형을 클릭하세요' : cut.error ?? (cut.first ? '자를 선을 가로지르도록 두 번째 점을 클릭하세요' : '자를 도형 위에서 첫 번째 점을 클릭하세요');
  const perpendicularOrigin = perpendicular ? worldToScreen(resolveAnchor(perpendicular.origin, scene.objects), viewport) : null;
  const perpendicularFoot = perpendicularPreview ? worldToScreen(perpendicularPreview.point, viewport) : null;
  const perpendicularHint = perpendicular?.error ?? (perpendicular ? '기준 선분 위에서 수선의 발을 지정하세요' : '점을 클릭한 뒤 기준 선분을 클릭하세요');

  return <svg ref={svgRef} className="drawing-canvas" data-testid="canvas" role="application" aria-label="도형 편집 작업지" tabIndex={0} width="100%" height="100%" style={{ display: 'block', touchAction: 'none', outline: 'none', cursor, userSelect: 'none' }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancel} onDoubleClick={() => { if (tool === 'polygon') finishPolygon(); }} onContextMenu={event => event.preventDefault()}>
    <defs><pattern id="canvas-grid" width={gridSpacing} height={gridSpacing} patternUnits="userSpaceOnUse" x={viewport.x % gridSpacing} y={viewport.y % gridSpacing}><path d={`M ${gridSpacing} 0 L 0 0 0 ${gridSpacing}`} fill="none" stroke="#e7edf1" strokeWidth="0.8" /></pattern></defs>
    <rect width="100%" height="100%" fill="#fff" />
    {scene.settings.grid && <rect width="100%" height="100%" fill="url(#canvas-grid)" pointerEvents="none" />}
    {scene.settings.axes && <g className="canvas-axes" pointerEvents="none" stroke="#becbd3" fill="#8294a2"><path d={`M 0 ${viewport.y} H ${size.width} M ${viewport.x} 0 V ${size.height}`} strokeWidth="1" /><path d={`M ${size.width - 13} ${viewport.y - 4} L ${size.width - 5} ${viewport.y} L ${size.width - 13} ${viewport.y + 4} M ${viewport.x - 4} 13 L ${viewport.x} 5 L ${viewport.x + 4} 13`} fill="none" /><g stroke="none" fontSize="12" fontFamily="Georgia, serif" fontStyle="italic"><text x={Math.max(10, Math.min(size.width - 18, viewport.x + 9))} y={18}>y</text><text x={size.width - 16} y={Math.max(14, Math.min(size.height - 10, viewport.y - 10))}>x</text><text x={viewport.x + 7} y={viewport.y + 16} fontSize="10">0</text></g></g>}
    {scene.settings.axes && <g pointerEvents="none" fontSize="10" fontFamily="sans-serif" fill="#8b9ba6" stroke="#bdcbd4">
      {viewport.y >= 0 && viewport.y <= size.height && axisTicks(visibleMin.x, visibleMax.x).map(value => {
        const x = worldToScreen({ x: value, y: 0 }, viewport).x;
        return <g key={`x${value}`}><path d={`M ${x} ${viewport.y - 3} v 6`} /><text x={x} y={viewport.y + 16} textAnchor="middle" stroke="none">{value}</text></g>;
      })}
      {viewport.x >= 0 && viewport.x <= size.width && axisTicks(visibleMin.y, visibleMax.y).map(value => {
        const y = worldToScreen({ x: 0, y: value }, viewport).y;
        return <g key={`y${value}`}><path d={`M ${viewport.x - 3} ${y} h 6`} /><text x={viewport.x - 8} y={y + 3} textAnchor="end" stroke="none">{value}</text></g>;
      })}
    </g>}
    {scene.objects.map(object => <SceneShape key={object.id} object={object} objects={scene.objects} viewport={viewport} interactive onPointerDown={event => startShape(event, object)} />)}
    {boundStart && boundEnd && tool === 'select' && <rect x={boundStart.x - 7} y={boundStart.y - 7} width={boundEnd.x - boundStart.x + 14} height={boundEnd.y - boundStart.y + 14} fill="none" stroke="#10a99b" strokeWidth="1" strokeDasharray="4 4" pointerEvents="none" />}
    {selected && tool === 'select' && handles.map((point, index) => {
      const p = worldToScreen(point, viewport);
      return <circle key={index} data-testid={`handle-${selected.id}-${index}`} aria-label={selected.type === 'circle' ? index === 0 ? '중심 이동' : '반지름 조절' : selected.type === 'arc' || selected.type === 'sector' ? ['중심 이동', '시작점과 반지름 조절', '끝점과 각도 조절'][index] : `꼭짓점 ${index + 1}`} cx={p.x} cy={p.y} r={5} fill="white" stroke="#079d91" strokeWidth={2} style={{ cursor: 'crosshair' }} onPointerDown={event => startHandle(event, selected.id, index)} />;
    })}
    {tool === 'cut' && <g pointerEvents="none" data-testid="cut-preview">
      {cutFirst && cutHover && <line x1={cutFirst.x} y1={cutFirst.y} x2={cutHover.x} y2={cutHover.y} stroke="#0a9f92" strokeWidth="2" strokeDasharray="7 4" />}
      {cutFirst && <circle cx={cutFirst.x} cy={cutFirst.y} r="5" fill="#0a9f92" stroke="white" strokeWidth="2" />}
      <rect x="12" y={size.height - 73} width={Math.min(360, size.width - 24)} height="30" rx="6" fill="#effaf7" stroke="#b8e0d7" />
      <text data-testid="cut-hint" x="23" y={size.height - 54} fontSize="11" fill="#147d70">{cutHint}</text>
    </g>}
    {tool === 'perpendicular' && perpendicularOrigin && <g pointerEvents="none" data-testid="perpendicular-preview">
      {perpendicularFoot && <><line x1={perpendicularOrigin.x} y1={perpendicularOrigin.y} x2={perpendicularFoot.x} y2={perpendicularFoot.y} stroke="#0a9f92" strokeWidth="1.7" strokeDasharray="6 3" /><circle cx={perpendicularFoot.x} cy={perpendicularFoot.y} r="4" fill="#0a9f92" stroke="white" strokeWidth="1.5" /></>}
      <rect x="12" y={size.height - 73} width={Math.min(360, size.width - 24)} height="30" rx="6" fill="#effaf7" stroke="#b8e0d7" />
      <text data-testid="perpendicular-hint" x="23" y={size.height - 54} fontSize="11" fill="#147d70">{perpendicularHint}</text>
    </g>}
    {marqueeStart && marqueeEnd && <rect x={Math.min(marqueeStart.x, marqueeEnd.x)} y={Math.min(marqueeStart.y, marqueeEnd.y)} width={Math.abs(marqueeEnd.x - marqueeStart.x)} height={Math.abs(marqueeEnd.y - marqueeStart.y)} fill="rgba(9, 161, 147, 0.07)" stroke="#0aa395" strokeDasharray="4 3" pointerEvents="none" />}
    {polygon.length > 0 && <g pointerEvents="none"><polyline points={polygonPoints.map(point => `${point.x},${point.y}`).join(' ')} stroke="#0a9f92" strokeWidth={1.6} fill="rgba(10,159,146,0.06)" strokeDasharray="5 3" />{polygonPoints.slice(0, polygon.length).map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={index === 0 ? 6 : 4} fill="white" stroke="#0a9f92" strokeWidth={2} />)}</g>}
    {guideScreen && <g pointerEvents="none"><path d={`M ${guideScreen.x - 9} ${guideScreen.y} H ${guideScreen.x + 9} M ${guideScreen.x} ${guideScreen.y - 9} V ${guideScreen.y + 9}`} stroke="#e59b22" strokeWidth={1} /><circle cx={guideScreen.x} cy={guideScreen.y} r={5} fill="none" stroke="#e59b22" strokeWidth={1.5} /><rect x={guideScreen.x + 12} y={guideScreen.y + 8} rx={3} width={guideLabel.length * 12 + 10} height={20} fill="#fff7e4" /><text x={guideScreen.x + 17} y={guideScreen.y + 22} fontSize={11} fill="#a7680a">{guideLabel}</text></g>}
  </svg>;
}
