import { describe, expect, it } from 'vitest';
import { isObjectDefined } from './defined';
import { DEFAULT_STYLE, emptyScene, type PlotObject, type PointObject, type SceneObject } from './types';
import { generateTikz } from '../tikz/generator';
import { parseTikz } from '../tikz/parser';

const base = (id: string) => ({ id, name: id, visible: true, locked: false, style: { ...DEFAULT_STYLE } });
const graph = (): PlotObject => ({ ...base('g'), type: 'plot', mode: 'cartesian', expression: 'sqrt(a-x)', xExpression: 't', xMin: 0, xMax: 2, parameters: { a: 2 } });
const point = (): PointObject => ({ ...base('p'), type: 'point', position: { x: 1, y: 1 }, binding: { objectId: 'g', t: .5 } });
const line = (): SceneObject => ({ ...base('l'), type: 'line', points: [{ x: 1, y: 1, pointId: 'p' }, { x: 3, y: 2 }] });
const circle = (): SceneObject => ({ ...base('c'), type: 'circle', center: { x: 1, y: 1, pointId: 'p' }, radius: 1 });

describe('undefined dynamic geometry', () => {
  it('propagates undefined graph positions to points and every dependent object, then recovers', () => {
    const g = graph(), p = point(), l = line(), c = circle();
    const q: PointObject = { ...base('q'), type: 'point', position: { x: 2, y: 1 }, binding: { objectId: 'c', t: 0 } };
    const label: SceneObject = { ...base('label'), type: 'text', position: { x: 2, y: 1, pointId: 'q' }, text: 'Q', fontSize: 12 };
    const objects = [g, p, l, c, q, label], original = structuredClone(p);
    expect(objects.every(o => isObjectDefined(o, objects))).toBe(true);
    g.parameters.a = 0;
    expect(objects.slice(1).map(o => isObjectDefined(o, objects))).toEqual([false, false, false, false, false]);
    expect(p).toEqual(original);
    g.parameters.a = 2;
    expect(objects.every(o => isObjectDefined(o, objects))).toBe(true);
  });
  it('keeps a mathematically valid point defined outside an empty plot display window', () => {
    const g: PlotObject = { ...graph(), expression: '100', yMin: -1, yMax: 1 }, p = point();
    expect(isObjectDefined(p, [g, p])).toBe(true);
  });
  it('rejects missing references and cycles without using fallback coordinates', () => {
    const p = point(), l = line();
    expect(isObjectDefined(p, [p])).toBe(false);
    expect(isObjectDefined(l, [l])).toBe(false);
    p.binding = { objectId: 'l', t: .5 };
    expect(isObjectDefined(p, [p, l])).toBe(false);
    expect(isObjectDefined(l, [p, l])).toBe(false);
  });
  it('keeps hidden construction hosts usable', () => {
    const g = { ...graph(), visible: false }, p = point();
    expect(isObjectDefined(p, [g, p])).toBe(true);
  });
  it('omits undefined declarations, markers, and stale source paths from TikZ without dropping stored objects', () => {
    const fresh = { ...emptyScene(), objects: [graph(), point(), line(), circle()] };
    const scene = parseTikz(generateTikz(fresh)).scene;
    const g = scene.objects.find(o => o.type === 'plot') as PlotObject;
    const p = scene.objects.find(o => o.type === 'point') as PointObject;
    p.binding = { objectId: g.id, t: .5 };
    const count = scene.objects.length;
    g.parameters.a = 0;
    const hidden = generateTikz(scene);
    expect(hidden).not.toContain('\\coordinate'); expect(hidden).not.toContain('\\filldraw'); expect(hidden).not.toContain('\\draw');
    expect(scene.objects).toHaveLength(count); expect(p.binding).toEqual({ objectId: g.id, t: .5 });
    g.parameters.a = 2;
    const recovered = generateTikz(scene);
    expect(recovered).toContain('\\coordinate'); expect(recovered).toContain('point-marker'); expect(recovered).toContain('circle[radius=1cm]');
  });
  it('omits completely empty plotted paths in new scenes and retains unsupported source islands', () => {
    const scene = { ...emptyScene(), objects: [{ ...graph(), expression: 'sqrt(-1)' }] };
    expect(generateTikz(scene)).not.toContain('\\draw');
    const raw = String.raw`\begin{tikzpicture}\draw[custom] (0,0)--(1,1);\end{tikzpicture}`;
    const imported = parseTikz(raw).scene;
    imported.objects.push({ ...graph(), expression: 'sqrt(-1)' });
    expect(generateTikz(imported)).toContain(String.raw`\draw[custom] (0,0)--(1,1);`);
  });
});
