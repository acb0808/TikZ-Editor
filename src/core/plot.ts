import type { PlotObject, Vec } from './types';

type Evaluator = (variables: Record<string, number>) => number;
type Node = { kind: 'number'; value: number } | { kind: 'variable'; name: string } | { kind: 'unary'; sign: number; child: Node } | { kind: 'binary'; op: string; left: Node; right: Node } | { kind: 'call'; name: string; args: Node[] };
const functions: Record<string, { arity: number; run: (...args: number[]) => number }> = {
  sin: { arity: 1, run: Math.sin }, cos: { arity: 1, run: Math.cos }, tan: { arity: 1, run: Math.tan },
  asin: { arity: 1, run: Math.asin }, acos: { arity: 1, run: Math.acos }, atan: { arity: 1, run: Math.atan },
  sinh: { arity: 1, run: Math.sinh }, cosh: { arity: 1, run: Math.cosh }, tanh: { arity: 1, run: Math.tanh },
  sqrt: { arity: 1, run: Math.sqrt }, abs: { arity: 1, run: Math.abs }, exp: { arity: 1, run: Math.exp },
  ln: { arity: 1, run: Math.log }, log: { arity: 1, run: Math.log10 }, log10: { arity: 1, run: Math.log10 },
  floor: { arity: 1, run: Math.floor }, ceil: { arity: 1, run: Math.ceil }, round: { arity: 1, run: Math.round }, sign: { arity: 1, run: Math.sign },
  min: { arity: 2, run: Math.min }, max: { arity: 2, run: Math.max }, pow: { arity: 2, run: Math.pow }, atan2: { arity: 2, run: Math.atan2 },
};
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const compiled = new Map<string, Evaluator>();
const variablesUsed = new WeakMap<Evaluator, Set<string>>();
function cached<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): V {
  if (cache.size >= limit) cache.delete(cache.keys().next().value!);
  cache.set(key, value); return value;
}

/** A bounded arithmetic parser. No JavaScript evaluation, object access, or user functions. */
export function compileExpression(expression: string): Evaluator {
  const previous = compiled.get(expression); if (previous) return previous;
  if (typeof expression !== 'string' || expression.length > 1024) throw new Error('수식은 1,024자 이내로 입력해 주세요.');
  const input = expression.replace(/π/g, 'pi').replace(/²/g, '^2').replace(/³/g, '^3').replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/').replace(/^\s*(?:[xy]|[a-zA-Z]\s*\(\s*[xt]\s*\))\s*=\s*/, '');
  const used = new Set<string>();
  const tokens: string[] = [];
  for (let i = 0; i < input.length;) {
    if (/\s/.test(input[i])) { i++; continue; }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z][A-Za-z0-9]*|^[+*/^(),-]/.exec(input.slice(i));
    if (!match) throw new Error(`수식에서 사용할 수 없는 문자: ${input[i]}`);
    tokens.push(match[0]); i += match[0].length;
    if (tokens.length > 512) throw new Error('수식이 너무 복잡합니다.');
  }
  let cursor = 0, depth = 0;
  const peek = () => tokens[cursor];
  const take = (expected: string) => { if (tokens[cursor++] !== expected) throw new Error(`수식에 ${expected}가 필요합니다.`); };
  const guarded = (read: () => Node): Node => { if (++depth > 64) throw new Error('괄호 또는 수식의 중첩이 너무 깊습니다.'); const node = read(); depth--; return node; };
  const primary = (): Node => guarded(() => {
    const token = tokens[cursor++];
    if (!token) throw new Error('수식이 완성되지 않았습니다.');
    if (/^(?:\d|\.)/.test(token)) { const value = Number(token); if (!Number.isFinite(value)) throw new Error('숫자의 크기가 너무 큽니다.'); return { kind: 'number', value }; }
    if (token === '(') { const node = sum(); take(')'); return node; }
    if (token === 'pi' || token === 'e') return { kind: 'number', value: token === 'pi' ? Math.PI : Math.E };
    if (own(functions, token)) {
      take('('); const args: Node[] = [];
      if (peek() !== ')') { args.push(sum()); while (peek() === ',') { cursor++; args.push(sum()); } }
      take(')'); if (args.length !== functions[token].arity) throw new Error(`${token} 함수에는 ${functions[token].arity}개의 값이 필요합니다.`);
      return { kind: 'call', name: token, args };
    }
    if (/^[a-z]$/.test(token) && token !== 'e') { used.add(token); return { kind: 'variable', name: token }; }
    throw new Error(`알 수 없는 수식 이름: ${token}`);
  });
  const power = (): Node => { let left = primary(); if (peek() === '^') { cursor++; left = { kind: 'binary', op: '^', left, right: unary() }; } return left; };
  const unary = (): Node => guarded(() => { const token = peek(); if (token === '+' || token === '-') { cursor++; return { kind: 'unary', sign: token === '-' ? -1 : 1, child: unary() }; } return power(); });
  const product = (): Node => { let left = unary(); while (cursor < tokens.length) { const token = peek(); const implicit = /^(?:[A-Za-z\d.]|\()/.test(token); if (token !== '*' && token !== '/' && !implicit) break; if (!implicit) cursor++; left = { kind: 'binary', op: implicit ? '*' : token, left, right: unary() }; } return left; };
  const sum = (): Node => { let left = product(); while (peek() === '+' || peek() === '-') { const op = tokens[cursor++]; left = { kind: 'binary', op, left, right: product() }; } return left; };
  const tree = sum(); if (cursor !== tokens.length) throw new Error(`수식의 ${peek()} 부분을 확인해 주세요.`);
  function run(node: Node, vars: Record<string, number>): number {
    switch (node.kind) {
      case 'number': return node.value;
      case 'variable': return own(vars, node.name) ? vars[node.name] : Number.NaN;
      case 'unary': return node.sign * run(node.child, vars);
      case 'call': { const args = node.args.map(arg => run(arg, vars)); return args.every(Number.isFinite) ? functions[node.name].run(...args) : Number.NaN; }
      case 'binary': {
        const a = run(node.left, vars), b = run(node.right, vars);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
        switch (node.op) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; default: return a ** b; }
      }
    }
  }
  const evaluate: Evaluator = vars => { const value = run(tree, vars); return Number.isFinite(value) ? value : Number.NaN; };
  variablesUsed.set(evaluate, used);
  return cached(compiled, expression, evaluate, 128);
}

