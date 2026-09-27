import type { Anchor, SceneObject } from './types';
import { finitePoint, objectDependencies, pathPoint } from './paths';
import { validatePlotExpression } from './plot';

/** Mathematical validity is separate from visibility and from stored fallback coordinates.
 * Do not erase bindings when a parameter temporarily leaves the real domain.
 */
export function isObjectDefined(object: SceneObject, objects: SceneObject[]): boolean {
  const context = objects.includes(object) ? objects : [...objects.filter(candidate => candidate.id !== object.id), object];
  const byId = new Map(context.map(candidate => [candidate.id, candidate]));
  const visited = new Set<string>(), pending = [object];
  while (pending.length) {
    const current = pending.pop()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    if (visited.size > 10000) return false;
    if (current.type === 'point') {
      if (current.binding) {
        if (!finitePoint(pathPoint(current.binding, context))) return false;
      } else if (!finitePoint(current.position)) return false;
    } else if (current.type === 'plot') {
      // An empty display window does not invalidate a point on the underlying function.
      if (validatePlotExpression(current)) return false;
    } else {
      const anchors: Anchor[] = 'points' in current ? current.points : 'center' in current ? [current.center] : [current.position];
      for (const anchor of anchors) {
        if (anchor.pointId ? byId.get(anchor.pointId)?.type !== 'point' : !finitePoint(anchor)) return false;
      }
      if ('center' in current && (!Number.isFinite(current.radius) || current.radius < 0)) return false;
      if ((current.type === 'arc' || current.type === 'sector') && ![current.startAngle, current.sweepAngle].every(Number.isFinite)) return false;
    }
    for (const id of objectDependencies(current)) {
      const dependency = byId.get(id);
      if (!dependency) return false;
      if (!visited.has(id)) pending.push(dependency);
    }
  }
  return true;
}
