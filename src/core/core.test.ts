import { describe, expect, it } from 'vitest';
import { BASE_SCALE, screenToWorld, worldToScreen, zoomAt } from './coordinates';
import { boundsOf, duplicateObjects, moveHandle, objectAnchors, removeObjects, resolveAnchor, translateObjects } from './geometry';
import { snapPoint } from './snapping';
import { applyChange, createChange } from './history';
import { validateProject } from './validation';
import { DEFAULT_SETTINGS, DEFAULT_STYLE, emptyScene, type Project, type SceneObject } from './types';

const base = (id: string) => ({ id, name: id, visible: true, locked: false, style: { ...DEFAULT_STYLE } });
const point = (id: string, x = 1, y = 2): SceneObject => ({ ...base(id), type: 'point', position: { x, y } });
const line = (): SceneObject => ({ ...base('line'), type: 'line', points: [{ x: 90, y: 90, pointId: 'A' }, { x: 4, y: 5 }] });
const project = (): Project => ({ version: '1.0', scene: { ...emptyScene(), objects: [point('A'), line()], source: [{ kind: 'object', objectId: 'A' }, { kind: 'object', objectId: 'line' }] }, viewport: { x: 300, y: 200, zoom: 1 } });

describe('world coordinates', () => {
  it('uses upward world y and 48 screen pixels per unit', () => {
    expect(BASE_SCALE).toBe(48);
    expect(worldToScreen({ x: 2, y: 3 }, { x: 100, y: 200, zoom: 2 })).toEqual({ x: 292, y: -88 });
  });
  it('round-trips fractional coordinates after pan and zoom', () => {
    const world = { x: -3.125, y: 7.875 };
    const viewport = { x: 715, y: -114, zoom: 0.35 };
    const result = screenToWorld(worldToScreen(world, viewport), viewport);
    expect(result.x).toBeCloseTo(world.x, 10);
    expect(result.y).toBeCloseTo(world.y, 10);
  });
  it('holds the world position under the cursor during zoom', () => {
    const viewport = { x: 80, y: 20, zoom: 0.8 };
    const cursor = { x: 441, y: 283 };
    expect(screenToWorld(cursor, zoomAt(viewport, cursor, 2))).toEqual(screenToWorld(cursor, viewport));
  });
});

