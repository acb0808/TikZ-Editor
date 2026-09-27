import { describe, expect, it } from 'vitest';
import { boundsOf, duplicateObjects, moveHandle, objectAnchors, pathPoint, projectToPath, removeObjects, resolveAnchor, resolvePoint, splitCircle, translateObjects } from './geometry';
import { snapPoint } from './snapping';
import { validateProject } from './validation';
import { DEFAULT_SETTINGS, DEFAULT_STYLE, emptyScene, type ArcObject, type PathBinding, type PlotObject, type PointObject, type SceneObject, type Vec } from './types';

const base = (id: string) => ({ id, name: id, visible: true, locked: false, style: { ...DEFAULT_STYLE } });
const circle = (): SceneObject => ({ ...base('C'), type: 'circle', center: { x: 0, y: 0 }, radius: 2 });
const point = (binding: PathBinding): PointObject => ({ ...base('P'), type: 'point', position: { x: 9, y: 9 }, binding });
const arc = (): ArcObject => ({ ...base('A'), type: 'arc', center: { x: 0, y: 0 }, radius: 2, startAngle: 0, sweepAngle: 180 });
const plot = (): PlotObject => ({ ...base('F'), type: 'plot', mode: 'cartesian', expression: 'x^2', xExpression: 't', xMin: -2, xMax: 2, parameters: {} });
const line = (id = 'L', a: Vec = { x: -3, y: 0 }, b: Vec = { x: 3, y: 0 }): SceneObject => ({ ...base(id), type: 'line', points: [a, b] });
function near(actual: Vec | null, expected: Vec) { expect(actual).not.toBeNull(); expect(actual!.x).toBeCloseTo(expected.x, 7); expect(actual!.y).toBeCloseTo(expected.y, 7); }
function project(objects: SceneObject[]) { return { version: '1.0', scene: { ...emptyScene(), objects }, viewport: { x: 0, y: 0, zoom: 1 } }; }

