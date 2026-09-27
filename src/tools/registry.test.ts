import { describe, expect, it } from 'vitest';
import { makeObject, tools } from './registry';

describe('drawing tools', () => {
  it('preserves an endpoint connection when drawing a segment', () => {
    const object = makeObject('line', [{ x: 1, y: 2, pointId: 'a' }, { x: 3, y: 4 }]);
    expect(object.type).toBe('line');
    if (object.type === 'line') expect(object.points[0].pointId).toBe('a');
  });
  it('creates the circle radius from the second anchor', () => {
    const object = makeObject('circle', [{ x: 1, y: 2 }, { x: 4, y: 6 }]);
    expect(object.type).toBe('circle');
    if (object.type === 'circle') expect(object.radius).toBe(5);
  });
  it('keeps new point objects independent from the snapped reference', () => {
    const object = makeObject('point', [{ x: 1, y: 2, pointId: 'a' }]);
    expect(object.type).toBe('point');
    if (object.type === 'point') expect(object.position).toEqual({ x: 1, y: 2 });
  });
  it('creates a forward arrow and nonempty editable math label', () => {
    const arrow = makeObject('arrow', [{ x: 0, y: 0 }, { x: 2, y: 0 }]);
    expect(arrow.style.arrows).toBe('end');
    const math = makeObject('math', [{ x: 1, y: 2 }]);
    if (math.type === 'math') expect(math.text).toContain('x');
  });
  it('does not share style objects between new shapes', () => {
    const a = makeObject('point', [{ x: 0, y: 0 }]);
    const b = makeObject('point', [{ x: 0, y: 0 }]);
    a.style.stroke = '#ffffff';
    expect(b.style.stroke).not.toBe('#ffffff');
    expect(new Set(tools.map(tool => tool.shortcut.toLowerCase())).size).toBe(tools.length);
  });
  it('exposes general shape cutting without adding plotting to drag drawing tools', () => {
    expect(tools.find(tool => tool.id === 'cut')?.shortcut).toBe('X');
    expect(tools.some(tool => String(tool.id) === 'plot')).toBe(false);
  });
  it('stores an independent path binding on a newly created point', () => {
    const binding = { objectId: 'circle', t: 0.25 };
    const object = makeObject('point', [{ x: 0, y: 2 }], binding);
    if (object.type !== 'point') throw new Error('Expected point');
    expect(object.binding).toEqual(binding);
    binding.t = 0.5;
    expect(object.binding?.t).toBe(0.25);
  });
});
