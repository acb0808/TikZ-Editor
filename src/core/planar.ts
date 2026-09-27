import { DEFAULT_STYLE, uid } from './types';
import type { SceneObject, Vec } from './types';
import { pathVertices, resolveAnchor } from './paths';
import { isObjectDefined } from './defined';
import { samplePlot } from './plot';

type Segment = { a: Vec; b: Vec; cuts: Array<{ t: number; point: Vec }> };
const EPS = 1e-8;
const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const area = (points: Vec[]) => points.reduce((sum, point, index) => {
  const next = points[(index + 1) % points.length];
  return sum + point.x * next.y - next.x * point.y;
}, 0) / 2;

export function pointInPolygon(point: Vec, polygon: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    const onEdge = Math.abs(cross(sub(b, a), sub(point, a))) <= EPS * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
      && point.x >= Math.min(a.x, b.x) - EPS && point.x <= Math.max(a.x, b.x) + EPS
      && point.y >= Math.min(a.y, b.y) - EPS && point.y <= Math.max(a.y, b.y) + EPS;
    if (onEdge) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function closedBoundary(object: SceneObject, objects: SceneObject[]): Vec[] | null {
  if (object.type === 'circle') {
    const center = resolveAnchor(object.center, objects);
    return Array.from({ length: 120 }, (_, index) => {
      const angle = index * Math.PI * 2 / 120;
      return { x: center.x + Math.cos(angle) * object.radius, y: center.y + Math.sin(angle) * object.radius };
    });
  }
  if (object.type === 'sector') {
    const center = resolveAnchor(object.center, objects);
    const steps = Math.max(2, Math.ceil(Math.abs(object.sweepAngle) / 3));
    const arc = Array.from({ length: steps + 1 }, (_, index) => {
      const angle = (object.startAngle + object.sweepAngle * index / steps) * Math.PI / 180;
      return { x: center.x + object.radius * Math.cos(angle), y: center.y + object.radius * Math.sin(angle) };
    });
    return [center, ...arc];
  }
  if (object.type === 'polygon') return pathVertices(object, objects);
  if (object.type === 'rectangle') return pathVertices(object, objects);
  return null;
}

function addPath(segments: Segment[], points: Vec[], close = false) {
  const count = close ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) > EPS) segments.push({ a, b, cuts: [{ t: 0, point: a }, { t: 1, point: b }] });
  }
}

function sceneSegments(objects: SceneObject[]): Segment[] {
  const segments: Segment[] = [];
  for (const object of objects) {
    if (!object.visible || !isObjectDefined(object, objects)) continue;
    if (object.type === 'line' || object.type === 'arrow') addPath(segments, pathVertices(object, objects));
    else if (object.type === 'plot') for (const path of samplePlot(object)) addPath(segments, path);
    else {
      const boundary = closedBoundary(object, objects);
      if (boundary) addPath(segments, boundary, true);
    }
    if (segments.length > 800) return [];
  }
  return segments;
}

function intersect(a: Segment, b: Segment): { t: number; u: number; point: Vec } | null {
  const r = sub(a.b, a.a), s = sub(b.b, b.a), q = sub(b.a, a.a), denominator = cross(r, s);
  if (Math.abs(denominator) < EPS) return null;
  const t = cross(q, s) / denominator, u = cross(q, r) / denominator;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { t: Math.max(0, Math.min(1, t)), u: Math.max(0, Math.min(1, u)), point: { x: a.a.x + t * r.x, y: a.a.y + t * r.y } };
}