describe('points constrained to paths', () => {
  it('resolves a circular bound point through an ordinary point reference', () => {
    const p = point({ objectId: 'C', t: 0.25 });
    near(resolveAnchor({ x: 8, y: 8, pointId: 'P' }, [circle(), p]), { x: 0, y: 2 });
  });
  it('evaluates line, polygon, circle, arc and plot normalized parameters', () => {
    const polygon: SceneObject = { ...base('G'), type: 'polygon', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }] };
    const objects = [line(), polygon, circle(), arc(), plot()];
    near(pathPoint({ objectId: 'L', t: 0.25 }, objects), { x: -1.5, y: 0 });
    near(pathPoint({ objectId: 'G', segment: 2, t: 0.5 }, objects), { x: 0, y: 2 });
    near(pathPoint({ objectId: 'A', t: 0.5 }, objects), { x: 0, y: 2 });
    near(pathPoint({ objectId: 'F', t: 0.75 }, objects), { x: 1, y: 1 });
  });
  it('projects to finite segments, clockwise arcs and graph samples', () => {
    const a = { ...arc(), startAngle: 90, sweepAngle: -90 };
    near(projectToPath({ x: 8, y: 1 }, line(), [])?.point ?? null, { x: 3, y: 0 });
    near(projectToPath({ x: -2, y: 0 }, a, [])?.point ?? null, { x: 0, y: 2 });
    const projection = projectToPath({ x: 1, y: 1 }, plot(), []);
    expect(projection).not.toBeNull(); expect(projection!.point.x).toBeCloseTo(1, 3); expect(projection!.point.y).toBeCloseTo(1, 3);
  });
  it('keeps a dragged bound point on its original host', () => {
    const p = point({ objectId: 'C', t: 0 });
    const moved = moveHandle([circle(), p], 'P', 0, { x: 0, y: 8 });
    const result = moved[1] as PointObject;
    expect(result.binding?.objectId).toBe('C'); expect(result.binding?.t).toBeCloseTo(0.25);
    near(resolvePoint(result, moved), { x: 0, y: 2 });
  });
  it('does not double translate a host and its selected bound point', () => {
    const p = point({ objectId: 'C', t: 0.25 });
    const moved = translateObjects([circle(), p], ['C', 'P'], { x: 2, y: 3 });
    near(resolvePoint(moved[1] as PointObject, moved), { x: 2, y: 5 });
  });
  it('freezes the current resolved position when deleting a host', () => {
    const p = point({ objectId: 'C', t: 0.25 });
    const remaining = removeObjects([circle(), p], ['C']);
    expect((remaining[0] as PointObject).binding).toBeUndefined(); near((remaining[0] as PointObject).position, { x: 0, y: 2 });
  });
  it('remaps selected host bindings and detaches external host bindings on copy', () => {
    const objects = [circle(), point({ objectId: 'C', t: 0.25 })];
    const copies = duplicateObjects(objects, ['C', 'P'], { x: 3, y: 4 });
    expect((copies[1] as PointObject).binding?.objectId).toBe(copies[0].id);
    near(resolvePoint(copies[1] as PointObject, copies), { x: 3, y: 6 });
    const detached = duplicateObjects(objects, ['P'], { x: 3, y: 4 })[0] as PointObject;
    expect(detached.binding).toBeUndefined(); near(detached.position, { x: 3, y: 6 });
  });
  it('moves and duplicates a graph with its bound point using an offset', () => {
    const graph = { ...plot(), offset: { x: 2, y: -1 } }, p = point({ objectId: 'F', t: 0.75 });
    const moved = translateObjects([graph, p], ['F', 'P'], { x: 3, y: 4 });
    near(resolvePoint(moved[1] as PointObject, moved), { x: 6, y: 4 });
    const copies = duplicateObjects([graph, p], ['F', 'P'], { x: 3, y: 4 });
    near(resolvePoint(copies[1] as PointObject, copies), { x: 6, y: 4 });
    expect(validateProject(project(copies)).scene.objects).toEqual(copies);
  });
  it('projects and preserves a point on a later polyline segment', () => {
    const polyline: SceneObject = { ...base('L'), type: 'line', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }] };
    const projected = projectToPath({ x: 4.1, y: 2 }, polyline, [polyline])!;
    expect(projected.binding).toEqual({ objectId: 'L', t: 0.5, segment: 1 });
    near(pathPoint(projected.binding, [polyline]), { x: 4, y: 2 });
    expect(() => validateProject(project([polyline, point(projected.binding)]))).not.toThrow();
  });
  it('can project to a narrow visible portion of a steep Cartesian graph', () => {
    const graph = { ...plot(), expression: '1000*(x-0.12345)', xMin: -5, xMax: 5, yMin: -1, yMax: 1 };
    const projected = projectToPath({ x: 0.12345, y: 0 }, graph, [graph]);
    near(projected?.point ?? null, { x: 0.12345, y: 0 });
  });
  it('binds points to either straight edge of a sector', () => {
    const sector: ArcObject = { ...arc(), type: 'sector', sweepAngle: 90 };
    const start = projectToPath({ x: 1, y: 0.05 }, sector, [sector])!;
    const end = projectToPath({ x: 0.05, y: 1 }, sector, [sector])!;
    expect(start.binding).toEqual({ objectId: 'A', t: 0.5, segment: 0 });
    expect(end.binding.segment).toBe(1);
    near(pathPoint(start.binding, [sector]), { x: 1, y: 0 });
    near(pathPoint(end.binding, [sector]), { x: 0, y: 1 });
    expect(() => validateProject(project([sector, point(start.binding)]))).not.toThrow();
  });
  it('returns finite fallbacks for malformed cyclic live references', () => {
    const p = point({ objectId: 'C', t: 0.25 });
    const c = circle(); if (c.type === 'circle') c.center.pointId = 'P';
    near(resolvePoint(p, [p, c]), p.position);
  });
  it('refuses a handle attachment that would make its own bound point the host center', () => {
    const objects = [circle(), point({ objectId: 'C', t: 0.25 })];
    const moved = moveHandle(objects, 'C', 0, { x: 0, y: 2, pointId: 'P' });
    expect((moved[0] as Extract<SceneObject, { type: 'circle' }>).center.pointId).toBeUndefined();
    expect(() => validateProject(project(moved))).not.toThrow();
  });
});

