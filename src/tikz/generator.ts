import type { Anchor, Scene, SceneObject, Style, PlotObject } from '../core/types';
import { resolveAnchor, resolvePoint } from '../core/geometry';
import { samplePlot } from '../core/plot';
import { isObjectDefined } from '../core/defined';

/** Used only for deciding whether an imported statement is still untouched. */
export const objectSignature = (object: SceneObject, objects: SceneObject[] = []): string => JSON.stringify(object.type === 'point' && object.binding ? { ...object, position: resolvePoint(object, objects) } : (object.type === 'arc' || object.type === 'sector') && object.center.pointId ? { ...object, center: { ...object.center, ...resolveAnchor(object.center, objects) } } : object);
const number = (value: number): string => Number.isFinite(value) ? String(Number(value.toFixed(6))) : '0';
const xy = (p: { x: number; y: number }): string => `(${number(p.x)},${number(p.y)})`;
/** Multiple move-to subpaths preserve the holes found by the same sampler used by the canvas. */
export const plotCoordinates = (plot: PlotObject): string => samplePlot(plot).map(segment => segment.map(xy).join(' -- ')).join(' ');
const NAMED_COLORS: Record<string, string> = { '#000000': 'black', '#ffffff': 'white', '#ff0000': 'red', '#00ff00': 'green', '#0000ff': 'blue', '#00ffff': 'cyan', '#ff00ff': 'magenta', '#ffff00': 'yellow', '#808080': 'gray', '#404040': 'darkgray', '#bfbfbf': 'lightgray', '#ff8000': 'orange', '#bf0040': 'purple', '#800080': 'violet', '#bf8040': 'brown', '#008080': 'teal', '#bfff00': 'lime', '#ffbfbf': 'pink', '#808000': 'olive' };

function color(value: string): string {
  if (value === 'none') return 'none';
  if (NAMED_COLORS[value.toLowerCase()]) return NAMED_COLORS[value.toLowerCase()];
  const hex = /^#([\da-f]{6})$/i.exec(value)?.[1];
  if (!hex) return 'black';
  return `{rgb,255:red,${parseInt(hex.slice(0, 2), 16)};green,${parseInt(hex.slice(2, 4), 16)};blue,${parseInt(hex.slice(4, 6), 16)}}`;
}