/** Enumerate bounded faces in the visible line and shape arrangement. */
export function findPlanarFaces(objects: SceneObject[]): Vec[][] {
  const segments = sceneSegments(objects);
  if (!segments.length || segments.length > 800) return [];
  let crossings = 0;
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const hit = intersect(segments[i], segments[j]);
    if (hit) {
      if (++crossings > 4000) return [];
      segments[i].cuts.push({ t: hit.t, point: hit.point });
      segments[j].cuts.push({ t: hit.u, point: hit.point });
    }
  }

  const vertices: Vec[] = [], keyToId = new Map<string, number>();
  const vertexId = (point: Vec) => {
    const key = `${Math.round(point.x / EPS)},${Math.round(point.y / EPS)}`;
    let id = keyToId.get(key);
    if (id === undefined) { id = vertices.length; vertices.push(point); keyToId.set(key, id); }
    return id;
  };
  const edgeKeys = new Set<string>(), edges: Array<[number, number]> = [];
  for (const segment of segments) {
    segment.cuts.sort((a, b) => a.t - b.t);
    for (let i = 1; i < segment.cuts.length; i++) {
      const a = vertexId(segment.cuts[i - 1].point), b = vertexId(segment.cuts[i].point);
      if (a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!edgeKeys.has(key)) { edgeKeys.add(key); edges.push([a, b]); }
    }
  }
  const neighbors = Array.from({ length: vertices.length }, () => new Set<number>());
  for (const [a, b] of edges) { neighbors[a].add(b); neighbors[b].add(a); }
  const ordered = neighbors.map((adjacent, id) => [...adjacent].sort((a, b) =>
    Math.atan2(vertices[a].y - vertices[id].y, vertices[a].x - vertices[id].x)
    - Math.atan2(vertices[b].y - vertices[id].y, vertices[b].x - vertices[id].x)));

  const visited = new Set<string>(), candidates: Vec[][] = [];
  for (const [from, to] of edges) for (const [startA, startB] of [[from, to], [to, from]]) {
    const start = `${startA}>${startB}`;
    if (visited.has(start)) continue;
    const face: Vec[] = [];
    let previous = startA, current = startB;
    for (let step = 0; step <= edges.length * 2; step++) {
      const directed = `${previous}>${current}`;
      if (visited.has(directed)) break;
      visited.add(directed);
      face.push(vertices[previous]);
      const at = ordered[current], reverseIndex = at.indexOf(previous);
      if (reverseIndex < 0 || at.length < 2) break;
      const next = at[(reverseIndex - 1 + at.length) % at.length];
      previous = current; current = next;
      if (`${previous}>${current}` === start) break;
    }
    if (face.length >= 3 && area(face) > EPS) candidates.push(face);
  }
  return candidates;
}

export function findPlanarFaceAtPoint(objects: SceneObject[], target: Vec): Vec[] | null {
  return findPlanarFaces(objects).filter(face => face.length <= 10_000 && pointInPolygon(target, face)).sort((a, b) => area(a) - area(b))[0] ?? null;
}

function interiorProbe(face: Vec[], boundary: Vec[]): Vec {
  const span = Math.max(1, ...boundary.map(point => Math.max(Math.abs(point.x), Math.abs(point.y))));
  for (const factor of [1e-5, 1e-7, 1e-9]) for (let index = 0; index < face.length; index++) {
    const a = face[index], b = face[(index + 1) % face.length], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < EPS) continue;
    const amount = Math.min(length * factor, span * factor);
    const point = { x: (a.x + b.x) / 2 - dy / length * amount, y: (a.y + b.y) / 2 + dx / length * amount };
    if (pointInPolygon(point, face) && pointInPolygon(point, boundary)) return point;
  }
  return face.reduce((sum, point) => ({ x: sum.x + point.x / face.length, y: sum.y + point.y / face.length }), { x: 0, y: 0 });
}

/** Partition a closed boundary at every crossing with an infinite cutting line. */
export function splitBoundaryByLine(boundary: Vec[], start: Vec, end: Vec): Vec[][] {
  if (boundary.length < 3 || boundary.length > 700) return [];
  const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
  if (length < EPS) return [];
  const ux = dx / length, uy = dy / length, projections = boundary.map(point => (point.x - start.x) * ux + (point.y - start.y) * uy);
  const margin = Math.max(1, ...boundary.map(point => Math.hypot(point.x - start.x, point.y - start.y))) + 1;
  const a = { x: start.x + ux * (Math.min(...projections) - margin), y: start.y + uy * (Math.min(...projections) - margin) };
  const b = { x: start.x + ux * (Math.max(...projections) + margin), y: start.y + uy * (Math.max(...projections) + margin) };
  const base = { id: uid(), name: '절단 대상', visible: true, locked: false, style: { ...DEFAULT_STYLE } };
  const region: SceneObject = { ...base, type: 'polygon', points: boundary.map(point => ({ ...point })) };
  const cutter: SceneObject = { ...base, id: uid(), type: 'line', points: [a, b] };
  const direction = { x: dx, y: dy };
  return findPlanarFaces([region, cutter]).filter(face => {
    const sample = interiorProbe(face, boundary);
    const side = direction.x * (sample.y - start.y) - direction.y * (sample.x - start.x);
    return pointInPolygon(sample, boundary) && Math.abs(side) > EPS;
  });
}

/** Boundary approximation used only by destructive cut and bounded-area operations. */
export function shapeBoundary(object: SceneObject, objects: SceneObject[]): Vec[] | null {
  return closedBoundary(object, objects);
}
