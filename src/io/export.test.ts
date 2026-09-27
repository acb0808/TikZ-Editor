import { describe, expect, it } from 'vitest';
import { renderSceneSvg } from './export';
import { DEFAULT_STYLE, emptyScene, type SceneObject } from '../core/types';
describe('vector export', () => {
  it('omits undefined dependent math without attempting to typeset its stale label', async () => {
    const base = { name: '도형', visible: true, locked: false, style: DEFAULT_STYLE };
    const objects: SceneObject[] = [
      { ...base, id: 'plot', type: 'plot', mode: 'cartesian', expression: 'sqrt(a-x)', xExpression: 't', xMin: 0, xMax: 2, parameters: { a: 0 } },
      { ...base, id: 'bound', type: 'point', position: { x: 1, y: 1 }, binding: { objectId: 'plot', t: .5 } },
      { ...base, id: 'label', type: 'math', position: { x: 1, y: 1, pointId: 'bound' }, text: '\\badcommand{', fontSize: 12 },
      { ...base, id: 'visible', type: 'circle', center: { x: 0, y: 0 }, radius: 1 },
    ];
    const svg = await renderSceneSvg({ ...emptyScene(), objects });
    expect(svg).toContain('data-object-id="visible"'); expect(svg).not.toContain('badcommand'); expect(svg).not.toContain('data-object-id="bound"');
  });
  it('exports visible geometry with escaped text and no editor controls', async () => {
    const svg = await renderSceneSvg({ ...emptyScene(), objects: [{ id: 'label', type: 'text', name: 'label', visible: true, locked: false, style: DEFAULT_STYLE, position: { x: 0, y: 0 }, text: '<script>alert(1)</script>', fontSize: 12 }] });
    expect(svg).toContain('&lt;script&gt;'); expect(svg).not.toContain('<script>'); expect(svg).not.toContain('handle-');
  });
  it('renders mathematics as vector paths, including fractions', async () => {
    const svg = await renderSceneSvg({ ...emptyScene(), objects: [{ id: 'math', type: 'math', name: 'math', visible: true, locked: false, style: DEFAULT_STYLE, position: { x: 0, y: 0 }, text: '\\frac{a}{b}', fontSize: 18 }] });
    expect(svg).toContain('<path'); expect(svg).not.toContain('foreignObject'); expect(svg).not.toContain('data-math');
  });
  it('rejects an empty export and reports invalid math', async () => {
    await expect(renderSceneSvg(emptyScene())).rejects.toThrow();
    await expect(renderSceneSvg({ ...emptyScene(), objects: [{ id: 'math', type: 'math', name: 'math', visible: true, locked: false, style: DEFAULT_STYLE, position: { x: 0, y: 0 }, text: '\\badcommand{', fontSize: 18 }] })).rejects.toThrow();
  });
});
