import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE } from '../core/types';
import type { SceneObject } from '../core/types';
import { arcSvgPath, circleCutAngle, distinctCircleCuts, drawingHasExtent, polygonHasValidReferences } from './construction';

const point: SceneObject = { id: 'a', name: 'A', visible: true, locked: false, style: { ...DEFAULT_STYLE }, type: 'point', position: { x: 1, y: 1 } };
describe('pending polygon references', () => {
  it('accepts free anchors and references to surviving points', () => {
    expect(polygonHasValidReferences([{ x: 1, y: 1, pointId: 'a' }, { x: 2, y: 0 }, { x: 0, y: 0 }], [point])).toBe(true);
  });
  it('rejects references removed by a document replacement or undo', () => {
    expect(polygonHasValidReferences([{ x: 1, y: 1, pointId: 'a' }, { x: 2, y: 0 }, { x: 0, y: 0 }], [])).toBe(false);
  });
  it('does not accept a replacement non-point with the same id', () => {
    const circle: SceneObject = { ...point, type: 'circle', center: { x: 0, y: 0 }, radius: 1 };
    expect(polygonHasValidReferences([{ x: 1, y: 1, pointId: 'a' }], [circle])).toBe(false);
  });
});

it('rejects a circle whose dragged endpoint snaps back to its center', () => {
  const circle: SceneObject = { ...point, type: 'circle', center: { x: 0, y: 0 }, radius: 0 };
  expect(drawingHasExtent(circle)).toBe(false);
  expect(drawingHasExtent({ ...circle, radius: 0.5 })).toBe(true);
});

describe('circle split preview geometry', () => {
  const viewport = { x: 0, y: 0, zoom: 1 };
  it('renders positive world angles counterclockwise on the screen', () => {
    expect(arcSvgPath({ x: 0, y: 0 }, 1, 0, 90, viewport)).toBe('M 48 0 A 48 48 0 0 0 0 -48');
  });
  it('closes a sector through its center and supports a large arc', () => {
    expect(arcSvgPath({ x: 0, y: 0 }, 1, 0, 270, viewport, true)).toBe('M 0 0 L 48 0 A 48 48 0 1 0 0 48 Z');
  });
  it('preserves an imported clockwise arc instead of drawing the opposite portion', () => {
    expect(arcSvgPath({ x: 0, y: 0 }, 1, 0, -270, viewport)).toBe('M 48 0 A 48 48 0 1 1 0 -48');
  });
  it('projects circle cuts by angle and refuses the undefined center position', () => {
    expect(circleCutAngle({ x: 1, y: 2 }, { x: 1, y: -5 })).toBe(270);
    expect(circleCutAngle({ x: 1, y: 2 }, { x: 1, y: 2 })).toBeNull();
  });
  it('rejects clicks near the same cut even across the zero-degree boundary', () => {
    expect(distinctCircleCuts(1, 359, 1, 1)).toBe(false);
    expect(distinctCircleCuts(1, 0, 90, 1)).toBe(true);
  });
});
