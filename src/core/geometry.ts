import { uid, type Anchor, type ArcObject, type PathBinding, type PointObject, type SceneObject, type Vec } from './types';
import { angleOnArc, atAngle, dependsOn, finitePoint, normalizeAngle, projectToPath, resolveAnchor, resolvePoint } from './paths';
import { samplePlot } from './plot';
import { isObjectDefined } from './defined';
export { angleOnArc, dependsOn, hasDependencyCycle, normalizeAngle, objectDependencies, pathPoint, pathVertices, projectToPath, resolveAnchor, resolvePoint } from './paths';

export function objectAnchors(object: SceneObject, objects: SceneObject[]): Vec[] {
  if ('points' in object) return object.points.map(anchor => resolveAnchor(anchor, objects));
  if ('center' in object) {
    const center = resolveAnchor(object.center, objects);
    if (object.type === 'circle') return [center, { x: center.x + object.radius, y: center.y }];
    return [center, atAngle(center, object.radius, object.startAngle), atAngle(center, object.radius, object.startAngle + object.sweepAngle)];
  }
  if (object.type === 'plot') return [object.offset ?? { x: 0, y: 0 }];
  if (object.type === 'point') return [resolvePoint(object, objects)];
  return [resolveAnchor(object.position, objects)];
}

export function boundsOf(objects: SceneObject[], allObjects: SceneObject[] = objects): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const points = objects.filter(object => object.visible && isObjectDefined(object, allObjects)).flatMap(object => {
    if (object.type === 'plot') return samplePlot(object).flat();
    if ('center' in object) {
      const center = resolveAnchor(object.center, allObjects);
      if (object.type === 'circle') return [{ x: center.x - object.radius, y: center.y - object.radius }, { x: center.x + object.radius, y: center.y + object.radius }];
      const result = [atAngle(center, object.radius, object.startAngle), atAngle(center, object.radius, object.startAngle + object.sweepAngle)];
      for (const angle of [0, 90, 180, 270]) if (angleOnArc(angle, object.startAngle, object.sweepAngle)) result.push(atAngle(center, object.radius, angle));
      if (object.type === 'sector') result.push(center);
      return result;
    }
    return objectAnchors(object, allObjects);
  }).filter(finitePoint);
  if (!points.length) return null;
  return points.reduce((bounds, point) => ({ minX: Math.min(bounds.minX, point.x), minY: Math.min(bounds.minY, point.y), maxX: Math.max(bounds.maxX, point.x), maxY: Math.max(bounds.maxY, point.y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function mapAnchors(object: SceneObject, transform: (anchor: Anchor) => Anchor): SceneObject {
  if ('points' in object) return { ...object, points: object.points.map(transform) };
  if ('center' in object) return { ...object, center: transform(object.center) };
  if (object.type === 'plot') return object;
  return { ...object, position: transform(object.position) };
}

export function translateObjects(objects: SceneObject[], ids: string[], delta: Vec): SceneObject[] {
  if (!finitePoint(delta)) return objects;
  const selected = new Set(ids.filter(id => objects.some(object => object.id === id && !object.locked)));
  const movingPoints = new Set(objects.filter(object => selected.has(object.id) && object.type === 'point' && !object.locked).map(object => object.id));
  const translated = new Set(selected);
  for (let pass = 0; pass < objects.length; pass++) {
    let changed = false;
    for (const object of objects) {
      if (translated.has(object.id)) continue;
      const rigid = object.type === 'point' ? !!object.binding && translated.has(object.binding.objectId)
        : 'center' in object ? !!object.center.pointId && translated.has(object.center.pointId)
        : 'points' in object ? object.points.every(anchor => !!anchor.pointId && translated.has(anchor.pointId)) : false;
      if (rigid) { translated.add(object.id); changed = true; }
    }
    if (!changed) break;
  }
  for (const object of objects) if (object.type === 'point' && translated.has(object.id)) movingPoints.add(object.id);
  const result = objects.map(object => {
    if (!selected.has(object.id)) return object;
    if (object.type === 'plot') return { ...object, offset: { x: (object.offset?.x ?? 0) + delta.x, y: (object.offset?.y ?? 0) + delta.y } };
    if (object.type === 'point') {
      const resolved = resolvePoint(object, objects);
      return { ...object, position: { x: resolved.x + delta.x, y: resolved.y + delta.y } };
    }
    return mapAnchors(object, anchor => {
      const resolved = resolveAnchor(anchor, objects);
      const position: Anchor = { x: resolved.x + delta.x, y: resolved.y + delta.y };
      if (anchor.pointId && movingPoints.has(anchor.pointId)) position.pointId = anchor.pointId;
      return position;
    });
  });
  return result.map(object => {
    if (object.type !== 'point' || !object.binding || !selected.has(object.id) || translated.has(object.binding.objectId)) return object;
    const host = result.find(candidate => candidate.id === object.binding!.objectId);
    const projection = host ? projectToPath(object.position, host, result) : null;
    return projection ? { ...object, position: projection.point, binding: projection.binding } : object;
  });
}

export function moveHandle(objects: SceneObject[], id: string, index: number, position: Anchor): SceneObject[] {
  if (!finitePoint(position)) return objects;
  const target = position.pointId ? objects.find(object => object.id === position.pointId) : undefined;
  const safePosition: Anchor = target?.type === 'point' && !dependsOn(objects, target.id, new Set([id])) ? { ...position } : { x: position.x, y: position.y };
  return objects.map(object => {
    if (object.id !== id || object.locked || !Number.isInteger(index) || index < 0 || object.type === 'plot') return object;
    if ('points' in object) {
      if (index >= object.points.length) return object;
      return { ...object, points: object.points.map((anchor, i) => i === index ? safePosition : anchor) };
    }
    if ('center' in object) {
      if (index === 0) return { ...object, center: safePosition };
      const center = resolveAnchor(object.center, objects), endpoint = resolveAnchor(safePosition, objects);
      const radius = Math.hypot(endpoint.x - center.x, endpoint.y - center.y);
      if (object.type === 'circle') return index === 1 ? { ...object, radius } : object;
      const angle = normalizeAngle(Math.atan2(endpoint.y - center.y, endpoint.x - center.x) * 180 / Math.PI);
      if (index === 1) {
        const end = object.startAngle + object.sweepAngle;
        const sweep = object.sweepAngle >= 0 ? normalizeAngle(end - angle) : -normalizeAngle(angle - end);
        return Math.abs(sweep) < 1e-9 ? object : { ...object, radius, startAngle: angle, sweepAngle: sweep };
      }
      if (index === 2) {
        const sweep = object.sweepAngle >= 0 ? normalizeAngle(angle - object.startAngle) : -normalizeAngle(object.startAngle - angle);
        return Math.abs(sweep) < 1e-9 ? object : { ...object, sweepAngle: sweep };
      }
      return object;
    }
    if (index !== 0) return object;
    if (object.type === 'point' && object.binding) {
      const host = objects.find(candidate => candidate.id === object.binding!.objectId);
      const projection = host ? projectToPath(resolveAnchor(safePosition, objects), host, objects) : null;
      return projection ? { ...object, position: projection.point, binding: projection.binding } : object;
    }
    return { ...object, position: object.type === 'point' ? resolveAnchor(safePosition, objects) : safePosition };
  });
}

export function removeObjects(objects: SceneObject[], ids: string[]): SceneObject[] {
  const removed = new Set(objects.filter(object => ids.includes(object.id) && !object.locked).map(object => object.id));
  return objects.filter(object => !removed.has(object.id)).map(object => {
    if (object.type === 'point' && object.binding && removed.has(object.binding.objectId)) return withoutBinding(object, resolvePoint(object, objects));
    return mapAnchors(object, anchor => anchor.pointId && removed.has(anchor.pointId) ? resolveAnchor(anchor, objects) : anchor);
  });
}

function withoutBinding(point: PointObject, position: Vec): PointObject {
  const { binding: _binding, ...free } = point;
  return { ...free, position };
}

export function duplicateObjects(objects: SceneObject[], ids: string[], delta: Vec = { x: 0.5, y: -0.5 }): SceneObject[] {
  const selected = objects.filter(object => ids.includes(object.id));
  const idMap = new Map(selected.map(object => [object.id, uid()]));
  return selected.map(object => {
    let copy: SceneObject;
    if (object.type === 'point') {
      const resolved = resolvePoint(object, objects), position = { x: resolved.x + delta.x, y: resolved.y + delta.y };
      copy = object.binding && idMap.has(object.binding.objectId)
        ? { ...structuredClone(object), position, binding: { ...object.binding, objectId: idMap.get(object.binding.objectId)! } }
        : withoutBinding(structuredClone(object), position);
    } else if (object.type === 'plot') copy = { ...structuredClone(object), offset: { x: (object.offset?.x ?? 0) + delta.x, y: (object.offset?.y ?? 0) + delta.y } };
    else copy = mapAnchors(structuredClone(object), anchor => {
      const position = resolveAnchor(anchor, objects);
      const translated: Anchor = { x: position.x + delta.x, y: position.y + delta.y };
      if (anchor.pointId && idMap.has(anchor.pointId)) translated.pointId = idMap.get(anchor.pointId);
      return translated;
    });
    return { ...copy, id: idMap.get(object.id)!, name: `${object.name.slice(0, 497)} 복사` };
  });
}

/** Replace a circle at its original layer with complementary CCW arcs. */
export function splitCircle(objects: SceneObject[], circleId: string, startAngle: number, endAngle: number): SceneObject[] {
  const circle = objects.find(object => object.id === circleId);
  if (circle?.type !== 'circle' || circle.locked || !Number.isFinite(startAngle) || !Number.isFinite(endAngle) || circle.radius <= 0) return objects;
  const start = normalizeAngle(startAngle), sweep = normalizeAngle(endAngle - startAngle);
  if (sweep < 1e-6 || sweep > 360 - 1e-6) return objects;
  const secondId = uid();
  const first: ArcObject = { ...circle, type: 'arc', startAngle: start, sweepAngle: sweep };
  const second: ArcObject = { ...circle, id: secondId, name: `${circle.name.slice(0, 496)} 나머지`, type: 'arc', startAngle: normalizeAngle(endAngle), sweepAngle: 360 - sweep };
  return objects.flatMap((object): SceneObject[] => {
    if (object.id === circleId) return [first, second];
    if (object.type !== 'point' || object.binding?.objectId !== circleId) return [object];
    const travel = normalizeAngle(object.binding.t * 360 - start);
    const binding: PathBinding = travel <= sweep + 1e-9
      ? { objectId: circleId, t: Math.max(0, Math.min(1, travel / sweep)) }
      : { objectId: secondId, t: Math.max(0, Math.min(1, (travel - sweep) / (360 - sweep))) };
    return [{ ...object, position: resolvePoint(object, objects), binding }];
  });
}