describe('geometry with point references', () => {
  it('resolves a point reference and falls back for missing references', () => {
    expect(resolveAnchor({ x: 90, y: 90, pointId: 'A' }, [point('A')])).toEqual({ x: 1, y: 2 });
    expect(resolveAnchor({ x: 3, y: 4, pointId: 'missing' }, [])).toEqual({ x: 3, y: 4 });
  });
  it('returns path handles in vertex order and circle center plus radius handle', () => {
    expect(objectAnchors(line(), [point('A')])).toEqual([{ x: 1, y: 2 }, { x: 4, y: 5 }]);
    const circle: SceneObject = { ...base('circle'), type: 'circle', center: { x: 2, y: 3 }, radius: 2 };
    expect(objectAnchors(circle, [])).toEqual([{ x: 2, y: 3 }, { x: 4, y: 3 }]);
  });
  it('measures circle extents and resolves referenced path points', () => {
    const circle: SceneObject = { ...base('circle'), type: 'circle', center: { x: 0, y: 0 }, radius: 3 };
    expect(boundsOf([circle, line()], [circle, line(), point('A')])).toEqual({ minX: -3, minY: -3, maxX: 4, maxY: 5 });
    expect(boundsOf([])).toBeNull();
  });
  it('moves a referenced point and its selected path only once', () => {
    const input = [point('A'), line()];
    const moved = translateObjects(input, ['A', 'line'], { x: 2, y: -1 });
    expect(objectAnchors(moved[1], moved)).toEqual([{ x: 3, y: 1 }, { x: 6, y: 4 }]);
    expect(moved[1].type === 'line' && moved[1].points[0].pointId).toBe('A');
    expect(objectAnchors(input[1], input)[0]).toEqual({ x: 1, y: 2 });
  });
  it('detaches a path moved independently from an unselected referenced point', () => {
    const moved = translateObjects([point('A'), line()], ['line'], { x: 2, y: 0 });
    expect(objectAnchors(moved[1], moved)[0]).toEqual({ x: 3, y: 2 });
    expect(moved[1].type === 'line' && moved[1].points[0].pointId).toBeUndefined();
    expect(moved[0]).toEqual(point('A'));
  });
  it('moving a handle can attach it to another point', () => {
    const input = [point('A'), point('B', 7, 8), line()];
    const moved = moveHandle(input, 'line', 1, { x: 7, y: 8, pointId: 'B' });
    expect(objectAnchors(moved[2], moved)[1]).toEqual({ x: 7, y: 8 });
    expect(moved[2].type === 'line' && moved[2].points[1].pointId).toBe('B');
  });
  it('updates a circle radius by distance to its resolved center', () => {
    const circle: SceneObject = { ...base('circle'), type: 'circle', center: { x: 90, y: 90, pointId: 'A' }, radius: 1 };
    const moved = moveHandle([point('A'), circle], 'circle', 1, { x: 4, y: 6 });
    expect(moved[1].type === 'circle' && moved[1].radius).toBe(5);
  });
  it('freezes surviving references at their resolved position when deleting a point', () => {
    const result = removeObjects([point('A'), line()], ['A']);
    expect(result).toHaveLength(1);
    expect(result[0].type === 'line' && result[0].points[0]).toEqual({ x: 1, y: 2 });
  });
  it('duplicates only selected objects and remaps internal references', () => {
    const input = [point('A'), line(), point('unselected')];
    const copies = duplicateObjects(input, ['A', 'line'], { x: 1, y: 1 });
    expect(copies).toHaveLength(2);
    expect(new Set(copies.map(object => object.id)).size).toBe(2);
    expect(copies[0].id).not.toBe('A');
    expect(copies[1].type === 'line' && copies[1].points[0].pointId).toBe(copies[0].id);
    expect(objectAnchors(copies[1], copies)).toEqual([{ x: 2, y: 3 }, { x: 5, y: 6 }]);
  });
  it('detaches external references on duplication so the requested offset is preserved', () => {
    const copies = duplicateObjects([point('A'), line()], ['line'], { x: 1, y: 1 });
    expect(copies[0].type === 'line' && copies[0].points[0]).toEqual({ x: 2, y: 3 });
  });
  it('keeps a duplicated maximum-length name within the project limit', () => {
    const original = { ...point('A'), name: '가'.repeat(500) };
    const copies = duplicateObjects([original], ['A']);
    expect(copies[0].name).toBe(`${'가'.repeat(497)} 복사`);
    const input = project();
    input.scene.objects = copies;
    input.scene.source = [];
    expect(validateProject(input)).toEqual(input);
  });
  it('keeps locked objects unchanged while detaching a moved path from a locked point', () => {
    const lockedPoint = { ...point('A'), locked: true };
    const input = [lockedPoint, line()];
    const moved = translateObjects(input, ['A', 'line'], { x: 1, y: 0 });
    expect(moved[0]).toBe(lockedPoint);
    expect(moved[1].type === 'line' && moved[1].points[0]).toEqual({ x: 2, y: 2 });
    expect(removeObjects(input, ['A'])).toEqual(input);
    expect(moveHandle(input, 'A', 0, { x: 9, y: 9 })).toEqual(input);
  });
  it('keeps an unselected dependent circle centered on the moving point', () => {
    const circle: SceneObject = { ...base('circle'), type: 'circle', center: { x: 0, y: 0, pointId: 'A' }, radius: 2 };
    const result = translateObjects([point('A'), circle], ['A'], { x: 1, y: -1 });
    expect(objectAnchors(result[1], result)).toEqual([{ x: 2, y: 1 }, { x: 4, y: 1 }]);
  });
});

