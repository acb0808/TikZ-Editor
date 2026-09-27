import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, type PlotObject } from './types';
import { compileExpression, evaluatePlot, samplePlot, validatePlotExpression } from './plot';

const plot = (expression = 'x^2', changes: Partial<PlotObject> = {}): PlotObject => ({ id: 'f', name: 'f', type: 'plot', visible: true, locked: false, style: { ...DEFAULT_STYLE }, mode: 'cartesian', expression, xExpression: 'cos(t)', xMin: -5, xMax: 5, parameters: { a: 1, b: 0, c: 0 }, ...changes });

describe('safe mathematical expressions', () => {
  it.each([
    ['2x+3', { x: 4 }, 11], ['2sin(pi/2)', {}, 2], ['(x+1)(x-1)', { x: 3 }, 8],
    ['-x^2', { x: 3 }, -9], ['2^3^2', {}, 512], ['2^-2', {}, .25],
    ['f(x)=a*x^2+b*x+c', { x: 2, a: 3, b: 4, c: 5 }, 25], ['y=sin(π/2)+ln(e)', {}, 2],
    ['sqrt(9)+abs(-2)+log(100)', {}, 7], ['1e-3+2e', {}, .001 + 2 * Math.E],
    ['x²+x³', { x: 2 }, 12],
  ] as const)('evaluates %s with mathematical precedence', (expression, vars, expected) => {
    expect(compileExpression(expression)(vars)).toBeCloseTo(expected, 10);
  });
  it.each(['window.alert(1)', 'globalThis', 'x.constructor', 'new Function(1)', 'x;alert(1)', '__proto__', 'sin()', 'sqrt(1,2)', 'foo(x)', 'x+'])('rejects unsafe or invalid input %s', expression => {
    expect(() => compileExpression(expression)).toThrow();
  });
  it('rejects excessive nesting and size before evaluation', () => {
    expect(() => compileExpression('('.repeat(100) + 'x' + ')'.repeat(100))).toThrow();
    expect(() => compileExpression('x+'.repeat(1000) + '1')).toThrow();
  });
  it('treats real-domain failures and infinity as undefined', () => {
    expect(compileExpression('sqrt(-1)')({})).toBeNaN();
    expect(compileExpression('1/x')({ x: 0 })).toBeNaN();
    expect(compileExpression('exp(10000)')({})).toBeNaN();
    expect(compileExpression('1/(1/x)')({ x: 0 })).toBeNaN();
    expect(compileExpression('pow(sqrt(-1),0)')({})).toBeNaN();
  });
});

describe('plot evaluation and sampling', () => {
  it('evaluates cartesian, parametric and polar modes in radians', () => {
    expect(evaluatePlot(plot('a*x^2', { parameters: { a: 2 } }), 3)).toEqual({ x: 3, y: 18 });
    const parametric = evaluatePlot(plot('sin(t)', { mode: 'parametric', xExpression: 'cos(t)' }), Math.PI / 2);
    expect(parametric?.x).toBeCloseTo(0, 10); expect(parametric?.y).toBeCloseTo(1, 10);
    const polar = evaluatePlot(plot('2', { mode: 'polar' }), Math.PI / 2);
    expect(polar?.x).toBeCloseTo(0, 10); expect(polar?.y).toBeCloseTo(2, 10);
  });
  it('validates expression, parameter values, and domain without executing code', () => {
    expect(validatePlotExpression(plot('x+'))).toBeTypeOf('string');
    expect(validatePlotExpression(plot('x', { xMin: 2, xMax: 1 }))).toBeTypeOf('string');
    expect(validatePlotExpression(plot('a*x', { parameters: { a: Infinity } }))).toBeTypeOf('string');
    expect(validatePlotExpression(plot('1/x'))).toBeNull();
    expect(validatePlotExpression(plot('z*x'))).toContain('z');
    expect(validatePlotExpression(plot('z*x', { parameters: { z: 3 } }))).toBeNull();
  });
  it('samples finite continuous curves and never joins across domain holes', () => {
    const continuous = samplePlot(plot('x^2'));
    expect(continuous).toHaveLength(1);
    expect(continuous[0].length).toBeGreaterThan(100);
    const root = samplePlot(plot('sqrt(x)', { xMin: -2, xMax: 2 }));
    expect(root.flat().every(p => p.x >= 0 && Number.isFinite(p.y))).toBe(true);
    expect(root.flat().length).toBeGreaterThan(20);
  });
  it.each([['1/x', 0], ['1/(x-0.12345)', .12345], ['tan(x)', Math.PI / 2]] as const)('splits %s at its asymptote', (expression, pole) => {
    const segments = samplePlot(plot(expression, { xMin: -2.07, xMax: 2.13 }));
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every(segment => !segment.some((point, index) => index > 0 && segment[index - 1].x < pole && point.x > pole))).toBe(true);
  });
  it('bounds sampling work, caches unchanged expressions, and invalidates changed parameters', () => {
    expect(compileExpression('sin(x)')).toBe(compileExpression('sin(x)'));
    const p = plot('a*sin(100x)');
    const first = samplePlot(p);
    expect(first.flat().length).toBeLessThanOrEqual(4096);
    expect(samplePlot(p)).toBe(first);
    expect(samplePlot({ ...p, parameters: { a: 2 } })).not.toBe(first);
  });
  it('clips only the display samples to the y window before translation', () => {
    const graph = plot('1/x', { offset: { x: 3, y: 4 }, yMin: -2, yMax: 2 });
    expect(evaluatePlot(graph, .1)?.y).toBe(14);
    const segments = samplePlot(graph);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.flat().every(p => p.y >= 2 - 1e-9 && p.y <= 6 + 1e-9)).toBe(true);
    expect(segments.flat().some(p => Math.abs(p.y - 6) < 1e-9)).toBe(true);
    expect(samplePlot({ ...graph, yMax: 3 })).not.toBe(segments);
    expect(validatePlotExpression({ ...graph, yMax: -3 })).toBeTypeOf('string');
  });
  it('uses the same curve detail after a translation', () => {
    const graph = plot('sin(100x)', { xMin: -1, xMax: 1 });
    const original = samplePlot(graph), moved = samplePlot({ ...graph, offset: { x: 200, y: 300 } });
    expect(moved.map(segment => segment.length)).toEqual(original.map(segment => segment.length));
    expect(moved[0][20].y - original[0][20].y).toBeCloseTo(300, 8);
  });
});
