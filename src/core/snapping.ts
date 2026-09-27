import type { Anchor, PathBinding, SceneObject, SceneSettings, Vec, Viewport } from './types';
import { BASE_SCALE } from './coordinates';
import { objectAnchors, objectDependencies, projectToPath, resolveAnchor, resolvePoint } from './geometry';
import { intersectionPoints } from './intersections';
import { isObjectDefined } from './defined';

type SnapKind = 'grid' | 'point' | 'endpoint' | 'midpoint' | 'path' | 'intersection' | 'none';
interface SnapTarget { point: Anchor; binding?: PathBinding }
export interface SnapResult extends SnapTarget { kind: SnapKind }
export function snapPoint(point: Vec, objects: SceneObject[], viewport: Viewport, settings: SceneSettings, excludeIds: string[] = []): SnapResult {
  const fallback = { point: { ...point }, kind: 'none' as const };
  if (!settings.snap) return fallback;
  const excluded = new Set(excludeIds);
  const blocked = new Set(excluded), pending = [...excluded], children = new Map<string, string[]>();
  for (const object of objects) for (const dependency of objectDependencies(object)) {
    const list = children.get(dependency) ?? []; list.push(object.id); children.set(dependency, list);
  }
  while (pending.length) for (const child of children.get(pending.pop()!) ?? []) if (!blocked.has(child)) { blocked.add(child); pending.push(child); }
  const candidates: Record<'point' | 'endpoint' | 'midpoint' | 'path' | 'intersection', SnapTarget[]> = { point: [], endpoint: [], midpoint: [], path: [], intersection: [] };
  const tolerance = 10 / (BASE_SCALE * viewport.zoom), nearPaths: SceneObject[] = [];
  const target = (position: Anchor, object: SceneObject, pathBinding: PathBinding): SnapTarget => {
    const binding = blocked.has(object.id) ? undefined : pathBinding;
    return { point: position, ...(binding ? { binding } : {}) };
  };
  for (const object of objects) {
    if (!object.visible || excluded.has(object.id) || !isObjectDefined(object, objects)) continue;
    if (object.type === 'point') {
      if (!blocked.has(object.id)) candidates.point.push({ point: { ...resolvePoint(object, objects), pointId: object.id } });
      continue;
    }
    if (!blocked.has(object.id)) {
      const projection = projectToPath(point, object, objects);
      if (projection && Math.hypot(projection.point.x - point.x, projection.point.y - point.y) <= tolerance) {
        candidates.path.push(projection);
        if (nearPaths.length < 96 && (object.type === 'line' || object.type === 'arrow' || 'center' in object)) nearPaths.push(object);
      }
    }
    if ('center' in object) {
      if (!object.center.pointId || !blocked.has(object.center.pointId)) {
        const center = resolveAnchor(object.center, objects);
        candidates.endpoint.push(object.type === 'sector' ? target(center, object, { objectId: object.id, t: 0, segment: 0 }) : { point: center });
      }
      if (object.type !== 'circle' && !blocked.has(object.id)) candidates.endpoint.push(...objectAnchors(object, objects).slice(1).map((position, index) => target(position, object, { objectId: object.id, t: index })));
      continue;
    }
    if (!('points' in object)) continue;
    let vertices = objectAnchors(object, objects);
    let dependent = object.points.map(anchor => !!anchor.pointId && blocked.has(anchor.pointId));
    if (object.type === 'rectangle' && vertices.length === 2) {
      const [a, b] = vertices;
      vertices = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
      const [aDependent, bDependent] = dependent;
      dependent = [aDependent, aDependent || bDependent, bDependent, aDependent || bDependent];
    }
    const closed = object.type === 'polygon' || object.type === 'rectangle';
    for (let i = 0; i < vertices.length; i++) if (!dependent[i]) candidates.endpoint.push(target(vertices[i], object, { objectId: object.id, t: i === 0 ? 0 : 1, ...(closed || vertices.length > 2 ? { segment: Math.max(0, i - 1) } : {}) }));
    const segmentCount = closed ? vertices.length : vertices.length - 1;
    for (let i = 0; i < segmentCount; i++) {
      if (dependent[i] || dependent[(i + 1) % vertices.length]) continue;
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      candidates.midpoint.push(target({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, object, { objectId: object.id, t: 0.5, ...(closed || vertices.length > 2 ? { segment: i } : {}) }));
    }
  }
  for (let i = 0; i < nearPaths.length; i++) for (let j = i + 1; j < nearPaths.length; j++) candidates.intersection.push(...intersectionPoints(nearPaths[i], nearPaths[j], objects).map(point => ({ point })));
  function nearest(points: SnapTarget[]): SnapTarget | undefined {
    let best: SnapTarget | undefined;
    let distance = tolerance;
    for (const candidate of points) {
      const current = Math.hypot(candidate.point.x - point.x, candidate.point.y - point.y);
      if (current <= distance) { best = candidate; distance = current; }
    }
    return best;
  }
  for (const kind of ['point', 'endpoint', 'intersection', 'midpoint', 'path'] as const) {
    const target = nearest(candidates[kind]);
    if (target) return { ...target, point: { ...target.point }, kind };
  }
  if (settings.grid && Number.isFinite(settings.gridSize) && settings.gridSize > 0) {
    const round = (value: number) => Number((Math.round(value / settings.gridSize) * settings.gridSize).toPrecision(12));
    const grid = nearest([{ point: { x: round(point.x), y: round(point.y) } }]);
    if (grid) return { ...grid, kind: 'grid' };
  }
  return fallback;
}