export function escapeText(text: string): string {
  const escaped: Record<string, string> = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '%': '\\%', '#': '\\#', '_': '\\_', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}', '\n': ' ' };
  return text.replace(/[\\{}$&%#_^~\n]/g, ch => escaped[ch]);
}

function names(scene: Scene): Map<string, string> {
  const result = new Map<string, string>();
  const reserved = new Set<string>();
  for (const entry of scene.source) {
    for (const match of (entry.raw || '').matchAll(/\\coordinate\s*\(\s*([A-Za-z][A-Za-z0-9_-]*)\s*\)/g)) reserved.add(match[1]);
  }
  for (const object of scene.objects) {
    if (object.type !== 'point') continue;
    const source = scene.source.find(entry => entry.kind === 'object' && entry.objectId === object.id);
    const original = source?.kind === 'object' && source.raw?.match(/\\coordinate\s*\(\s*([A-Za-z][A-Za-z0-9_-]*)\s*\)/)?.[1];
    const declaration = scene.source.find(entry => entry.kind === 'raw' && entry.pointDeclaration?.objectId === object.id);
    // The layer name is a display name; imported TeX identifiers remain stable.
    const name = original || (declaration?.kind === 'raw' && declaration.pointDeclaration?.name);
    if (name) { result.set(object.id, name); reserved.add(name); }
  }
  for (const object of scene.objects) {
    if (object.type !== 'point' || result.has(object.id)) continue;
    const base = `p${object.id.replace(/[^a-zA-Z0-9]/g, '')}`;
    let candidate = base, suffix = 2;
    while (reserved.has(candidate)) candidate = `${base}_${suffix++}`;
    result.set(object.id, candidate); reserved.add(candidate);
  }
  return result;
}

function styleOptions(style: Style, command: 'draw' | 'filldraw', explicitDefaults: boolean): string {
  const options: string[] = [];
  if (explicitDefaults || color(style.stroke) !== 'black') options.push(`draw=${color(style.stroke)}`);
  const fillDefault = command === 'filldraw' ? 'black' : 'none';
  if (explicitDefaults || color(style.fill) !== fillDefault) options.push(`fill=${color(style.fill)}`);
  if (explicitDefaults || Math.abs(style.strokeWidth - .4) > 1e-10) options.push(`line width=${number(style.strokeWidth)}pt`);
  if (explicitDefaults || style.opacity !== 1) options.push(`opacity=${number(style.opacity)}`);
  if (explicitDefaults || style.dash !== 'solid') options.push(style.dash);
  if (style.arrows !== 'none') options.push({ start: '<-', end: '->', both: '<->' }[style.arrows]);
  else if (explicitDefaults) options.push('-');
  return options.length ? `[${options.join(',')}]` : '';
}

function renderObject(object: SceneObject, refs: Map<string, string>, part: 'full' | 'marker' | 'declaration' = 'full', explicitDefaults = false, objects: SceneObject[] = []): string {
  if (!isObjectDefined(object, objects)) return '';
  const anchor = (p: Anchor): string => p.pointId && refs.has(p.pointId) ? `(${refs.get(p.pointId)})` : xy(p);
  if (object.type === 'point') {
    const name = refs.get(object.id)!;
    const definition = `\\coordinate (${name}) at ${xy(resolvePoint(object, objects))};`;
    const marker = !object.visible || (object.style.fill === 'none' && object.style.stroke === 'none') ? '' : `% tikz-studio point-marker: ${name}\n\\filldraw${styleOptions(object.style, 'filldraw', explicitDefaults)} (${name}) circle[radius=0.055cm];`;
    if (part === 'declaration') return definition;
    if (part === 'marker') return marker;
    return marker ? `${definition}\n${marker}` : definition;
  }
  if (!object.visible) return '';
  if (object.type === 'text' || object.type === 'math') {
    const content = object.type === 'math' ? `$${object.text}$` : escapeText(object.text);
    const options: string[] = [];
    if (explicitDefaults || color(object.style.stroke) !== 'black') options.push(`text=${color(object.style.stroke)}`);
    if (explicitDefaults || object.style.opacity !== 1) options.push(`opacity=${number(object.style.opacity)}`);
    options.push(`font={\\fontsize{${number(object.fontSize)}}{${number(object.fontSize * 1.2)}}\\selectfont}`, 'inner sep=0pt', 'outer sep=0pt');
    if (explicitDefaults) options.push('anchor=center');
    return `\\node[${options.join(',')}] at ${anchor(object.position)} {${content}};`;
  }
  const options = styleOptions(object.type === 'arc' || object.type === 'plot' ? { ...object.style, fill: 'none' } : object.style, 'draw', explicitDefaults);
  if (object.type === 'plot') {
    const coordinates = plotCoordinates(object);
    if (!coordinates) return '';
    const metadata = { mode: object.mode, expression: object.expression, xExpression: object.xExpression, xMin: object.xMin, xMax: object.xMax, parameters: object.parameters, ...(object.offset ? { offset: object.offset } : {}), ...(object.yMin !== undefined ? { yMin: object.yMin } : {}), ...(object.yMax !== undefined ? { yMax: object.yMax } : {}) };
    return `% tikz-studio plot: ${encodeURIComponent(JSON.stringify(metadata))}\n\\draw${options} ${coordinates};`;
  }
  if (object.type === 'arc' || object.type === 'sector') {
    const center = resolveAnchor(object.center, objects), angle = object.startAngle * Math.PI / 180;
    const start = xy({ x: center.x + object.radius * Math.cos(angle), y: center.y + object.radius * Math.sin(angle) });
    const arc = `${start} arc[start angle=${number(object.startAngle)},end angle=${number(object.startAngle + object.sweepAngle)},radius=${number(object.radius)}cm]`;
    return `\\draw${options} ${object.type === 'sector' ? `${anchor(object.center)} -- ${arc} -- cycle` : arc};`;
  }
  if (object.type === 'circle') return `\\draw${options} ${anchor(object.center)} circle[radius=${number(object.radius)}cm];`;
  if (object.type === 'rectangle') return `\\draw${options} ${anchor(object.points[0])} rectangle ${anchor(object.points[1])};`;
  const path = ('points' in object ? object.points : []).map(anchor).join(' -- ') + (object.type === 'polygon' ? ' -- cycle' : '');
  return `\\draw${options} ${path};`;
}

function hasDanglingReference(object: SceneObject, refs: Map<string, string>): boolean {
  const anchors = 'points' in object ? object.points : 'center' in object ? [object.center] : object.type === 'text' || object.type === 'math' ? [object.position] : [];
  return anchors.some(p => p.pointId && !refs.has(p.pointId));
}

export function generateTikz(scene: Scene): string {
  const refs = names(scene);
  // Opaque source can change inherited defaults; explicit overrides remain necessary there.
  const explicitDefaults = scene.source.some(entry => entry.kind === 'raw' && entry.reason === 'unsupported');
  const render = (object: SceneObject) => renderObject(object, refs, 'full', explicitDefaults, scene.objects);
  const visual = (object: SceneObject) => renderObject(object, refs, object.type === 'point' ? 'marker' : 'full', explicitDefaults, scene.objects);
  if (!scene.source.length) {
    const declarations = scene.objects.filter(o => o.type === 'point').map(o => renderObject(o, refs, 'declaration', explicitDefaults, scene.objects));
    return `\\begin{tikzpicture}\n${[...declarations, ...scene.objects.map(visual)].filter(Boolean).join('\n')}\n\\end{tikzpicture}`;
  }

  const originalIds = new Set(scene.source.flatMap(entry => entry.kind === 'object' ? [entry.objectId] : []));
  const added = scene.objects.filter(object => !originalIds.has(object.id));
  const objects = new Map(scene.objects.map(object => [object.id, object]));
  const entries = scene.source.map(entry => ({ ...entry }));
  // Reorder only within supported runs; opaque source is a semantic barrier.
  let run: number[] = [];
  const flush = () => {
    const ids = new Set(run.map(index => entries[index]).flatMap(e => e.kind === 'object' ? [e.objectId] : []));
    const sources = new Map(run.map(index => entries[index]).flatMap(e => e.kind === 'object' ? [[e.objectId, e] as const] : []));
    const sorted = scene.objects.filter(object => ids.has(object.id));
    const removed = run.map(index => entries[index]).filter(e => e.kind === 'object' && !objects.has(e.objectId));
    const replacements = [...sorted.map(object => sources.get(object.id)!), ...removed];
    run.forEach((index, i) => { entries[index] = replacements[i]; });
    run = [];
  };
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.kind === 'object') {
      // An ordinary imported coordinate is a declaration, not a paint layer.
      if (objects.get(entry.objectId)?.type === 'point' && /^\\coordinate\b/.test(entry.raw || '')) flush();
      else run.push(i);
    } else if (entry.reason !== 'trivia' && !entry.pointDeclaration) flush();
  }
  flush();

  const newPoints = added.filter(o => o.type === 'point');
  let inserted = false, pointsInserted = false;
  let output = '';
  const appendPoints = () => {
    if (pointsInserted) return;
    if (newPoints.length) output += `${output.endsWith('\n') || !output ? '' : '\n'}${newPoints.map(o => renderObject(o, refs, 'declaration', explicitDefaults, scene.objects)).join('\n')}\n`;
    pointsInserted = true;
  };
  const appendAdded = () => {
    if (inserted) return;
    appendPoints();
    if (added.length) output += `${output.endsWith('\n') || !output ? '' : '\n'}${added.map(visual).filter(Boolean).join('\n')}\n`;
    inserted = true;
  };
  if (!entries.some(e => e.kind === 'raw' && e.reason === 'picture-open')) appendPoints();
  for (const entry of entries) {
    if (entry.kind === 'raw') {
      if (entry.pointDeclaration) {
        const point = objects.get(entry.pointDeclaration.objectId);
        if (point?.type === 'point' && isObjectDefined(point, scene.objects)) {
          const position = resolvePoint(point, scene.objects);
          output += position.x === entry.pointDeclaration.position.x && position.y === entry.pointDeclaration.position.y ? entry.raw : renderObject(point, refs, 'declaration', explicitDefaults, scene.objects);
        }
        continue;
      }
      if (entry.reason === 'picture-close') appendAdded();
      output += entry.raw;
      if (entry.reason === 'picture-open') appendPoints();
      continue;
    }
    const object = objects.get(entry.objectId);
    if (!object || !isObjectDefined(object, scene.objects) || (object.type === 'plot' && !samplePlot(object).some(path => path.length > 1))) continue;
    const markerOnly = entry.raw?.startsWith('% tikz-studio point-marker:');
    output += entry.raw !== undefined && entry.signature === objectSignature(object, scene.objects) && !hasDanglingReference(object, refs) ? entry.raw : markerOnly ? visual(object) : render(object);
  }
  appendAdded();
  return output;
}

export function standaloneTex(scene: Scene): string {
  const code = generateTikz(scene);
  const semantic = code.replace(/(?<!\\)%[^\n]*/g, '');
  if (/\\documentclass\s*(?:\[[^\]]*\])?\s*\{/.test(semantic)) return code;
  const picture = /\\begin\s*\{tikzpicture\}/.test(semantic) ? code : `\\begin{tikzpicture}\n${code}\n\\end{tikzpicture}`;
  const korean = /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7ff]/.test(semantic);
  return `${korean ? '% !TeX program = xelatex\n' : ''}\\documentclass[tikz,border=6pt]{standalone}\n\\usepackage{amsmath,amssymb}\n${korean ? '\\usepackage{kotex}\n' : ''}\\begin{document}\n${picture}\n\\end{document}\n`;
}