export function validatePlotExpression(plot: PlotObject): string | null {
  if (!['cartesian', 'parametric', 'polar'].includes(plot.mode)) return '그래프 종류를 확인해 주세요.';
  if (![plot.xMin, plot.xMax].every(v => Number.isFinite(v) && Math.abs(v) <= 1e6) || plot.xMin >= plot.xMax) return '범위의 시작은 끝보다 작아야 합니다 (최대 ±1,000,000).';
  if (!plot.parameters || typeof plot.parameters !== 'object' || Object.keys(plot.parameters).length > 26 || Object.entries(plot.parameters).some(([name, value]) => !/^[a-z]$/.test(name) || ['x', 't', 'e'].includes(name) || !Number.isFinite(value) || Math.abs(value) > 1e6)) return '매개변수는 x, t, e를 제외한 영문 한 글자와 유한한 숫자로 입력해 주세요.';
  if (plot.offset && ![plot.offset.x, plot.offset.y].every(v => Number.isFinite(v) && Math.abs(v) <= 1e6)) return '평행이동 값이 올바르지 않습니다.';
  if (![plot.yMin ?? -10, plot.yMax ?? 10].every(v => Number.isFinite(v) && Math.abs(v) <= 1e6) || (plot.yMin ?? -10) >= (plot.yMax ?? 10)) return '표시할 y 범위의 시작은 끝보다 작아야 합니다.';
  try {
    const expressions = [compileExpression(plot.expression)]; if (plot.mode === 'parametric') expressions.push(compileExpression(plot.xExpression));
    for (const expression of expressions) for (const name of variablesUsed.get(expression) ?? []) if (!['x', 't'].includes(name) && !own(plot.parameters, name)) return `매개변수 ${name}의 값을 입력해 주세요.`;
    return null;
  }
  catch (error) { return error instanceof Error ? error.message : '수식을 확인해 주세요.'; }
}

function evaluator(plot: PlotObject): ((parameter: number) => Vec | null) | null {
  if (validatePlotExpression(plot)) return null;
  const y = compileExpression(plot.expression), x = plot.mode === 'parametric' ? compileExpression(plot.xExpression) : null;
  return parameter => {
    if (!Number.isFinite(parameter)) return null;
    const variables = { ...plot.parameters, x: parameter, t: parameter }, value = y(variables);
    const point = plot.mode === 'polar' ? { x: value * Math.cos(parameter), y: value * Math.sin(parameter) } : { x: x ? x(variables) : parameter, y: value };
    point.x += plot.offset?.x ?? 0; point.y += plot.offset?.y ?? 0;
    return Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 1e6 && Math.abs(point.y) <= 1e6 ? point : null;
  };
}

