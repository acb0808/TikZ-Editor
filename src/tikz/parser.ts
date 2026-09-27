import { emptyScene, type Anchor, type Diagnostic, type ParseResult, type SceneObject, type Style, type PlotObject } from '../core/types';
import { objectSignature, plotCoordinates } from './generator';
import { validatePlotExpression } from '../core/plot';

class Unsupported extends Error {}
class SyntaxIssue extends Error {}
interface Group { value: string; end: number }
const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#00ff00', blue: '#0000ff', cyan: '#00ffff', magenta: '#ff00ff', yellow: '#ffff00', gray: '#808080', darkgray: '#404040', lightgray: '#bfbfbf', orange: '#ff8000', purple: '#bf0040', violet: '#800080', brown: '#bf8040', teal: '#008080', lime: '#bfff00', pink: '#ffbfbf', olive: '#808000' };
const BASE: Style = { stroke: '#000000', fill: 'none', strokeWidth: .4, opacity: 1, dash: 'solid', arrows: 'none' };

function commentsRemoved(code: string, preserveOffsets = true): string {
  let result = '';
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\\' && i + 1 < code.length) { result += code.slice(i, i + 2); i++; }
    else if (code[i] === '%') { while (i < code.length && code[i] !== '\n') { if (preserveOffsets) result += ' '; i++; } if (i < code.length && preserveOffsets) result += '\n'; }
    else result += code[i];
  }
  return result;
}

function balancedGroup(text: string, start: number, open: string, close: string): Group {
  // Brace groups may contain escaped delimiters; option/coordinate groups may contain braces.
  if (text[start] !== open) throw new SyntaxIssue(`${open} 기호가 필요합니다.`);
  let depth = 1, braces = 0;
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (open !== '{') {
      if (text[i] === '{') { braces++; continue; }
      if (text[i] === '}') { braces--; continue; }
      if (braces) continue;
    }
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return { value: text.slice(start + 1, i), end: i + 1 };
  }
  throw new SyntaxIssue(`${open}${close} 괄호가 닫히지 않았습니다.`);
}

function splitOptions(text: string): string[] {
  let depth = 0, start = 0;
  const result: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if ('{[('.includes(text[i])) depth++;
    if ('}])'.includes(text[i])) depth--;
    if (text[i] === ',' && depth === 0) { result.push(text.slice(start, i).trim()); start = i + 1; }
  }
  result.push(text.slice(start).trim());
  return result.filter(Boolean);
}

function parseColor(value: string): string {
  if (value === 'none') return value;
  if (NAMED[value]) return NAMED[value];
  const rgb = /^\{rgb,255:red,(\d+);green,(\d+);blue,(\d+)\}$/.exec(value.replace(/\s/g, ''));
  if (rgb && rgb.slice(1).every(n => Number(n) <= 255)) return '#' + rgb.slice(1).map(n => Number(n).toString(16).padStart(2, '0')).join('');
  throw new Unsupported(`색상 “${value}”는 원문으로 보존합니다.`);
}

function dimension(value: string, defaultUnit = 'cm'): number {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(cm|mm|pt|in|bp)?$/.exec(value.trim());
  if (!match) throw new Unsupported(`좌표식 “${value}”는 원문으로 보존합니다.`);
  const factors: Record<string, number> = { cm: 1, mm: .1, in: 2.54, pt: 2.54 / 72.27, bp: 2.54 / 72 };
  return Number(match[1]) * factors[match[2] || defaultUnit];
}