describe('circle cutting and arc geometry', () => {
  it('splits a circle into two complementary arcs and remaps bound points without jumps', () => {
    const top = point({ objectId: 'C', t: 0.25 });
    const bottom = { ...point({ objectId: 'C', t: 0.75 }), id: 'Q' };
    const split = splitCircle([circle(), top, bottom], 'C', 0, 180);
    const arcs = split.filter(o => o.type === 'arc');
    expect(arcs).toHaveLength(2); expect(arcs[0].id).toBe('C');
    expect(arcs.map(o => o.type === 'arc' && o.sweepAngle)).toEqual([180, 180]);
    near(resolvePoint(split.find(o => o.id === 'P') as PointObject, split), { x: 0, y: 2 });
    near(resolvePoint(split.find(o => o.id === 'Q') as PointObject, split), { x: 0, y: -2 });
    expect((split.find(o => o.id === 'Q') as PointObject).binding?.objectId).toBe(arcs[1].id);
    const remaining = removeObjects(split, [arcs[1].id]);
    expect((remaining.find(o => o.id === 'Q') as PointObject).binding).toBeUndefined();
    near(resolvePoint(remaining.find(o => o.id === 'Q') as PointObject, remaining), { x: 0, y: -2 });
  });
  it('rejects coincident cut points and respects locked circles', () => {
    const c = circle(); expect(splitCircle([c], 'C', 0, 360)).toEqual([c]);
    const locked = { ...c, locked: true }; expect(splitCircle([locked], 'C', 0, 90)).toEqual([locked]);
  });
  it('uses center/start/end handles and includes intermediate extrema in bounds', () => {
    const a = { ...arc(), startAngle: 30, sweepAngle: 120 };
    const handles = objectAnchors(a, [a]); expect(handles).toHaveLength(3);
    near(handles[1], { x: Math.sqrt(3), y: 1 });
    const bounds = boundsOf([a])!;
    expect(bounds.minX).toBeCloseTo(-Math.sqrt(3)); expect(bounds.maxY).toBeCloseTo(2); expect(bounds.minY).toBeCloseTo(1);
    expect(boundsOf([{ ...a, type: 'sector' }])!.minY).toBeCloseTo(0);
  });
});

