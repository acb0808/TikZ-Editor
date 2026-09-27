import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, emptyScene, type SceneObject, type PlotObject } from '../core/types';
import { generateTikz, standaloneTex } from './generator';
import { parseTikz } from './parser';

const line = (id = 'edge'): SceneObject & { type: 'line' } => ({ id, name: '선', type: 'line', visible: true, locked: false, style: { ...DEFAULT_STYLE }, points: [{ x: 0, y: 0 }, { x: 2, y: 1 }] });
const point = (id = 'pointA'): SceneObject => ({ id, name: '점 A', type: 'point', visible: true, locked: false, style: { ...DEFAULT_STYLE, fill: '#ff0000' }, position: { x: 1, y: 2 } });

describe('TikZ subset and lossless editing', () => {
  it('imports supported shapes and preserves every unedited source character', () => {
    const code = String.raw`% original spacing
\begin{tikzpicture}
  \draw[blue, dashed, line width=1.5pt] (0,0) -- (2,1);
  \filldraw[fill=red,draw=black] (3,2) circle[radius=0.8cm];
\end{tikzpicture}`;
    const result = parseTikz(code);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.objects.map(o => o.type)).toEqual(['line', 'circle']);
    expect(generateTikz(result.scene)).toBe(code);
  });
  it('keeps unsupported paths, scoped transforms, comments, and their order', () => {
    const code = String.raw`\begin{tikzpicture}
% command-looking comment: \draw (9,9) -- (8,8);
\draw (0,0) -- (1,0);
\begin{scope}[shift={(5,2)}]
\draw (0,0) -- (1,1);
\end{scope}
\draw[unknown style={a,b}] (1,0) -- (2,0);
\draw (2,0) -- (3,0);
\end{tikzpicture}`;
    const result = parseTikz(code);
    expect(result.scene.objects).toHaveLength(2);
    expect(result.diagnostics.filter(d => d.severity === 'warning')).toHaveLength(2);
    expect(generateTikz(result.scene)).toBe(code);
    result.scene.objects[0].style.stroke = '#00ff00';
    const output = generateTikz(result.scene);
    expect(output).toContain(String.raw`\begin{scope}[shift={(5,2)}]`);
    expect(output).toContain(String.raw`\draw[unknown style={a,b}] (1,0) -- (2,0);`);
    expect(output.indexOf('unknown style')).toBeLessThan(output.indexOf('(3,0)'));
  });
  it('keeps named point references live after moving a point', () => {
    const result = parseTikz(String.raw`\begin{tikzpicture}
\coordinate (A) at (1,2);
\draw (A) -- (4,2);
\end{tikzpicture}`);
    expect(result.scene.objects).toHaveLength(2);
    const p = result.scene.objects[0];
    const edge = result.scene.objects[1];
    expect(p.type).toBe('point');
    expect(edge.type === 'line' && edge.points[0].pointId).toBe(p.id);
    if (p.type === 'point') p.position.x = 3;
    const code = generateTikz(result.scene);
    expect(code).toContain('(A) at (3,2)');
    expect(code).toContain(String.raw`\draw (A) -- (4,2);`);
    const back = parseTikz(code);
    expect(back.diagnostics).toEqual([]);
    expect(back.scene.objects[1].type === 'line' && back.scene.objects[1].points[0].x).toBe(3);
  });
  it('generates round-trippable coordinate and marker for a visible point', () => {
    const scene = emptyScene();
    const p = point();
    const edge = line();
    if (edge.type === 'line') edge.points[0] = { ...p.type === 'point' ? p.position : { x: 0, y: 0 }, pointId: p.id };
    scene.objects = [edge, p];
    const code = generateTikz(scene);
    const result = parseTikz(code);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.objects.map(o => o.type)).toEqual(['line', 'point']);
    expect(result.scene.objects[1].style.fill).toBe('#ff0000');
    expect(result.scene.objects[0].type === 'line' && result.scene.objects[0].points[0].pointId).toBe(result.scene.objects[1].id);
    expect(generateTikz(result.scene)).toBe(code);
  });
  it('appends new shapes inside an imported standalone document picture', () => {
    const code = String.raw`\documentclass{standalone}
\usepackage{tikz}
\begin{document}
\begin{tikzpicture}
\draw (0,0) -- (1,0);
\end{tikzpicture}
\end{document}`;
    const result = parseTikz(code);
    result.scene.objects.push({ ...line('new'), type: 'circle', center: { x: 4, y: 4 }, radius: 1 });
    const output = generateTikz(result.scene);
    expect(output.indexOf('circle')).toBeLessThan(output.indexOf(String.raw`\end{tikzpicture}`));
    expect(standaloneTex(result.scene).match(/\\documentclass/g)).toHaveLength(1);
  });
  it('escapes plain labels and preserves mathematical labels', () => {
    const scene = emptyScene();
    scene.objects = [
      { ...line('label'), type: 'text', position: { x: 0, y: 0 }, text: 'A & B_1 {x} 50% #1 \\ ok', fontSize: 12 },
      { ...line('math'), type: 'math', position: { x: 1, y: 1 }, text: String.raw`x^2+\frac{1}{2}`, fontSize: 14 },
    ];
    const code = generateTikz(scene);
    expect(code).toContain(String.raw`A \& B\_1 \{x\} 50\% \#1 \textbackslash{} ok`);
    const back = parseTikz(code);
    expect(back.diagnostics).toEqual([]);
    expect(back.scene.objects.map(o => (o.type === 'text' || o.type === 'math') && o.text)).toEqual(scene.objects.map(o => (o.type === 'text' || o.type === 'math') && o.text));
  });
  it('reports incomplete source as a hard error without dropping its text', () => {
    const code = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,1)
\node at (1,2) {unfinished;
\end{tikzpicture}`;
    const result = parseTikz(code);
    expect(result.diagnostics.some(d => d.severity === 'error')).toBe(true);
    expect(generateTikz(result.scene)).toBe(code);
  });
  it('does not invent positions for unresolved references or interpret inherited unknown transforms', () => {
    const missing = parseTikz(String.raw`\draw (missing) -- (2,3);`);
    expect(missing.scene.objects).toHaveLength(0);
    expect(missing.diagnostics[0]?.severity).toBe('warning');
    const transformed = String.raw`\begin{tikzpicture}[rotate=30]\draw (0,0) -- (1,1);\end{tikzpicture}`;
    const result = parseTikz(transformed);
    expect(result.scene.objects).toHaveLength(0);
    expect(generateTikz(result.scene)).toBe(transformed);
  });
  it('supports cm/mm dimensions, arrows, polygons, rectangles, and circles', () => {
    const code = String.raw`\draw[->,red] (0mm,10mm) -- (2cm,1cm);
\draw (0,0) -- (1,0) -- (0,1) -- cycle;
\draw (2,2) rectangle (3,3);
\draw (4,4) circle (5mm);`;
    const result = parseTikz(code);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.objects.map(o => o.type)).toEqual(['arrow', 'polygon', 'rectangle', 'circle']);
    expect(result.scene.objects[0].type === 'arrow' && result.scene.objects[0].points[0]).toMatchObject({ x: 0, y: 1 });
    expect(result.scene.objects[3].type === 'circle' && result.scene.objects[3].radius).toBe(.5);
  });
  it('never rewrites source hidden inside macro arguments as geometry', () => {
    const code = String.raw`\newcommand{\fake}{\draw (8,8) -- (9,9);}
\begin{tikzpicture}
\draw (0,0) -- (1,1);
\end{tikzpicture}`;
    const result = parseTikz(code);
    expect(result.scene.objects).toHaveLength(1);
    expect(generateTikz(result.scene)).toBe(code);
  });
  it('defines a newly connected point before an existing path uses it', () => {
    const result = parseTikz(String.raw`\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}`);
    const p = point('added');
    result.scene.objects.push(p);
    const edge = result.scene.objects[0];
    if (edge.type === 'line') edge.points[0].pointId = p.id;
    const back = parseTikz(generateTikz(result.scene));
    expect(back.diagnostics).toEqual([]);
    expect(back.scene.objects).toHaveLength(2);
  });
  it('keeps point declarations ahead of their uses when source layers are reordered', () => {
    const result = parseTikz(String.raw`\coordinate (A) at (1,1); \draw (A) -- (2,2);`);
    result.scene.objects.reverse();
    expect(parseTikz(generateTikz(result.scene)).diagnostics).toEqual([]);
  });
  it('keeps later references opaque after an unsupported coordinate redefinition', () => {
    const code = String.raw`\coordinate (A) at (1,1);\coordinate (A) at (3,3);\draw (A) -- (2,2);`;
    const result = parseTikz(code);
    expect(result.scene.objects).toHaveLength(1);
    expect(generateTikz(result.scene)).toBe(code);
  });
  it('adds objects before the end of a preserved picture with unsupported options', () => {
    const result = parseTikz(String.raw`\begin{tikzpicture}[rotate=30]\draw (0,0) -- (1,1);\end{tikzpicture}`);
    result.scene.objects.push({ ...line(), type: 'circle', center: { x: 3, y: 3 }, radius: 1 });
    const output = generateTikz(result.scene);
    expect(output.indexOf('circle')).toBeLessThan(output.indexOf(String.raw`\end{tikzpicture}`));
  });
  it('does not mistake a drawn node border for a text color', () => {
    const result = parseTikz(String.raw`\node[draw=red] at (0,0) {A};`);
    expect(result.scene.objects).toHaveLength(0);
    expect(result.diagnostics[0]?.severity).toBe('warning');
  });
  it('detects unmatched environments as hard syntax errors', () => {
    const result = parseTikz(String.raw`\begin{tikzpicture}\draw (0,0) -- (1,1);\end{scope}\end{tikzpicture}`);
    expect(result.diagnostics.some(d => d.severity === 'error')).toBe(true);
  });
  it('preserves nested and semicolon-containing labels without splitting commands', () => {
    const code = String.raw`\node at (1,1) {$\frac{a;b}{c}$}; \draw (0,0)--(1,1);`;
    const result = parseTikz(code);
    expect(result.scene.objects.map(o => o.type)).toEqual(['math', 'line']);
    expect(generateTikz(result.scene)).toBe(code);
  });
  it('does not move coordinate declarations when the imported source is untouched', () => {
    const code = String.raw`\draw (0,0)--(1,1);\coordinate (A) at (3,3);\draw (A)--(4,4);`;
    expect(generateTikz(parseTikz(code).scene)).toBe(code);
  });
  it('preserves empty imported source exactly', () => {
    expect(generateTikz(parseTikz('').scene)).toBe('');
  });
  it('does not project shapes whose global style was changed by the preamble', () => {
    const code = String.raw`\tikzset{every picture/.style={rotate=30}}
\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}`;
    const result = parseTikz(code);
    expect(result.scene.objects).toHaveLength(0);
    expect(result.diagnostics[0]?.severity).toBe('warning');
    expect(generateTikz(result.scene)).toBe(code);
  });
  it('declares points first but paints their markers in scene layer order', () => {
    const scene = emptyScene();
    const p = point();
    scene.objects = [{ ...line(), type: 'polygon', points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 2 }], style: { ...DEFAULT_STYLE, fill: '#ffffff' } }, p];
    const code = generateTikz(scene);
    expect(code.indexOf('coordinate')).toBeLessThan(code.indexOf('cycle'));
    expect(code.indexOf('cycle')).toBeLessThan(code.indexOf('point-marker'));
    const result = parseTikz(code);
    expect(result.scene.objects.map(o => o.type)).toEqual(['polygon', 'point']);
    expect(generateTikz(result.scene)).toBe(code);
    const moved = result.scene.objects[1];
    if (moved.type === 'point') moved.position = { x: 3, y: 4 };
    const changed = generateTikz(result.scene);
    expect(changed).toContain('at (3,4)');
    expect(changed.match(/\\coordinate/g)).toHaveLength(1);
    expect(changed.indexOf('cycle')).toBeLessThan(changed.indexOf('point-marker'));
  });
  it('avoids coordinate-name collisions when adding points to imported code', () => {
    const result = parseTikz(String.raw`\coordinate (pnew) at (0,0);\draw (pnew)--(1,1);`);
    result.scene.objects.push(point('new'));
    const back = parseTikz(generateTikz(result.scene));
    expect(back.diagnostics).toEqual([]);
    expect(back.scene.objects.filter(o => o.type === 'point')).toHaveLength(2);
  });
  it('applies TeX comment semantics inside plain labels', () => {
    const code = '\\node at (0,0) {A% ignored\nB};';
    const result = parseTikz(code);
    const label = result.scene.objects[0];
    expect(label.type === 'text' && label.text).toBe('AB');
    expect(generateTikz(result.scene)).toBe(code);
  });
  it('respects explicitly disabled arrowheads on an arrow object', () => {
    const scene = emptyScene();
    scene.objects = [{ ...line(), type: 'arrow', style: { ...DEFAULT_STYLE, arrows: 'none' } }];
    const code = generateTikz(scene);
    expect(code).not.toContain('->');
    const result = parseTikz(code);
    expect(result.scene.objects[0].style.arrows).toBe('none');
  });
  it('omits redundant TikZ drawing defaults and empty option brackets', () => {
    const scene = emptyScene();
    scene.objects = [{ ...line(), style: { ...DEFAULT_STYLE, stroke: '#000000', strokeWidth: .4 } }];
    const code = generateTikz(scene);
    expect(code).toContain(String.raw`\draw (0,0) -- (2,1);`);
    expect(code).not.toContain('fill=none');
    expect(code).not.toContain('opacity=1');
    const result = parseTikz(code);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.objects[0].style).toEqual(scene.objects[0].style);
  });
  it('uses named colors when exact and retains nondefault styling', () => {
    const scene = emptyScene();
    scene.objects = [{ ...line(), style: { ...DEFAULT_STYLE, stroke: '#FF0000', fill: '#0000ff', strokeWidth: .4, opacity: .6, dash: 'dashed', arrows: 'end' } }];
    const code = generateTikz(scene);
    expect(code).toContain('[draw=red,fill=blue,opacity=0.6,dashed,->]');
    expect(code).not.toContain('rgb,255');
    expect(parseTikz(code).scene.objects[0].style.stroke).toBe('#ff0000');
  });
  it('keeps fill=none on point markers whose filldraw default is black', () => {
    const scene = emptyScene();
    scene.objects = [{ ...point(), style: { ...DEFAULT_STYLE, stroke: '#000000', strokeWidth: .4, fill: 'none' } }];
    const code = generateTikz(scene);
    expect(code).toContain(String.raw`\filldraw[fill=none]`);
    expect(parseTikz(code).scene.objects[0].style.fill).toBe('none');
  });
  it('adds Korean typesetting support to generated standalone documents only when needed', () => {
    const scene = emptyScene();
    scene.objects = [{ ...line(), type: 'text', position: { x: 1, y: 1 }, text: '삼각형의 넓이', fontSize: 12 }];
    const document = standaloneTex(scene);
    expect(document).toContain('% !TeX program = xelatex');
    expect(document).toContain(String.raw`\usepackage{kotex}`);
    expect(document).toContain('삼각형의 넓이');
    expect(standaloneTex(emptyScene())).not.toContain('kotex');
    const imported = String.raw`\documentclass{standalone}\usepackage{tikz}\begin{document}\begin{tikzpicture}\node at (0,0) {한글};\end{tikzpicture}\end{document}`;
    expect(standaloneTex(parseTikz(imported).scene)).toBe(imported);
  });
});

describe('dynamic geometry and formula graph export', () => {
  it.each(['arc', 'sector'] as const)('round trips generated %s geometry', type => {
    const scene = emptyScene();
    scene.objects = [{ ...line(), type, center: { x: 2, y: 3 }, radius: 2, startAngle: 30, sweepAngle: -120 }];
    const code = generateTikz(scene), result = parseTikz(code);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.objects[0].type).toBe(type);
    const shape = result.scene.objects[0];
    if (shape.type === 'arc' || shape.type === 'sector') {
      expect(shape.center.x).toBeCloseTo(2, 5); expect(shape.center.y).toBeCloseTo(3, 5);
      expect(shape.radius).toBe(2); expect(shape.startAngle).toBe(30); expect(shape.sweepAngle).toBe(-120);
    }
    expect(generateTikz(result.scene)).toBe(code);
  });
  it.each(['cartesian', 'parametric', 'polar'] as const)('keeps generated %s graphs editable via validated metadata', mode => {
    const scene = emptyScene();
    const graph: PlotObject = { ...line(), type: 'plot', mode, expression: mode === 'cartesian' ? 'a*x^2' : 'sin(t)', xExpression: 'cos(t)', xMin: -2, xMax: 2, parameters: { a: 2 }, offset: { x: 1, y: -1 } };
    scene.objects = [graph];
    const code = generateTikz(scene), result = parseTikz(code);
    expect(code).toContain('% tikz-studio plot:');
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.objects[0]).toMatchObject({ type: 'plot', mode, expression: graph.expression, xExpression: graph.xExpression, parameters: graph.parameters, offset: graph.offset });
    expect(generateTikz(result.scene)).toBe(code);
  });
  it('never lets plot metadata override manually edited paths or execute expressions', () => {
    const scene = emptyScene(); scene.objects = [{ ...line(), type: 'plot', mode: 'cartesian', expression: 'x', xExpression: '', xMin: -1, xMax: 1, parameters: {} }];
    const code = generateTikz(scene);
    const edited = code.replace('(-1,-1)', '(-1,99)');
    const result = parseTikz(edited);
    expect(result.scene.objects).toHaveLength(0);
    expect(result.diagnostics.some(d => d.severity === 'warning')).toBe(true);
    expect(generateTikz(result.scene)).toBe(edited);
    const malicious = code.replace(encodeURIComponent('"expression":"x"'), encodeURIComponent('"expression":"globalThis.alert(1)"'));
    expect(parseTikz(malicious).scene.objects).toHaveLength(0);
  });
  it('resolves bound point declarations after their host moves, even with preserved source', () => {
    const scene = parseTikz(String.raw`\coordinate (A) at (1,0);\draw (0,0) circle[radius=1cm];`).scene;
    const p = scene.objects[0], host = scene.objects[1];
    if (p.type === 'point') p.binding = { objectId: host.id, t: 0 };
    if (host.type === 'circle') { host.center = { x: 3, y: 4 }; host.radius = 2; }
    expect(generateTikz(scene)).toContain('(A) at (5,4)');
  });
  it('exports open arcs and graphs without a fill, matching their canvas paths', () => {
    const scene = emptyScene();
    scene.objects = [{ ...line(), type: 'arc', center: { x: 0, y: 0 }, radius: 1, startAngle: 0, sweepAngle: 90, style: { ...DEFAULT_STYLE, fill: '#ff0000' } }, { ...line('graph'), type: 'plot', mode: 'cartesian', expression: 'x', xExpression: '', xMin: -1, xMax: 1, parameters: {}, style: { ...DEFAULT_STYLE, fill: '#ff0000' } }];
    expect(generateTikz(scene)).not.toContain('fill=red');
    const code = String.raw`\draw[fill=red] (1,0) arc(0:90:1cm);`;
    const result = parseTikz(code);
    expect(result.scene.objects).toHaveLength(0);
    expect(generateTikz(result.scene)).toBe(code);
  });
});
