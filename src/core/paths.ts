import type { Anchor, PathBinding, PointObject, SceneObject, Vec } from './types';
import { evaluatePlot } from './plot';

const RAD = Math.PI / 180;
const EPS = 1e-9;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const normalizeAngle = (angle: number): number => ((angle % 360) + 360) % 360;
export const finitePoint = (point: Vec | null): point is Vec => !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
export const atAngle = (center: Vec, radius: number, angle: number): Vec => ({ x: center.x + radius * Math.cos(angle * RAD), y: center.y + radius * Math.sin(angle * RAD) });
const clean = (point: Vec): Vec => ({ x: Number.isFinite(point.x) ? point.x : 0, y: Number.isFinite(point.y) ? point.y : 0 });
const distance2 = (a: Vec, b: Vec) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export function objectDependencies(object: SceneObject): string[] {
  if (object.type === 'point') return object.binding ? [object.binding.objectId] : [];
  const anchors = 'points' in object ? object.points : 'center' in object ? [object.center] : 'position' in object ? [object.position] : [];
  return [...new Set(anchors.flatMap(anchor => 'pointId' in anchor && anchor.pointId ? [anchor.pointId] : []))];
}

export function dependsOn(objects: SceneObject[], objectId: string, targets: ReadonlySet<string>): boolean {
  const byId = new Map(objects.map(object => [object.id, object]));
  const visited = new Set<string>(), pending = [objectId];
  while (pending.length) {
    const id = pending.pop()!;
    if (targets.has(id)) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const object = byId.get(id);
    if (object) pending.push(...objectDependencies(object));
  }
  return false;
}

/** Iterative validation does not overflow on long imported dependency chains. */
export function hasDependencyCycle(objects: SceneObject[]): boolean {
  const ids = new Set(objects.map(object => object.id));
  const degrees = new Map<string, number>(), reverse = new Map<string, string[]>();
  for (const object of objects) {
    const dependencies = objectDependencies(object).filter(id => ids.has(id));
    degrees.set(object.id, dependencies.length);
    for (const id of dependencies) { const children = reverse.get(id) ?? []; children.push(object.id); reverse.set(id, children); }
  }
  const ready = objects.filter(object => !degrees.get(object.id)).map(object => object.id);
  let count = 0;
  while (ready.length) {
    const id = ready.pop()!; count++;
    for (const child of reverse.get(id) ?? []) {
      const degree = degrees.get(child)! - 1; degrees.set(child, degree);
      if (!degree) ready.push(child);
    }
  }
  return count !== objects.length;
}

interface Resolution { byId: Map<string, SceneObject>; active: Set<string> }
const context = (objects: SceneObject[]): Resolution => ({ byId: new Map(objects.map(object => [object.id, object])), active: new Set() });
function anchorPosition(anchor: Anchor, ctx: Resolution): Vec | null {
  const target = anchor.pointId ? ctx.byId.get(anchor.pointId) : undefined;
  if (target?.type === 'point') return pointPosition(target, ctx);
  return finitePoint(anchor) ? { x: anchor.x, y: anchor.y } : null;
}
function pointPosition(point: PointObject, ctx: Resolution): Vec | null {
  if (ctx.active.has(point.id) || ctx.active.size > 128) return null;
  if (!point.binding || !ctx.byId.has(point.binding.objectId)) return finitePoint(point.position) ? { ...point.position } : null;
  ctx.active.add(point.id);
  const result = pathPosition(point.binding, ctx);
  ctx.active.delete(point.id);
  return result;
}
function vertices(object: SceneObject, ctx: Resolution): Vec[] | null {
  if (!('points' in object)) return null;
  const points = object.points.map(anchor => anchorPosition(anchor, ctx));
  if (points.some(point => !point)) return null;
  const resolved = points as Vec[];
  if (object.type !== 'rectangle') return resolved;
  const [a, b] = resolved;
  return a && b ? [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }] : null;
}
function pathPosition(binding: PathBinding, ctx: Resolution): Vec | null {
  const object = ctx.byId.get(binding.objectId);
  if (!object || ctx.active.has(object.id) || ctx.active.size > 128 || !Number.isFinite(binding.t) || binding.t < 0 || binding.t > 1) return null;
  ctx.active.add(object.id);
  let result: Vec | null = null;
  if ('points' in object) {
    const points = vertices(object, ctx), closed = object.type === 'polygon' || object.type === 'rectangle';
    const segment = binding.segment ?? 0;
    if (points && Number.isInteger(segment) && segment >= 0 && segment < points.length - (closed ? 0 : 1)) {
      const a = points[segment], b = points[(segment + 1) % points.length];
      result = { x: a.x + (b.x - a.x) * binding.t, y: a.y + (b.y - a.y) * binding.t };
    }
  } else if (object.type === 'sector' && (binding.segment === 0 || binding.segment === 1)) {
    const center = anchorPosition(object.center, ctx);
    if (center) result = atAngle(center, object.radius * binding.t, object.startAngle + (binding.segment === 1 ? object.sweepAngle : 0));
  } else if ('center' in object && binding.segment === undefined) {
    const center = anchorPosition(object.center, ctx);
    if (center) result = atAngle(center, object.radius, object.type === 'circle' ? binding.t * 360 : object.startAngle + binding.t * object.sweepAngle);
  } else if (object.type === 'plot' && binding.segment === undefined) result = evaluatePlot(object, object.xMin + binding.t * (object.xMax - object.xMin));
  ctx.active.delete(object.id);
  return finitePoint(result) ? result : null;
}