function options(text: string, command: string): { style: Style; fontSize: number } {
  const style = { ...BASE };
  if (command === 'fill') { style.stroke = 'none'; style.fill = '#000000'; }
  if (command === 'filldraw') style.fill = '#000000';
  let fontSize = 10;
  for (const item of splitOptions(text)) {
    const at = item.indexOf('=');
    const key = (at === -1 ? item : item.slice(0, at)).trim();
    const value = at === -1 ? '' : item.slice(at + 1).trim();
    if (command === 'node' && ['draw', 'fill', 'line width', 'dashed', 'dotted', 'solid', '->', '<-', '<->', '-', 'ultra thin', 'very thin', 'thin', 'semithick', 'thick', 'very thick', 'ultra thick'].includes(key)) throw new Unsupported('테두리·배경이 있는 node는 원문으로 보존합니다.');
    if (['draw', 'fill', 'text', 'color'].includes(key)) {
      const parsed = parseColor(value || 'black');
      if (key === 'fill') style.fill = parsed;
      else if (key === 'color') { style.stroke = parsed; if (command === 'fill' || command === 'filldraw') style.fill = parsed; }
      else style.stroke = parsed;
    } else if (key === 'line width') style.strokeWidth = dimension(value, 'pt') * 72.27 / 2.54;
    else if (key === 'opacity') { const n = Number(value); if (!value || !Number.isFinite(n) || n < 0 || n > 1) throw new Unsupported('지원하지 않는 투명도입니다.'); style.opacity = n; }
    else if (key === 'dashed' || key === 'dotted' || key === 'solid') style.dash = key;
    else if (key === '->' || key === '<-' || key === '<->' || key === '-') style.arrows = ({ '->': 'end', '<-': 'start', '<->': 'both', '-': 'none' } as const)[key];
    else if ({ 'ultra thin': .1, 'very thin': .2, thin: .4, semithick: .6, thick: .8, 'very thick': 1.2, 'ultra thick': 1.6 }[key] !== undefined) style.strokeWidth = ({ 'ultra thin': .1, 'very thin': .2, thin: .4, semithick: .6, thick: .8, 'very thick': 1.2, 'ultra thick': 1.6 } as Record<string, number>)[key];
    else if (NAMED[key] && at === -1) { style.stroke = NAMED[key]; if (command === 'fill' || command === 'filldraw') style.fill = NAMED[key]; }
    else if (key === 'font' && command === 'node') {
      const font = /^\{\\fontsize\{([\d.]+)\}\{[\d.]+\}\\selectfont\}$/.exec(value);
      if (!font) throw new Unsupported('지원하지 않는 글꼴 옵션은 원문으로 보존합니다.');
      fontSize = Number(font[1]);
    } else if (command === 'node' && ((key === 'anchor' && value === 'center') || (['inner sep', 'outer sep'].includes(key) && dimension(value) === 0))) { /* fixed center anchor */ }
    else throw new Unsupported(`옵션 “${key}”는 GUI에서 지원하지 않아 원문으로 보존합니다.`);
  }
  return { style, fontSize };
}