describe('path and intersection snapping', () => {
  const viewport = { x: 0, y: 0, zoom: 1 }, settings = { ...DEFAULT_SETTINGS, grid: false };
  it('provides a binding when snapping to a circular path', () => {
    const snap = snapPoint({ x: 1.42, y: 1.42 }, [circle()], viewport, settings);
    expect(snap.kind).toBe('path'); expect(snap.binding?.objectId).toBe('C'); expect(snap.binding?.t).toBeCloseTo(0.125);
  });
  it('finds line-line, line-circle and circle-circle intersections', () => {
    const diagonal = line('D', { x: -1, y: -2 }, { x: 1, y: 2 });
    expect(snapPoint({ x: 0.02, y: 0.01 }, [line(), diagonal], viewport, settings).kind).toBe('intersection');
    const cutting = line('V', { x: 1, y: -4 }, { x: 1, y: 4 });
    const lc = snapPoint({ x: 1.02, y: Math.sqrt(3) }, [circle(), cutting], viewport, settings);
    expect(lc.kind).toBe('intersection'); near(lc.point, { x: 1, y: Math.sqrt(3) });
    const other = { ...circle(), id: 'D' }; if (other.type === 'circle') other.center.x = 2;
    const cc = snapPoint({ x: 1.02, y: Math.sqrt(3) }, [circle(), other], viewport, settings);
    expect(cc.kind).toBe('intersection'); near(cc.point, { x: 1, y: Math.sqrt(3) });
  });
  it('never offers a binding to a host that transitively depends on the moving point', () => {
    const p: PointObject = { ...base('P'), type: 'point', position: { x: 0, y: 0 } };
    const c = circle(); if (c.type === 'circle') c.center.pointId = 'P';
    expect(snapPoint({ x: 1.42, y: 1.42 }, [p, c], viewport, settings, ['P']).kind).toBe('none');
  });
  it('does not snap to a bound point where the graph is undefined', () => {
    const graph = { ...plot(), expression: '1/x' }, p = point({ objectId: 'F', t: 0.5 });
    expect(pathPoint(p.binding!, [graph, p])).toBeNull();
    expect(snapPoint({ x: 9, y: 9 }, [graph, p], viewport, settings).kind).toBe('none');
  });
  it('omits undefined point dependents from snapping and fit bounds', () => {
    const graph = { ...plot(), expression: '1/x' }, p = point({ objectId: 'F', t: 0.5 });
    const dependent: SceneObject = { ...base('L'), type: 'line', points: [{ x: 9, y: 9, pointId: 'P' }, { x: 12, y: 9 }] };
    const objects = [graph, p, dependent];
    expect(snapPoint({ x: 12, y: 9 }, objects, viewport, settings).kind).toBe('none');
    expect(boundsOf([p, dependent], objects)).toBeNull();
  });
  it('excludes transitive point descendants when moving a host handle', () => {
    const p = point({ objectId: 'C', t: 0.25 });
    const l: SceneObject = { ...base('L'), type: 'line', points: [{ x: 0, y: 2, pointId: 'P' }, { x: 4, y: 4 }] };
    const q = { ...point({ objectId: 'L', t: 0.5 }), id: 'Q' };
    const objects = [circle(), p, l, q];
    expect(snapPoint({ x: 2, y: 3 }, objects, viewport, settings, ['C']).kind).toBe('none');
    const moved = moveHandle(objects, 'C', 0, { x: 2, y: 3, pointId: 'Q' });
    expect(() => validateProject(project(moved))).not.toThrow();
    expect(moved[0].type === 'circle' && moved[0].center.pointId).toBeUndefined();
  });
});

describe('extended project import validation', () => {
  it('preserves plots, arc geometry and valid normalized path bindings', () => {
    const input = project([circle(), point({ objectId: 'C', t: 0.25 }), arc(), plot()]);
    expect(validateProject(input)).toEqual(input);
  });
  it.each([
    ['missing host', { objectId: 'missing', t: 0.5 }],
    ['out of range parameter', { objectId: 'C', t: 2 }],
    ['nonfinite parameter', { objectId: 'C', t: Infinity }],
    ['invalid segment', { objectId: 'C', t: 0.5, segment: 99 }],
  ])('rejects %s', (_name, binding) => { expect(() => validateProject(project([circle(), point(binding)]))).toThrow(/[가-힣]/); });
  it('rejects cycles through a bound point and a host anchor', () => {
    const c = circle(); if (c.type === 'circle') c.center.pointId = 'P';
    expect(() => validateProject(project([c, point({ objectId: 'C', t: 0.25 })]))).toThrow(/순환/);
  });
  it('rejects invalid arc sweep, graph range and unsafe expressions', () => {
    expect(() => validateProject(project([{ ...arc(), sweepAngle: 361 }]))).toThrow(/[가-힣]/);
    expect(() => validateProject(project([{ ...plot(), xMax: -3 }]))).toThrow(/[가-힣]/);
    expect(() => validateProject(project([{ ...plot(), expression: 'globalThis.alert(1)' }]))).toThrow(/[가-힣]/);
  });
});
