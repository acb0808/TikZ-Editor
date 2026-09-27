import { describe, expect, it } from 'vitest';
import { cutShape } from './geometry';
import { DEFAULT_STYLE, type SceneObject } from './types';

describe('shape cutting', () => {
  it('splits a rectangle into two editable polygons along a crossing line', () => {
    const circle: SceneObject = {
      id: 'circle', name: 'circle', type: 'circle', center: { x: 1, y: 0 }, radius: 2,
      visible: true, locked: false, style: { ...DEFAULT_STYLE },
    };
    const point: SceneObject = {
      id: 'point', name: 'point', type: 'point', position: { x: 3, y: 0 },
      binding: { objectId: circle.id, t: 0 }, visible: true, locked: false, style: { ...DEFAULT_STYLE },
    };
    const rectangle: SceneObject = {
      id: 'rectangle', name: 'rectangle', type: 'rectangle',
      points: [{ x: 4, y: 1 }, { x: 6, y: -1 }],
      visible: true, locked: false, style: { ...DEFAULT_STYLE },
    };
    const result = cutShape([circle, point, rectangle], rectangle.id, { x: 5, y: -2 }, { x: 5, y: 2 });

    expect(result?.pieceIds).toHaveLength(2);
    expect(result?.objects.filter(object => object.type === 'polygon')).toHaveLength(2);
    expect(result?.objects.some(object => object.type === 'rectangle')).toBe(false);
  });
});