function decodeText(value: string): string {
  const tokens: Record<string, string> = { '\\textbackslash{}': '\\', '\\textasciicircum{}': '^', '\\textasciitilde{}': '~', '\\{': '{', '\\}': '}', '\\$': '$', '\\&': '&', '\\%': '%', '\\#': '#', '\\_': '_' };
  let result = '';
  for (let i = 0; i < value.length;) {
    const token = Object.keys(tokens).find(key => value.startsWith(key, i));
    if (token) { result += tokens[token]; i += token.length; }
    else { if (/[\\{}$&#_^~]/.test(value[i])) throw new Unsupported('복합 TeX 레이블은 원문으로 보존합니다.'); result += value[i++]; }
  }
  return result;
}

function parseStatement(statement: string, id: string, points: Map<string, Extract<SceneObject, { type: 'point' }>>, plotMetadata?: string): SceneObject {
  const input = commentsRemoved(statement, false).trim();
  const match = /^\\(draw|filldraw|fill|path|coordinate|node)\b/.exec(input);
  if (!match) throw new Unsupported('지원하지 않는 명령입니다.');
  const command = match[1];
  let pos = match[0].length;
  const ws = () => { while (/\s/.test(input[pos] || '') && pos < input.length) pos++; };
  ws();
  let optionText = '';
  if (input[pos] === '[') { const g = balancedGroup(input, pos, '[', ']'); optionText = g.value; pos = g.end; ws(); }
  const parsed = options(optionText, command);
  if (command === 'path') throw new Unsupported('일반 path 명령은 원문으로 보존합니다.');
  const base = { id, name: command, visible: true, locked: false, style: parsed.style };
  if (plotMetadata) {
    // Metadata is only a hint: parse bounded data, validate the expression, then match the actual path.
    try {
      if (plotMetadata.length > 32768 || command !== 'draw' || parsed.style.fill !== 'none') throw new Error();
      const data = JSON.parse(decodeURIComponent(plotMetadata)) as Record<string, unknown>;
      if (!data || Array.isArray(data) || Object.keys(data).some(key => !['mode', 'expression', 'xExpression', 'xMin', 'xMax', 'parameters', 'offset', 'yMin', 'yMax'].includes(key))) throw new Error();
      if (typeof data.expression !== 'string' || typeof data.xExpression !== 'string' || data.xExpression.length > 1024 || typeof data.xMin !== 'number' || typeof data.xMax !== 'number' || !data.parameters || Array.isArray(data.parameters) || typeof data.parameters !== 'object') throw new Error();
      if (data.offset !== undefined && (typeof data.offset !== 'object' || !data.offset || Array.isArray(data.offset) || Object.keys(data.offset).some(key => !['x', 'y'].includes(key)))) throw new Error();
      if ((data.yMin !== undefined && typeof data.yMin !== 'number') || (data.yMax !== undefined && typeof data.yMax !== 'number')) throw new Error();
      const graph: PlotObject = { ...base, type: 'plot', name: '함수 그래프', mode: data.mode as PlotObject['mode'], expression: data.expression, xExpression: data.xExpression, xMin: data.xMin, xMax: data.xMax, parameters: data.parameters as Record<string, number>, ...(data.offset ? { offset: data.offset as PlotObject['offset'] } : {}), ...(data.yMin !== undefined ? { yMin: data.yMin as number } : {}), ...(data.yMax !== undefined ? { yMax: data.yMax as number } : {}) };
      if (validatePlotExpression(graph) || input.slice(pos, -1).replace(/\s/g, '') !== plotCoordinates(graph).replace(/\s/g, '')) throw new Error();
      return graph;
    } catch { throw new Unsupported('그래프 메타데이터와 실제 경로가 일치하지 않거나 지원하지 않는 수식이어서 원문으로 보존합니다.'); }
  }
  const readAnchor = (): Anchor => {
    ws();
    if (input[pos] !== '(') throw new Unsupported('지원하지 않는 좌표 문법입니다.');
    const g = balancedGroup(input, pos, '(', ')'); pos = g.end; ws();
    const value = g.value.trim();
    const reference = points.get(value);
    if (reference) return { ...reference.position, pointId: reference.id };
    const xy = value.split(',');
    if (xy.length === 2) return { x: dimension(xy[0]), y: dimension(xy[1]) };
    throw new Unsupported(`좌표 “${value}”를 계산할 수 없어 원문으로 보존합니다.`);
  };
  const done = () => { ws(); if (input.slice(pos) !== ';') throw new Unsupported('추가 경로 문법은 원문으로 보존합니다.'); };
  if (command === 'coordinate') {
    if (optionText) throw new Unsupported('coordinate 옵션은 원문으로 보존합니다.');
    const name = balancedGroup(input, pos, '(', ')'); pos = name.end; ws();
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name.value.trim()) || points.has(name.value.trim())) throw new Unsupported('중복 또는 복합 좌표 이름은 원문으로 보존합니다.');
    if (!input.startsWith('at', pos)) throw new Unsupported('at 없는 coordinate는 원문으로 보존합니다.');
    pos += 2;
    const coordinate = readAnchor();
    if (coordinate.pointId) throw new Unsupported('다른 점으로 정의한 좌표는 원문으로 보존합니다.');
    done();
    return { ...base, type: 'point', name: name.value.trim(), style: { ...BASE, stroke: 'none', fill: 'none' }, position: { x: coordinate.x, y: coordinate.y } };
  }
  if (command === 'node') {
    if (!input.startsWith('at', pos)) throw new Unsupported('이름·배치 규칙이 있는 node는 원문으로 보존합니다.');
    pos += 2;
    const position = readAnchor();
    const label = balancedGroup(input, pos, '{', '}'); pos = label.end; done();
    const isMath = label.value.startsWith('$') && label.value.endsWith('$') && !label.value.startsWith('$$');
    return { ...base, name: isMath ? '수식' : '텍스트', type: isMath ? 'math' : 'text', position, text: isMath ? label.value.slice(1, -1) : decodeText(label.value), fontSize: parsed.fontSize };
  }
  const first = readAnchor();
  const readArc = (start: Anchor, sectorCenter?: Anchor): SceneObject => {
    if (!sectorCenter && parsed.style.fill !== 'none') throw new Unsupported('채워진 열린 호는 원문으로 보존합니다.');
    pos += 3; ws();
    let startAngle: number, endAngle: number, radius: number;
    const angle = (value: string) => { if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) throw new Unsupported('호의 각도식은 원문으로 보존합니다.'); return Number(value); };
    if (input[pos] === '[') {
      const group = balancedGroup(input, pos, '[', ']'); pos = group.end;
      const values = new Map<string, string>();
      for (const item of splitOptions(group.value)) { const pair = /^\s*(start angle|end angle|radius)\s*=\s*(.+)$/.exec(item); if (!pair || values.has(pair[1])) throw new Unsupported('복합 호 옵션은 원문으로 보존합니다.'); values.set(pair[1], pair[2]); }
      if (values.size !== 3) throw new Unsupported('호의 시작·끝 각도와 반지름이 필요합니다.');
      startAngle = angle(values.get('start angle')!); endAngle = angle(values.get('end angle')!); radius = dimension(values.get('radius')!);
    } else {
      const group = balancedGroup(input, pos, '(', ')'); pos = group.end;
      const values = group.value.split(':'); if (values.length !== 3) throw new Unsupported('복합 호 문법은 원문으로 보존합니다.');
      startAngle = angle(values[0]); endAngle = angle(values[1]); radius = dimension(values[2]);
    }
    const sweepAngle = endAngle - startAngle;
    if (![radius, startAngle, sweepAngle].every(Number.isFinite) || radius <= 0 || radius > 1e6 || Math.abs(sweepAngle) > 360 || sweepAngle === 0) throw new Unsupported('호의 반지름 또는 각도 범위를 지원하지 않습니다.');
    const radians = startAngle * Math.PI / 180, inferred = { x: start.x - radius * Math.cos(radians), y: start.y - radius * Math.sin(radians) };
    ws();
    if (sectorCenter) {
      if (Math.hypot(inferred.x - sectorCenter.x, inferred.y - sectorCenter.y) > 2e-6) throw new Unsupported('부채꼴의 중심과 호가 일치하지 않습니다.');
      if (!/^--\s*cycle/.test(input.slice(pos))) throw new Unsupported('닫히지 않은 부채꼴 경로는 원문으로 보존합니다.');
      pos += /^--\s*cycle/.exec(input.slice(pos))![0].length;
    }
    done(); return { ...base, type: sectorCenter ? 'sector' : 'arc', name: sectorCenter ? '부채꼴' : '호', center: sectorCenter ?? inferred, radius, startAngle, sweepAngle };
  };
  if (input.startsWith('arc', pos)) return readArc(first);
  if (input.startsWith('circle', pos)) {
    pos += 6; ws();
    let radius: number;
    if (input[pos] === '[') {
      const g = balancedGroup(input, pos, '[', ']'); pos = g.end;
      const radiusText = /^radius\s*=\s*(.+)$/.exec(g.value.trim());
      if (!radiusText) throw new Unsupported('복합 원 옵션은 원문으로 보존합니다.');
      radius = dimension(radiusText[1]);
    } else { const g = balancedGroup(input, pos, '(', ')'); pos = g.end; radius = dimension(g.value); }
    if (radius <= 0) throw new Unsupported('원의 반지름은 양수여야 합니다.');
    done(); return { ...base, type: 'circle', name: '원', center: first, radius };
  }
  if (input.startsWith('rectangle', pos)) { pos += 9; const end = readAnchor(); done(); return { ...base, type: 'rectangle', name: '사각형', points: [first, end] }; }
  const anchors = [first];
  let closed = false;
  while (input.startsWith('--', pos)) {
    pos += 2; ws();
    if (input.startsWith('cycle', pos)) { closed = true; pos += 5; break; }
    anchors.push(readAnchor());
    if (anchors.length === 2 && input.startsWith('arc', pos)) return readArc(anchors[1], first);
  }
  done();
  if (closed && anchors.length >= 3) return { ...base, type: 'polygon', name: '다각형', points: anchors };
  if (!closed && anchors.length === 2) return { ...base, type: base.style.arrows === 'none' ? 'line' : 'arrow', name: base.style.arrows === 'none' ? '선분' : '화살표', points: anchors };
  throw new Unsupported('이 경로는 원문으로 보존합니다.');
}