export function resolvePoint(point: PointObject, objects: SceneObject[]): Vec { return pointPosition(point, context(objects)) ?? clean(point.position); }
export function resolveAnchor(anchor: Anchor, objects: SceneObject[]): Vec { return anchorPosition(anchor, context(objects)) ?? clean(anchor); }
export function pathPoint(binding: PathBinding, objects: SceneObject[]): Vec | null { return pathPosition(binding, context(objects)); }
export function pathVertices(object: SceneObject, objects: SceneObject[]): Vec[] { return vertices(object, context(objects)) ?? []; }
export function angleOnArc(angle: number, start: number, sweep: number): boolean {
  const travel = sweep >= 0 ? normalizeAngle(angle - start) : normalizeAngle(start - angle);
  return Math.abs(sweep) >= 360 - EPS || travel <= Math.abs(sweep) + EPS;
}

export function projectToPath(point: Vec, object: SceneObject, objects: SceneObject[]): { point: Vec; binding: PathBinding } | null {
  if (!finitePoint(point)) return null;
  let best: { point: Vec; binding: PathBinding } | null = null, bestDistance = Infinity;
  const offer = (position: Vec | null, t: number, segment?: number) => {
    if (!finitePoint(position)) return;
    const distance = distance2(position, point);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { point: position, binding: { objectId: object.id, t: clamp(t), ...(segment === undefined ? {} : { segment }) } };
    }
  };
  if ('points' in object) {
    const points = pathVertices(object, objects), closed = object.type === 'polygon' || object.type === 'rectangle';
    for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
      const a = points[i], b = points[(i + 1) % points.length], length = distance2(a, b);
      const t = length < EPS * EPS ? 0 : clamp(((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length);
      offer({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }, t, closed || points.length > 2 ? i : undefined);
    }
  } else if ('center' in object) {
    const center = resolveAnchor(object.center, objects);
    const angle = normalizeAngle(Math.atan2(point.y - center.y, point.x - center.x) / RAD);
    if (object.type === 'circle') offer(atAngle(center, object.radius, angle), angle / 360);
    else {
      const travel = object.sweepAngle >= 0 ? normalizeAngle(angle - object.startAngle) : normalizeAngle(object.startAngle - angle);
      if (angleOnArc(angle, object.startAngle, object.sweepAngle)) offer(atAngle(center, object.radius, angle), Math.abs(object.sweepAngle) > EPS ? travel / Math.abs(object.sweepAngle) : 0);
      offer(atAngle(center, object.radius, object.startAngle), 0);
      offer(atAngle(center, object.radius, object.startAngle + object.sweepAngle), 1);
      if (object.type === 'sector') for (const segment of [0, 1]) {
        const end = atAngle(center, object.radius, object.startAngle + (segment === 1 ? object.sweepAngle : 0));
        const length = distance2(center, end);
        const t = length < EPS * EPS ? 0 : clamp(((point.x - center.x) * (end.x - center.x) + (point.y - center.y) * (end.y - center.y)) / length);
        offer({ x: center.x + t * (end.x - center.x), y: center.y + t * (end.y - center.y) }, t, segment);
      }
    }
  } else if (object.type === 'plot') {
    const count = 256, range = object.xMax - object.xMin;
    let bestT = 0;
    const evaluate = (t: number): Vec | null => {
      const position = evaluatePlot(object, object.xMin + clamp(t) * range);
      if (!position) return null;
      const localY = position.y - (object.offset?.y ?? 0);
      return localY < (object.yMin ?? -10) || localY > (object.yMax ?? 10) ? null : position;
    };
    // A pointer-derived Cartesian seed finds narrow visible branches missed by uniform samples.
    if (object.mode === 'cartesian') {
      const seed = clamp((point.x - (object.offset?.x ?? 0) - object.xMin) / range);
      offer(evaluate(seed), seed);
      if (best) bestT = seed;
    }
    for (let i = 0; i <= count; i++) {
      const before = bestDistance; offer(evaluate(i / count), i / count);
      if (bestDistance < before) bestT = i / count;
    }
    if (best) {
      let lo = Math.max(0, bestT - 1 / count), hi = Math.min(1, bestT + 1 / count);
      for (let iteration = 0; iteration < 28; iteration++) {
        const t1 = lo + (hi - lo) / 3, t2 = hi - (hi - lo) / 3;
        const p1 = evaluate(t1), p2 = evaluate(t2);
        const d1 = finitePoint(p1) ? distance2(point, p1) : Infinity, d2 = finitePoint(p2) ? distance2(point, p2) : Infinity;
        offer(p1, t1); offer(p2, t2);
        if (d1 < d2) hi = t2; else lo = t1;
      }
    }
  }
  return best;
}