describe('screen-space snapping', () => {
  const viewport = { x: 0, y: 0, zoom: 1 };
  it('prefers a point reference over nearby endpoints and grid positions', () => {
    const result = snapPoint({ x: 1.02, y: 2.02 }, [point('A'), line()], viewport, DEFAULT_SETTINGS);
    expect(result).toEqual({ point: { x: 1, y: 2, pointId: 'A' }, kind: 'point' });
  });
  it('finds endpoints and midpoints of segments', () => {
    const path: SceneObject = { ...base('path'), type: 'line', points: [{ x: 0, y: 0 }, { x: 2, y: 0 }] };
    expect(snapPoint({ x: 2.1, y: 0 }, [path], viewport, DEFAULT_SETTINGS).kind).toBe('endpoint');
    expect(snapPoint({ x: 1.02, y: 0 }, [path], viewport, DEFAULT_SETTINGS)).toEqual({ point: { x: 1, y: 0 }, kind: 'midpoint', binding: { objectId: 'path', t: 0.5 } });
  });
  it('uses ten screen pixels of tolerance at any zoom', () => {
    const settings = { ...DEFAULT_SETTINGS, grid: false };
    expect(snapPoint({ x: 1.15, y: 2 }, [point('A')], viewport, settings).kind).toBe('point');
    expect(snapPoint({ x: 1.15, y: 2 }, [point('A')], { ...viewport, zoom: 2 }, settings).kind).toBe('none');
  });
  it('snaps to the grid only within tolerance and excludes hidden or excluded objects', () => {
    expect(snapPoint({ x: 3.03, y: 3.01 }, [], viewport, DEFAULT_SETTINGS).kind).toBe('grid');
    expect(snapPoint({ x: 3.25, y: 3.25 }, [], viewport, DEFAULT_SETTINGS).kind).toBe('none');
    expect(snapPoint({ x: 1.01, y: 2 }, [point('A')], viewport, { ...DEFAULT_SETTINGS, grid: false }, ['A']).kind).toBe('none');
    expect(snapPoint({ x: 1.01, y: 2 }, [{ ...point('A'), visible: false }], viewport, { ...DEFAULT_SETTINGS, grid: false }).kind).toBe('none');
  });
  it('disables all snapping when the setting is off', () => {
    expect(snapPoint({ x: 1.01, y: 2 }, [point('A')], viewport, { ...DEFAULT_SETTINGS, snap: false })).toEqual({ point: { x: 1.01, y: 2 }, kind: 'none' });
  });
  it('does not snap a moving point to dependent endpoints or midpoints', () => {
    const settings = { ...DEFAULT_SETTINGS, grid: false };
    const objects = [point('A'), line()];
    expect(snapPoint({ x: 1.01, y: 2 }, objects, viewport, settings, ['A']).kind).toBe('none');
    expect(snapPoint({ x: 2.51, y: 3.5 }, objects, viewport, settings, ['A']).kind).toBe('none');
    expect(snapPoint({ x: 4.01, y: 5 }, objects, viewport, settings, ['A']).kind).toBe('endpoint');
  });
  it('does not snap a moving point to a dependent circle center', () => {
    const circle: SceneObject = { ...base('circle'), type: 'circle', center: { x: 90, y: 90, pointId: 'A' }, radius: 2 };
    expect(snapPoint({ x: 1.01, y: 2 }, [point('A'), circle], viewport, { ...DEFAULT_SETTINGS, grid: false }, ['A']).kind).toBe('none');
  });
  it('includes a closing polygon edge midpoint and virtual rectangle corners', () => {
    const settings = { ...DEFAULT_SETTINGS, grid: false };
    const polygon: SceneObject = { ...base('polygon'), type: 'polygon', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }] };
    expect(snapPoint({ x: 0, y: 2.01 }, [polygon], viewport, settings)).toEqual({ point: { x: 0, y: 2 }, kind: 'midpoint', binding: { objectId: 'polygon', t: 0.5, segment: 2 } });
    const rectangle: SceneObject = { ...base('rectangle'), type: 'rectangle', points: [{ x: 0, y: 0 }, { x: 4, y: 4 }] };
    expect(snapPoint({ x: 4, y: 0.01 }, [rectangle], viewport, settings)).toEqual({ point: { x: 4, y: 0 }, kind: 'endpoint', binding: { objectId: 'rectangle', t: 1, segment: 0 } });
  });
});