interface Environment { name: string; start: number; end: number; closing: boolean }
function environments(code: string): Environment[] {
  const text = commentsRemoved(code), result: Environment[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      if (depth === 0) {
        const match = /^\\(begin|end)\s*\{([^{}]+)\}/.exec(text.slice(i));
        if (match) { result.push({ name: match[2].trim(), start: i, end: i + match[0].length, closing: match[1] === 'end' }); i += match[0].length - 1; continue; }
      }
      i++; continue;
    }
    if (text[i] === '{') depth++;
    if (text[i] === '}') depth--;
  }
  return result;
}

function triviaEnd(code: string, start: number): number {
  let i = start;
  while (i < code.length) {
    if (/\s/.test(code[i])) i++;
    else if (code[i] === '%') { while (i < code.length && code[i] !== '\n') i++; }
    else break;
  }
  return i;
}

function statementEnd(text: string, start: number): number {
  let braces = 0, brackets = 0, parentheses = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '{') braces++;
    else if (text[i] === '}') braces--;
    else if (!braces && text[i] === '[') brackets++;
    else if (!braces && text[i] === ']') brackets--;
    else if (!braces && text[i] === '(') parentheses++;
    else if (!braces && text[i] === ')') parentheses--;
    if (braces < 0 || brackets < 0 || parentheses < 0) throw new SyntaxIssue('닫는 괄호의 짝이 맞지 않습니다.');
    if (text[i] === ';' && !braces && !brackets && !parentheses) return i + 1;
  }
  throw new SyntaxIssue('명령 끝의 세미콜론(;) 또는 닫는 괄호가 없습니다.');
}

