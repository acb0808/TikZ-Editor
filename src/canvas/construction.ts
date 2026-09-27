import { BASE_SCALE, worldToScreen } from '../core/coordinates';
import type { Anchor, SceneObject, Vec, Viewport } from '../core/types';

/** A pending construction must not introduce references to a replaced document. */
export function polygonHasValidReferences(anchors: Anchor[], objects: SceneObject[]): boolean {
  const pointIds = new Set(objects.filter(object => object.type === 'point').map(object => object.id));
  return anchors.every(anchor => !anchor.pointId || pointIds.has(anchor.pointId));
}

export function drawingHasExtent(object: SceneObject): boolean {
  return object.type !== 'circle' || object.radius > 0;
}

export function circleCutAngle(center: Vec, point: Vec): number | null {
  if (Math.hypot(point.x - center.x, point.y - center.y) < 1e-10) return null;
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI + 360) % 360;
}

export function distinctCircleCuts(radius: number, first: number, second: number, zoom: number): boolean {
  const chord = Math.abs(2 * radius * Math.sin((second - first) * Math.PI / 360));
  return chord * BASE_SCALE * zoom >= 8;
}

export function arcSvgPath(center: Vec, radius: number, startAngle: number, sweepAngle: number, viewport: Viewport, sector = false): string {
  const format = (value: number) => String(Number(value.toFixed(6)));
  const screen = (angle: number) => worldToScreen({ x: center.x + radius * Math.cos(angle * Math.PI / 180), y: center.y + radius * Math.sin(angle * Math.PI / 180) }, viewport);
  const pair = (point: Vec) => `${format(point.x)} ${format(point.y)}`;
  const start = screen(startAngle), end = screen(startAngle + sweepAngle);
  const r = format(radius * BASE_SCALE * viewport.zoom);
  const direction = sweepAngle < 0 ? 1 : 0;
  const prefix = sector ? `M ${pair(worldToScreen(center, viewport))} L ${pair(start)}` : `M ${pair(start)}`;
  const arc = Math.abs(sweepAngle) >= 359.999999
    ? ` A ${r} ${r} 0 0 ${direction} ${pair(screen(startAngle + sweepAngle / 2))} A ${r} ${r} 0 0 ${direction} ${pair(end)}`
    : ` A ${r} ${r} 0 ${Math.abs(sweepAngle) > 180 ? 1 : 0} ${direction} ${pair(end)}`;
  return prefix + arc + (sector ? ' Z' : '');
}