describe('incremental scene history', () => {
  it('ignores no-op changes', () => {
    const scene = project().scene;
    expect(createChange(scene, structuredClone(scene), 'unchanged')).toBeNull();
  });
  it('stores only changed objects and round-trips an edit', () => {
    const before = project().scene;
    const after = { ...before, objects: translateObjects(before.objects, ['A'], { x: 2, y: 1 }) };
    const change = createChange(before, after, 'Move')!;
    expect(change.objects).toHaveLength(1);
    expect(change.order).toBeUndefined();
    expect(change.metadata).toBeUndefined();
    expect(applyChange(before, change, 'redo')).toEqual(after);
    expect(applyChange(after, change, 'undo')).toEqual(before);
  });
  it('restores deletion, order, settings and source islands in either direction', () => {
    const before = project().scene;
    const after = { ...before, objects: [before.objects[1]], source: [{ kind: 'raw' as const, raw: '% untouched\n' }], settings: { ...before.settings, grid: false } };
    const change = createChange(before, after, 'Delete')!;
    expect(change.order).toBeDefined();
    expect(change.metadata).toBeDefined();
    expect(applyChange(before, change, 'redo')).toEqual(after);
    expect(applyChange(after, change, 'undo')).toEqual(before);
  });
  it('retains snapshots even if the caller mutates an input later', () => {
    const before = project().scene;
    const after = { ...before, name: 'changed' };
    const change = createChange(before, after, 'Rename')!;
    after.name = 'mutated';
    expect(applyChange(before, change, 'redo').name).toBe('changed');
  });
  it('records additions and order-only changes without storing unrelated objects', () => {
    const before = project().scene;
    const after = { ...before, objects: [point('B'), ...[...before.objects].reverse()] };
    const change = createChange(before, after, 'Add')!;
    expect(change.objects).toHaveLength(1);
    expect(applyChange(before, change, 'redo')).toEqual(after);
    expect(applyChange(after, change, 'undo')).toEqual(before);
    const reorder = createChange(before, { ...before, objects: [...before.objects].reverse() }, 'Order')!;
    expect(reorder.objects).toHaveLength(0);
    expect(reorder.metadata).toBeUndefined();
  });
});

describe('untrusted project imports', () => {
  it('accepts a valid portable project and returns detached data', () => {
    const input = project();
    const output = validateProject(input);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
  });
  it.each([
    ['version', (p: Project) => { (p as { version: string }).version = '2.0'; }],
    ['finite coordinates', (p: Project) => { p.viewport.x = Infinity; }],
    ['coordinate bounds', (p: Project) => { p.viewport.x = 1e20; }],
    ['zoom', (p: Project) => { p.viewport.zoom = 0; }],
    ['grid', (p: Project) => { p.scene.settings.gridSize = 0; }],
    ['duplicate IDs', (p: Project) => { p.scene.objects.push(point('A')); }],
    ['missing point reference', (p: Project) => { p.scene.objects.shift(); p.scene.source.shift(); }],
    ['non-point reference', (p: Project) => { const object = p.scene.objects[1]; if ('points' in object) object.points[0].pointId = 'line'; }],
    ['invalid paint', (p: Project) => { p.scene.objects[0].style.stroke = 'url(https://example.com/tracker.svg)'; }],
    ['negative stroke', (p: Project) => { p.scene.objects[0].style.strokeWidth = -1; }],
    ['opacity', (p: Project) => { p.scene.objects[0].style.opacity = 2; }],
    ['invalid enum', (p: Project) => { (p.scene.objects[0].style as { dash: string }).dash = 'bad'; }],
    ['point count', (p: Project) => { const object = p.scene.objects[1]; if ('points' in object) object.points = []; }],
    ['source references', (p: Project) => { p.scene.source.push({ kind: 'object', objectId: 'missing' }); }],
  ])('rejects %s with a readable error', (_label, mutate) => {
    const input = project();
    mutate(input);
    expect(() => validateProject(input)).toThrow(/[가-힣]/);
  });
  it('rejects malformed objects and excessive object count', () => {
    expect(() => validateProject(null)).toThrow(/[가-힣]/);
    const input = project();
    input.scene.objects = Array.from({ length: 10001 }, (_, i) => point(`p${i}`));
    expect(() => validateProject(input)).toThrow(/개수|많|한도/);
  });
  it('validates circle radius, text font size and polygon vertex count', () => {
    const input = project();
    input.scene.objects.push({ ...base('circle'), type: 'circle', center: { x: 0, y: 0 }, radius: -1 });
    expect(() => validateProject(input)).toThrow(/반지름/);
    input.scene.objects[2] = { ...base('text'), type: 'text', position: { x: 0, y: 0 }, text: 'x', fontSize: 0 };
    expect(() => validateProject(input)).toThrow(/글자|크기/);
    input.scene.objects[2] = { ...base('polygon'), type: 'polygon', points: [{ x: 0, y: 0 }] };
    expect(() => validateProject(input)).toThrow(/점|꼭짓점/);
  });
  it('rejects malformed style, anchors, source lines and overlong text', () => {
    const input = project() as unknown as { scene: { objects: Record<string, unknown>[]; source: unknown[] } };
    input.scene.objects[0].style = null;
    expect(() => validateProject(input)).toThrow(/스타일/);
    input.scene.objects[0].style = DEFAULT_STYLE;
    input.scene.objects[0].position = { x: 1, y: NaN };
    expect(() => validateProject(input)).toThrow(/유한한/);
    input.scene.objects[0].position = { x: 1, y: 2 };
    input.scene.source = [{ kind: 'raw', raw: '% comment', line: 1.5 }];
    expect(() => validateProject(input)).toThrow(/정수/);
    input.scene.source = [{ kind: 'raw', raw: 'x'.repeat(5_000_001) }];
    expect(() => validateProject(input)).toThrow(/길이|한도/);
  });
  it('enforces the total UTF-8 text budget across source islands', () => {
    const input = project();
    input.scene.source = [{ kind: 'raw', raw: '수'.repeat(900_000) }, { kind: 'raw', raw: '학'.repeat(900_000) }];
    expect(() => validateProject(input)).toThrow(/5MB|한도/);
  });
  it('rejects stale source IDs after deletion and accepts explicitly cleaned source', () => {
    const input = project();
    input.scene.objects = removeObjects(input.scene.objects, ['A']);
    expect(() => validateProject(input)).toThrow(/원본 코드/);
    input.scene.source = input.scene.source.filter(entry => entry.kind === 'raw' || input.scene.objects.some(object => object.id === entry.objectId));
    expect(validateProject(input)).toEqual(input);
  });
  it.each(['red', 'transparent', '#fff', '#ffff', '#ffffff80'])('rejects %s paint that the canonical style/export model cannot represent', (paint) => {
    const input = project();
    input.scene.objects[0].style.stroke = paint;
    expect(() => validateProject(input)).toThrow(/색상/);
  });
});

