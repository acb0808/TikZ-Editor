import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeObject } from '../tools/registry';
import { SceneShape } from './SceneShape';
import { DEFAULT_STYLE } from '../core/types';
import type { SceneObject } from '../core/types';
import { parseTikz } from '../tikz/parser';

const viewport = { x: 0, y: 0, zoom: 1 };

describe('safe math preview', () => {
  it('keeps a deeply nested, unrenderable expression editable instead of crashing the canvas', () => {
    const object = makeObject('math', [{ x: 0, y: 0 }]);
    if (object.type !== 'math') throw new Error('Expected math object');
    object.text = '{'.repeat(15_000) + 'x' + '}'.repeat(15_000);
    expect(() => renderToStaticMarkup(createElement('svg', null, createElement(SceneShape, { object, objects: [object], viewport, interactive: true })))).not.toThrow();
  });
  it('does not enable user-supplied HTML in math expressions', () => {
    const object = makeObject('math', [{ x: 0, y: 0 }]);
    if (object.type !== 'math') throw new Error('Expected math object');
    object.text = '\\href{javascript:alert(1)}{x}';
    const svg = renderToStaticMarkup(createElement('svg', null, createElement(SceneShape, { object, objects: [object], viewport, interactive: true })));
    expect(svg).not.toContain('href="javascript:');
  });
  it('marks static math exports for a typeset SVG replacement', () => {
    const object = makeObject('math', [{ x: 1, y: 2 }]);
    const svg = renderToStaticMarkup(createElement('svg', null, createElement(SceneShape, { object, objects: [object], viewport })));
    expect(svg).toContain('data-math=');
    expect(svg).toContain('x="48"');
    expect(svg).toContain('y="-96"');
  });
});

describe('point appearance', () => {
  it('renders a hollow point when fill is explicitly disabled', () => {
    const object = makeObject('point', [{ x: 0, y: 0 }]);
    object.style.fill = 'none';
    const svg = renderToStaticMarkup(createElement('svg', null, createElement(SceneShape, { object, objects: [object], viewport })));
    expect(svg).toContain('fill="none"');
  });
  it('scales the canonical 0.055cm marker with the viewport', () => {
    const object = makeObject('point', [{ x: 0, y: 0 }]);
    const svg = renderToStaticMarkup(createElement('svg', null, createElement(SceneShape, { object, objects: [object], viewport: { ...viewport, zoom: 2 } })));
    expect(svg).toContain('r="5.28"');
  });
});

describe('dynamic geometry rendering', () => {
  const base = { id: 'shape', name: '도형', visible: true, locked: false, style: { ...DEFAULT_STYLE } };
  const render = (object: SceneObject, objects = [object]) => renderToStaticMarkup(createElement('svg', null, createElement(SceneShape, { object, objects, viewport })));
  it('renders a point at its current host position instead of its fallback position', () => {
    const circle: SceneObject = { ...base, id: 'host', type: 'circle', center: { x: 3, y: 1 }, radius: 2 };
    const point: SceneObject = { ...base, type: 'point', position: { x: 99, y: 99 }, binding: { objectId: 'host', t: 0 } };
    const svg = render(point, [circle, point]);
    expect(svg).toContain('cx="240"');
    expect(svg).toContain('cy="-48"');
  });
  it('renders an arc as an open SVG curve and a sector as a closed region', () => {
    const arc: SceneObject = { ...base, type: 'arc', center: { x: 0, y: 0 }, radius: 1, startAngle: 0, sweepAngle: 90 };
    expect(render(arc)).toContain('d="M 48 0 A 48 48 0 0 0 0 -48"');
    expect(render({ ...arc, type: 'sector' })).toContain('d="M 0 0 L 48 0 A 48 48 0 0 0 0 -48 Z"');
  });
  it('keeps a rational graph disconnected at its asymptote', () => {
    const plot: SceneObject = { ...base, type: 'plot', mode: 'cartesian', expression: '1/x', xExpression: '', xMin: -2, xMax: 2, parameters: {} };
    const svg = render(plot);
    expect((svg.match(/M /g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(svg).not.toContain('NaN');
  });
  it('shows the arrow tips of an imported arc', () => {
    const imported = parseTikz('\\begin{tikzpicture}\\draw[<->] (1,0) arc[start angle=0,end angle=90,radius=1];\\end{tikzpicture}');
    const arc = imported.scene.objects.find(object => object.type === 'arc');
    if (!arc) throw new Error('Expected editable arc');
    const svg = render(arc);
    expect(svg).toContain(`marker-start="url(#arrow-${arc.id})"`);
    expect(svg).toContain(`marker-end="url(#arrow-${arc.id})"`);
  });
  it('shows the arrow tips configured on a graph', () => {
    const plot: SceneObject = { ...base, type: 'plot', mode: 'cartesian', expression: 'x', xExpression: '', xMin: -2, xMax: 2, parameters: {}, style: { ...base.style, arrows: 'end' } };
    expect(render(plot)).toContain('marker-end="url(#arrow-shape)"');
  });
  it.each(['point', 'line', 'circle'] as const)('hides an undefined graph-bound %s and restores it when the formula recovers', type => {
    const host: SceneObject = { ...base, id: 'host', type: 'plot', mode: 'cartesian', expression: '1/x', xExpression: '', xMin: -2, xMax: 2, parameters: {} };
    const point: SceneObject = { ...base, id: 'point', type: 'point', position: { x: 99, y: 99 }, binding: { objectId: 'host', t: .5 } };
    const reference = { x: 99, y: 99, pointId: point.id };
    const object: SceneObject = type === 'point' ? point : type === 'line' ? { ...base, type, points: [reference, { x: 1, y: 1 }] } : { ...base, type, center: reference, radius: 1 };
    const objects = type === 'point' ? [host, point] : [host, point, object];
    expect(render(object, objects)).toBe('<svg></svg>');
    const recoveredHost = { ...host, expression: 'x' };
    expect(render(object, objects.map(item => item.id === host.id ? recoveredHost : item))).toContain(`data-object-id="${object.id}"`);
  });
});
