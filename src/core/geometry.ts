import { uid, type Anchor, type ArcObject, type PathBinding, type PointObject, type SceneObject, type Vec } from './types';
import { angleOnArc, atAngle, dependsOn, finitePoint, normalizeAngle, pathVertices, projectToPath, resolveAnchor, resolvePoint } from './paths';
import { isObjectDefined } from './defined';
import { shapeBoundary, splitBoundaryByLine } from './planar';
import { samplePlot } from './plot';
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

export interface CutResult { objects: SceneObject[]; pieceIds: string[] }

const signedSide = (point: Vec, start: Vec, direction: Vec) => direction.x * (point.y - start.y) - direction.y * (point.x - start.x);
function splitPolyline(points: Vec[], start: Vec, direction: Vec): Vec[][] {
  if (points.length < 2) return [];
  const pieces: Vec[][] = [];
  let current = [points[0]], splitCount = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], da = signedSide(a, start, direction), db = signedSide(b, start, direction);
    if (da * db < -1e-12) {
      const t = da / (da - db), intersection = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      current.push(intersection);
      if (current.length >= 2) pieces.push(current);
      current = [intersection, b]; splitCount++;
    } else if (Math.abs(db) < 1e-10 && i < points.length - 1) {
      current.push(b);
      const nextSide = signedSide(points[i + 1], start, direction);
      if (da * nextSide < -1e-12) { if (current.length >= 2) pieces.push(current); current = [b]; splitCount++; }
    } else current.push(b);
  }
  if (current.length >= 2) pieces.push(current);
  return splitCount ? pieces : [];
}

function objectForPiece(source: SceneObject, points: Vec[], index: number, count: number, objects: SceneObject[], closed: boolean): SceneObject {
  const anchors: Anchor[] = points.map(point => {
    if ('points' in source) {
      const match = source.points.find(anchor => {
        const resolved = resolveAnchor(anchor, objects);
        return Math.hypot(resolved.x - point.x, resolved.y - point.y) < 1e-8;
      });
      if (match) return { ...match };
    }
    return { x: point.x, y: point.y };
  });
  const name = count === 2 ? `${source.name.slice(0, 494)} 조각 ${index + 1}` : `${source.name.slice(0, 492)} 조각 ${index + 1}`;
  const style = { ...source.style };
  if (source.type === 'arrow') {
    const hasStart = source.style.arrows === 'start' || source.style.arrows === 'both';
    const hasEnd = source.style.arrows === 'end' || source.style.arrows === 'both';
    const startArrow = index === 0 && hasStart, endArrow = index === count - 1 && hasEnd;
    style.arrows = startArrow && endArrow ? 'both' : startArrow ? 'start' : endArrow ? 'end' : 'none';
  }
  const common = { id: source.id, name, visible: source.visible, locked: false, style };
  return { ...common, type: closed ? 'polygon' : source.type === 'arrow' ? 'arrow' : 'line', points: anchors } as SceneObject;
}

/** Split a selected line, arc, circle, sector, rectangle, or polygon with an infinite cutting line. */
export function cutShape(objects: SceneObject[], objectId: string, start: Vec, end: Vec): CutResult | null {
  const source = objects.find(object => object.id === objectId);
  const direction = { x: end.x - start.x, y: end.y - start.y };
  if (!source || source.locked || Math.hypot(direction.x, direction.y) < 1e-8) return null;

  let pointPieces: Vec[][];
  const closed = shapeBoundary(source, objects);
  if (closed) {
    pointPieces = splitBoundaryByLine(closed, start, end);
  } else {
    let paths: Vec[][] = [];
    if (source.type === 'line' || source.type === 'arrow') paths = [pathVertices(source, objects)];
    else if (source.type === 'arc') {
      const center = resolveAnchor(source.center, objects), steps = Math.max(2, Math.ceil(Math.abs(source.sweepAngle) / 3));
      paths = [Array.from({ length: steps + 1 }, (_, index) => atAngle(center, source.radius, source.startAngle + source.sweepAngle * index / steps))];
    }
    else if (source.type === 'plot') paths = samplePlot(source);
    else return null;
    pointPieces = [];
    let crossed = false;
    for (const path of paths) {
      const pieces = splitPolyline(path, start, direction);
      if (pieces.length) { crossed = true; pointPieces.push(...pieces); }
      else if (source.type === 'plot' && path.length >= 2) pointPieces.push(path);
    }
    if (!crossed) return null;
  }
  if (pointPieces.length < 2) return null;

  const originalBoundPoints = objects.filter((object): object is PointObject => object.type === 'point' && object.binding?.objectId === objectId)
    .map(point => ({ point, position: resolvePoint(point, objects) }));
  const ids = pointPieces.map((_, index) => index === 0 ? source.id : uid());
  const pieces = pointPieces.map((points, index) => {
    const piece = objectForPiece(source, points, index, pointPieces.length, objects, !!closed);
    return { ...piece, id: ids[index], visible: source.visible, locked: false } as SceneObject;
  });
  const replaced = objects.flatMap(object => object.id === objectId ? pieces : [object]);
  const nextObjects = replaced.map(object => {
    if (object.type !== 'point') return object;
    const bound = originalBoundPoints.find(item => item.point.id === object.id);
    if (!bound) return object;
    let best: { point: Vec; binding: PathBinding } | null = null, distance = Infinity;
    for (const host of pieces) {
      const projected = projectToPath(bound.position, host, replaced);
      if (!projected) continue;
      const current = Math.hypot(projected.point.x - bound.position.x, projected.point.y - bound.position.y);
      if (current < distance) { best = projected; distance = current; }
    }
    return best ? { ...object, position: bound.position, binding: best.binding } : withoutBinding(object, bound.position);
  });
  return { objects: nextObjects, pieceIds: ids };
}
