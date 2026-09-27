import type { SceneObject, Vec } from './types';
import { angleOnArc, pathVertices, resolveAnchor } from './paths';
import { samplePlot } from './plot';

type Segment = { kind: 'line'; a: Vec; b: Vec };
type Circle = { kind: 'circle'; center: Vec; radius: number; object: SceneObject };
type Primitive = Segment | Circle;
const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
const subtract = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const interval = (t: number) => t >= -1e-9 && t <= 1 + 1e-9;

function primitives(object: SceneObject, objects: SceneObject[]): Primitive[] {
  if (object.type === 'plot') return samplePlot(object).flatMap(path => {
    const stride = Math.max(1, Math.ceil((path.length - 1) / 128)), result: Primitive[] = [];
    for (let i = stride; i < path.length; i += stride) result.push({ kind: 'line', a: path[i - stride], b: path[i] });
    if (path.length > 1 && (path.length - 1) % stride) result.push({ kind: 'line', a: path[path.length - 1 - ((path.length - 1) % stride)], b: path.at(-1)! });
    return result;
  });
  if ('points' in object) {
    const vertices = pathVertices(object, objects), closed = object.type === 'polygon' || object.type === 'rectangle';
    const count = vertices.length - (closed ? 0 : 1);
    return Array.from({ length: Math.max(0, count) }, (_, index) => ({ kind: 'line' as const, a: vertices[index], b: vertices[(index + 1) % vertices.length] }));
  }
  if ('center' in object) {
    const center = resolveAnchor(object.center, objects), result: Primitive[] = [{ kind: 'circle', center, radius: object.radius, object }];
    if (object.type === 'sector') {
      result.push({ kind: 'line', a: center, b: { x: center.x + object.radius * Math.cos(object.startAngle * Math.PI / 180), y: center.y + object.radius * Math.sin(object.startAngle * Math.PI / 180) } });
      const angle = (object.startAngle + object.sweepAngle) * Math.PI / 180;
      result.push({ kind: 'line', a: center, b: { x: center.x + object.radius * Math.cos(angle), y: center.y + object.radius * Math.sin(angle) } });
    }
    return result;
  }
  return [];
}
function onArc(point: Vec, circle: Circle): boolean {
  if (circle.object.type !== 'arc' && circle.object.type !== 'sector') return true;
  const angle = Math.atan2(point.y - circle.center.y, point.x - circle.center.x) * 180 / Math.PI;
  return angleOnArc(angle, circle.object.startAngle, circle.object.sweepAngle);
}
function lineCircle(line: Segment, circle: Circle): Vec[] {
  const d = subtract(line.b, line.a), f = subtract(line.a, circle.center);
  const a = d.x * d.x + d.y * d.y;
  if (a < 1e-20) return [];
  const b = 2 * (f.x * d.x + f.y * d.y), c = f.x * f.x + f.y * f.y - circle.radius ** 2;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -1e-9) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter(interval).map(t => ({ x: line.a.x + t * d.x, y: line.a.y + t * d.y })).filter(point => onArc(point, circle));
}

function lineLine(first: Segment, second: Segment): Vec[] {
  const r = subtract(first.b, first.a), s = subtract(second.b, second.a), q = subtract(second.a, first.a), denominator = cross(r, s);
  if (Math.abs(denominator) < 1e-12) return [];
  const t = cross(q, s) / denominator, u = cross(q, r) / denominator;
  return interval(t) && interval(u) ? [{ x: first.a.x + t * r.x, y: first.a.y + t * r.y }] : [];
}

function circleCircle(a: Circle, b: Circle): Vec[] {
  const dx = b.center.x - a.center.x, dy = b.center.y - a.center.y, d = Math.hypot(dx, dy);
  if (d < 1e-12 || d > a.radius + b.radius + 1e-9 || d < Math.abs(a.radius - b.radius) - 1e-9) return [];
  const along = (a.radius ** 2 - b.radius ** 2 + d ** 2) / (2 * d), height = Math.sqrt(Math.max(0, a.radius ** 2 - along ** 2));
  const mid = { x: a.center.x + along * dx / d, y: a.center.y + along * dy / d };
  return [1, -1].map(sign => ({ x: mid.x - sign * height * dy / d, y: mid.y + sign * height * dx / d })).filter(point => onArc(point, a) && onArc(point, b));
}

/** Static geometric snap candidates; these do not create dependency constraints. */
export function intersectionPoints(first: SceneObject, second: SceneObject, objects: SceneObject[]): Vec[] {
  const left = primitives(first, objects), right = primitives(second, objects), result: Vec[] = [];
  for (const a of left) for (const b of right) {
    if (a.kind === 'line' && b.kind === 'line') result.push(...lineLine(a, b));
    else if (a.kind === 'line' && b.kind === 'circle') result.push(...lineCircle(a, b));
    else if (a.kind === 'circle' && b.kind === 'line') result.push(...lineCircle(b, a));
    else if (a.kind === 'circle' && b.kind === 'circle') result.push(...circleCircle(a, b));
  }
  return result.filter((point, index) => result.findIndex(other => Math.hypot(other.x - point.x, other.y - point.y) < 1e-8) === index);
}
