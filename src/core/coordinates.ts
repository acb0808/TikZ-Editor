import type { Vec, Viewport } from './types';
export const BASE_SCALE = 48;
export function worldToScreen(point: Vec, viewport: Viewport): Vec {
  const scale = BASE_SCALE * viewport.zoom;
  return { x: viewport.x + point.x * scale, y: viewport.y - point.y * scale };
}
export function screenToWorld(point: Vec, viewport: Viewport): Vec {
  const scale = BASE_SCALE * viewport.zoom;
  return { x: (point.x - viewport.x) / scale, y: (viewport.y - point.y) / scale };
}
export function zoomAt(viewport: Viewport, screen: Vec, zoom: number): Viewport {
  const world = screenToWorld(screen, viewport);
  return { x: screen.x - world.x * BASE_SCALE * zoom, y: screen.y + world.y * BASE_SCALE * zoom, zoom };
}