export function parseTikz(code: string): ParseResult {
  const scene = emptyScene(), diagnostics: Diagnostic[] = [];
  if (!code) { scene.source = [{ kind: 'raw', raw: '', reason: 'trivia' }]; return { scene, diagnostics }; }
  const lineAt = (pos: number) => code.slice(0, pos).split('\n').length;
  const diagnose = (pos: number, message: string, severity: Diagnostic['severity'] = 'warning') => diagnostics.push({ line: lineAt(pos), message, severity });
  const allRaw = (message: string, severity: Diagnostic['severity']) => { scene.source = [{ kind: 'raw', raw: code, reason: 'unsupported', line: 1 }]; diagnose(0, message, severity); return { scene, diagnostics }; };
  // Fail the entire import atomically on malformed brace structure.
  const clean = commentsRemoved(code);
  let braces = 0;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '\\') { i++; continue; }
    if (clean[i] === '{') braces++;
    if (clean[i] === '}' && --braces < 0) return allRaw('중괄호의 짝이 맞지 않습니다.', 'error');
  }
  if (braces !== 0) return allRaw('중괄호가 닫히지 않았습니다.', 'error');
  const envs = environments(code);
  const environmentStack: string[] = [];
  for (const env of envs) {
    if (!env.closing) environmentStack.push(env.name);
    else if (environmentStack.pop() !== env.name) return allRaw(`${env.name} 환경의 시작과 끝이 맞지 않습니다.`, 'error');
  }
  if (environmentStack.length) return allRaw(`${environmentStack.at(-1)} 환경이 닫히지 않았습니다.`, 'error');
  const picture = envs.find(env => env.name === 'tikzpicture' && !env.closing);
  let start = 0, end = code.length, suffix = '';
  if (picture) {
    const close = envs.find(env => env.name === 'tikzpicture' && env.closing && env.start >= picture.end);
    if (!close) return allRaw('tikzpicture 환경이 닫히지 않았습니다.', 'error');
    start = picture.end;
    const optionStart = triviaEnd(code, start);
    if (clean[optionStart] === '[') {
      try {
        const opts = balancedGroup(clean, optionStart, '[', ']');
        if (opts.value.trim()) {
          scene.source = [
            { kind: 'raw', raw: code.slice(0, opts.end), reason: 'picture-open' },
            { kind: 'raw', raw: code.slice(opts.end, close.start), reason: 'unsupported', line: lineAt(opts.end) },
            { kind: 'raw', raw: code.slice(close.start), reason: 'picture-close' },
          ];
          diagnose(optionStart, '그림 전체의 옵션·변환은 원문으로 보존합니다. 이 그림에 추가한 도형에도 기존 옵션이 적용됩니다.');
          return { scene, diagnostics };
        }
        start = opts.end;
      } catch (error) { return allRaw((error as Error).message, 'error'); }
    }
    if (/\\(?:tikzset|pgfset[a-zA-Z]*|def|gdef|edef|xdef|let|catcode|renewcommand)\b/.test(clean.slice(0, picture.start))) {
      scene.source = [
        { kind: 'raw', raw: code.slice(0, start), reason: 'picture-open' },
        { kind: 'raw', raw: code.slice(start, close.start), reason: 'unsupported', line: lineAt(start) },
        { kind: 'raw', raw: code.slice(close.start), reason: 'picture-close' },
      ];
      diagnose(0, '그림 앞의 전역 설정·매크로가 도형에 영향을 줄 수 있어 그림을 원문으로 보존합니다.');
      return { scene, diagnostics };
    }
    end = close.start; suffix = code.slice(end);
    scene.source.push({ kind: 'raw', raw: code.slice(0, start), reason: 'picture-open' });
    if (envs.some(env => env.name === 'tikzpicture' && !env.closing && env.start > close.end)) diagnose(close.end, '여러 그림 중 첫 번째 그림만 GUI에서 편집합니다. 나머지는 원문으로 보존합니다.');
  } else if (envs.some(env => env.name === 'document')) return allRaw('문서 안에 tikzpicture 환경이 없습니다.', 'warning');

  const body = code.slice(start, end), bodyClean = commentsRemoved(body);
  const points = new Map<string, Extract<SceneObject, { type: 'point' }>>();
  let pos = 0, serial = 0;
  while (pos < body.length) {
    const next = triviaEnd(body, pos);
    const marker = /% tikz-studio point-marker: ([A-Za-z][A-Za-z0-9_-]*)[ \t]*(?:\r?\n|$)/.exec(body.slice(pos, next));
    const plotMarker = /% tikz-studio plot: ([^\r\n]+)[ \t]*(?:\r?\n|$)/.exec(body.slice(pos, next));
    const markerStart = marker ? pos + marker.index : -1;
    const plotStart = plotMarker ? pos + plotMarker.index : -1;
    if (next > pos) { scene.source.push({ kind: 'raw', raw: body.slice(pos, next), reason: 'trivia' }); pos = next; }
    if (pos >= body.length) break;
    const env = /^\\begin\s*\{([^{}]+)\}/.exec(bodyClean.slice(pos));
    if (env) {
      const nested = environments(body.slice(pos));
      let depth = 0, close: Environment | undefined;
      for (const token of nested) {
        if (token.name !== env[1]) continue;
        depth += token.closing ? -1 : 1;
        if (depth === 0) { close = token; break; }
      }
      if (!close) { diagnose(start + pos, `${env[1]} 환경이 닫히지 않았습니다.`, 'error'); scene.source.push({ kind: 'raw', raw: body.slice(pos), reason: 'unsupported' }); break; }
      const stop = pos + close.end;
      scene.source.push({ kind: 'raw', raw: body.slice(pos, stop), reason: 'unsupported', line: lineAt(start + pos) });
      diagnose(start + pos, `${env[1]} 환경은 원문으로 보존합니다.`); pos = stop; continue;
    }
    if (!/^\\(?:draw|filldraw|fill|path|coordinate|node)\b/.test(bodyClean.slice(pos))) {
      diagnose(start + pos, '지원하지 않는 명령이 이후 설정에 영향을 줄 수 있어 남은 구간을 원문으로 보존합니다.');
      scene.source.push({ kind: 'raw', raw: body.slice(pos), reason: 'unsupported', line: lineAt(start + pos) }); break;
    }
    let stop: number;
    try { stop = statementEnd(bodyClean, pos); }
    catch (error) { diagnose(start + pos, (error as Error).message, 'error'); scene.source.push({ kind: 'raw', raw: body.slice(pos), reason: 'unsupported' }); break; }
    try {
      const object = parseStatement(body.slice(pos, stop), `import${++serial}`, points, plotMarker?.[1]);
      if (plotMarker && object.type === 'plot') {
        const trivia = scene.source.at(-1);
        if (trivia?.kind === 'raw') { trivia.raw = trivia.raw.slice(0, trivia.raw.indexOf(plotMarker[0])); if (!trivia.raw) scene.source.pop(); }
        scene.objects.push(object);
        scene.source.push({ kind: 'object', objectId: object.id, raw: body.slice(plotStart, stop), signature: objectSignature(object) });
        pos = stop; continue;
      }
      if (marker && object.type === 'circle' && Math.abs(object.radius - .055) < 1e-9) {
        const point = points.get(marker[1]);
        const declarationIndex = scene.source.findIndex(e => e.kind === 'object' && e.objectId === point?.id);
        const declaration = scene.source[declarationIndex];
        if (point && object.center.pointId === point.id && declaration?.kind === 'object' && declaration.raw?.startsWith('\\coordinate')) {
          const trivia = scene.source.at(-1);
          if (trivia?.kind === 'raw') {
            const markerOffset = trivia.raw.indexOf(marker[0]);
            trivia.raw = trivia.raw.slice(0, markerOffset);
            if (!trivia.raw) scene.source.pop();
          }
          scene.source[declarationIndex] = { kind: 'raw', raw: declaration.raw, pointDeclaration: { objectId: point.id, position: { ...point.position }, name: point.name } };
          point.style = object.style;
          scene.objects = [...scene.objects.filter(o => o.id !== point.id), point];
          scene.source.push({ kind: 'object', objectId: point.id, raw: body.slice(markerStart, stop), signature: objectSignature(point) });
          pos = stop; continue;
        }
      }
      if (object.type === 'point') points.set(object.name, object);
      scene.objects.push(object);
      scene.source.push({ kind: 'object', objectId: object.id, raw: body.slice(pos, stop), signature: objectSignature(object) });
    } catch (error) {
      diagnose(start + pos, (error as Error).message, error instanceof SyntaxIssue ? 'error' : 'warning');
      if (/^\\coordinate\b/.test(bodyClean.slice(pos))) stop = body.length;
      scene.source.push({ kind: 'raw', raw: body.slice(pos, stop), reason: 'unsupported', line: lineAt(start + pos) });
    }
    pos = stop;
  }
  if (suffix) scene.source.push({ kind: 'raw', raw: suffix, reason: 'picture-close' });
  for (const entry of scene.source) if (entry.kind === 'object') {
    const object = scene.objects.find(object => object.id === entry.objectId);
    if (object) entry.signature = objectSignature(object, scene.objects);
  }
  return { scene, diagnostics };
}
