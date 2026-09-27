import type { SceneObject, Vec } from './types';
import { angleOnArc, pathVertices, resolveAnchor } from './paths';

type Segment = { kind: 'line'; a: Vec; b: Vec };
type Circle = { kind: 'circle'; center: Vec; radius: number; object: SceneObject };
type Primitive = Segment | Circle;
const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
const subtract = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const interval = (t: number) => t >= -1e-9 && t <= 1 + 1e-9;

function primitive(object: SceneObject, objects: SceneObject[]): Primitive | null {
  if (object.type === 'line' || object.type === 'arrow') {
    const [a, b] = pathVertices(object, objects);
    return a && b ? { kind: 'line', a, b } : null;
  }
  if ('center' in object) return { kind: 'circle', center: resolveAnchor(object.center, objects), radius: object.radius, object };
  return null;
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

/** Static geometric snap candidates; these do not create dependency constraints. */
export function intersectionPoints(first: SceneObject, second: SceneObject, objects: SceneObject[]): Vec[] {
  const a = primitive(first, objects), b = primitive(second, objects);
  if (!a || !b) return [];
  if (a.kind === 'line' && b.kind === 'line') {
    const r = subtract(a.b, a.a), s = subtract(b.b, b.a), q = subtract(b.a, a.a), denominator = cross(r, s);
    if (Math.abs(denominator) < 1e-12) return [];
    const t = cross(q, s) / denominator, u = cross(q, r) / denominator;
    return interval(t) && interval(u) ? [{ x: a.a.x + t * r.x, y: a.a.y + t * r.y }] : [];
  }
  if (a.kind === 'line' && b.kind === 'circle') return lineCircle(a, b);
  if (a.kind === 'circle' && b.kind === 'line') return lineCircle(b, a);
  if (a.kind !== 'circle' || b.kind !== 'circle') return [];
  const dx = b.center.x - a.center.x, dy = b.center.y - a.center.y, d = Math.hypot(dx, dy);
  if (d < 1e-12 || d > a.radius + b.radius + 1e-9 || d < Math.abs(a.radius - b.radius) - 1e-9) return [];
  const along = (a.radius ** 2 - b.radius ** 2 + d ** 2) / (2 * d), height = Math.sqrt(Math.max(0, a.radius ** 2 - along ** 2));
  const mid = { x: a.center.x + along * dx / d, y: a.center.y + along * dy / d };
  return [1, -1].map(sign => ({ x: mid.x - sign * height * dy / d, y: mid.y + sign * height * dx / d })).filter(point => onArc(point, a) && onArc(point, b));
}