describe('point declaration import metadata', () => {
  function declarationProject() {
    const input = project();
    const declaration = { kind: 'raw' as const, raw: String.raw`\coordinate (A) at (1,2);`, reason: 'point-declaration', pointDeclaration: { objectId: 'A', name: 'A', position: { x: 1, y: 2 } } };
    input.scene.source.unshift(declaration);
    return { input, declaration };
  }
  it('keeps a validated declaration independently from its visual point marker', () => {
    const { input } = declarationProject();
    expect(validateProject(input)).toEqual(input);
  });
  it('accepts a moved or renamed point while preserving its original declaration snapshot', () => {
    const { input } = declarationProject();
    input.scene.objects = translateObjects(input.scene.objects, ['A'], { x: 5, y: 0 });
    input.scene.objects[0].name = 'display name';
    expect(validateProject(input)).toEqual(input);
  });
  it('accepts literal dimensions and comments in a declaration', () => {
    const { input, declaration } = declarationProject();
    declaration.raw = '\\coordinate (A) % keep this comment\n at (10mm,2cm);';
    expect(validateProject(input)).toEqual(input);
  });
  it.each([
    ['missing point', (d: ReturnType<typeof declarationProject>['declaration']) => { d.pointDeclaration.objectId = 'missing'; }],
    ['non-point target', (d: ReturnType<typeof declarationProject>['declaration']) => { d.pointDeclaration.objectId = 'line'; }],
    ['unsafe name', (d: ReturnType<typeof declarationProject>['declaration']) => { d.pointDeclaration.name = String.raw`A) \input{file}`; }],
    ['mismatched name', (d: ReturnType<typeof declarationProject>['declaration']) => { d.pointDeclaration.name = 'B'; }],
    ['mismatched snapshot', (d: ReturnType<typeof declarationProject>['declaration']) => { d.pointDeclaration.position.x = 3; }],
    ['nonfinite position', (d: ReturnType<typeof declarationProject>['declaration']) => { d.pointDeclaration.position.x = NaN; }],
    ['extra statement', (d: ReturnType<typeof declarationProject>['declaration']) => { d.raw += String.raw` \draw (0,0)--(1,1);`; }],
    ['not a declaration', (d: ReturnType<typeof declarationProject>['declaration']) => { d.raw = '% just a comment'; }],
  ])('rejects %s metadata', (_name, mutate) => {
    const { input, declaration } = declarationProject();
    mutate(declaration);
    expect(() => validateProject(input)).toThrow(/[가-힣]/);
  });
  it('rejects duplicate point declarations and reused TeX names', () => {
    const { input, declaration } = declarationProject();
    input.scene.source.push(structuredClone(declaration));
    expect(() => validateProject(input)).toThrow(/중복/);
    input.scene.source.pop();
    input.scene.objects.push(point('B'));
    input.scene.source.push({ ...structuredClone(declaration), pointDeclaration: { ...declaration.pointDeclaration, objectId: 'B' } });
    expect(() => validateProject(input)).toThrow(/중복/);
  });
});