/** Parameter is x for Cartesian graphs and t (radians) for parametric/polar graphs. */
export function evaluatePlot(plot: PlotObject, actualParameter: number): Vec | null { return evaluator(plot)?.(actualParameter) ?? null; }

const samples = new Map<string, Vec[][]>();
/** Adaptive finite samples; unresolved discontinuities become separate paths. Work is bounded. */
export function samplePlot(plot: PlotObject): Vec[][] {
  const key = JSON.stringify([plot.mode, plot.expression, plot.xExpression, plot.xMin, plot.xMax, Object.entries(plot.parameters ?? {}).sort(), plot.offset, plot.yMin, plot.yMax]);
  const previous = samples.get(key); if (previous) return previous;
  const evaluate = evaluator(plot); if (!evaluate) return cached(samples, key, [], 32);
  const segments: Vec[][] = []; let current: Vec[] = [], evaluations = 0, outputCount = 0;
  const read = (t: number) => ++evaluations <= 8192 ? evaluate(t) : null;
  const stop = () => { if (current.length > 1) segments.push(current); current = []; };
  const append = (point: Vec | null) => {
    if (!point || outputCount >= 4096) { stop(); return; }
    const last = current.at(-1); if (!last || last.x !== point.x || last.y !== point.y) { current.push(point); outputCount++; }
  };
  const interval = (a: number, b: number, p: Vec | null, q: Vec | null, level: number): void => {
    if (outputCount >= 4096 || evaluations >= 8192) { stop(); return; }
    const mid = (a + b) / 2, m = read(mid);
    if (!p && !q && !m) { stop(); return; }
    const error = p && q && m ? Math.hypot(m.x - (p.x + q.x) / 2, m.y - (p.y + q.y) / 2) : Infinity;
    const magnitude = (v: Vec) => plot.mode === 'cartesian' ? Math.abs(v.y - (plot.offset?.y ?? 0)) : Math.hypot(v.x - (plot.offset?.x ?? 0), v.y - (plot.offset?.y ?? 0));
    const scale = p && q && m ? Math.max(1, Math.min(magnitude(p), magnitude(q), magnitude(m))) : 1;
    if ((!p || !q || !m || error > .0025 * scale) && level < 10) {
      interval(a, mid, p, m, level + 1); interval(mid, b, m, q, level + 1); return;
    }
    if (!p || !q || !m || error > .02 * scale) { append(p); stop(); append(q); return; }
    append(p); append(q);
  };
  let a = plot.xMin, p = read(a);
  for (let i = 1; i <= 256 && outputCount < 4096; i++) { const b = plot.xMin + (plot.xMax - plot.xMin) * i / 256, q = read(b); interval(a, b, p, q, 0); a = b; p = q; }
  stop();
  const low = (plot.yMin ?? -10) + (plot.offset?.y ?? 0), high = (plot.yMax ?? 10) + (plot.offset?.y ?? 0);
  const clipped: Vec[][] = []; let count = 0;
  for (const segment of segments) {
    let path: Vec[] = [];
    const flush = () => { if (path.length > 1) clipped.push(path); path = []; };
    for (let i = 1; i < segment.length && count < 4094; i++) {
      const a = segment[i - 1], b = segment[i], dy = b.y - a.y;
      let from = 0, to = 1;
      if (dy === 0) { if (a.y < low || a.y > high) { flush(); continue; } }
      else { const t1 = (low - a.y) / dy, t2 = (high - a.y) / dy; from = Math.max(0, Math.min(t1, t2)); to = Math.min(1, Math.max(t1, t2)); }
      if (from > to) { flush(); continue; }
      const at = (t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + dy * t });
      const start = at(from), end = at(to), last = path.at(-1);
      if (last && (Math.abs(last.x - start.x) > 1e-9 || Math.abs(last.y - start.y) > 1e-9)) flush();
      if (!path.length) { path.push(start); count++; }
      path.push(end); count++;
      if (to < 1) flush();
    }
    flush();
  }
  return cached(samples, key, clipped, 32);
}
