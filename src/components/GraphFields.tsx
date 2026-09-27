import { useEffect, useMemo, useState } from 'react';
import { Check, FunctionSquare, RotateCcw } from 'lucide-react';
import type { PlotObject } from '../core/types';
import { samplePlot, validatePlotExpression } from '../core/plot';
import { NumberField } from './Field';
import { useEditor } from '../state/editor';

const presets: { label: string; mode: PlotObject['mode']; expression: string; xExpression: string; xMin: number; xMax: number }[] = [
  { label: '포물선', mode: 'cartesian', expression: 'a*x^2+b*x+c', xExpression: 't', xMin: -5, xMax: 5 },
  { label: '사인파', mode: 'cartesian', expression: 'a*sin(x)+b', xExpression: 't', xMin: -6.28, xMax: 6.28 },
  { label: '반비례', mode: 'cartesian', expression: 'a/x', xExpression: 't', xMin: -5, xMax: 5 },
  { label: '매개변수 원', mode: 'parametric', expression: 'a*sin(t)', xExpression: 'a*cos(t)', xMin: 0, xMax: 2 * Math.PI },
  { label: '극좌표 꽃', mode: 'polar', expression: '2*cos(3*t)', xExpression: 't', xMin: 0, xMax: 2 * Math.PI },
];

export function PlotPreview({ plot }: { plot: PlotObject }) {
  const paths = useMemo(() => {
    if (validatePlotExpression(plot)) return [];
    return samplePlot(plot);
  }, [plot]);
  const points = paths.flat();
  if (!points.length) return <div className="plot-preview empty">식을 입력하면 여기에 그래프가 나타납니다</div>;
  const ys = points.map(p => p.y).sort((a, b) => a - b);
  const minX = Math.min(0, ...points.map(p => p.x)), maxX = Math.max(0, ...points.map(p => p.x));
  const minY = Math.min(0, ys[Math.floor(ys.length * .03)]), maxY = Math.max(0, ys[Math.floor((ys.length - 1) * .97)]);
  const scale = Math.min(332 / Math.max(1, maxX - minX), 138 / Math.max(1, maxY - minY));
  const x = (n: number) => 190 + (n - (minX + maxX) / 2) * scale;
  const y = (n: number) => 90 - (n - (minY + maxY) / 2) * scale;
  return <svg className="plot-preview" viewBox="0 0 380 180" aria-label="그래프 미리보기" role="img">
    <path d={`M 0 ${y(0)} H 380 M ${x(0)} 0 V 180`} stroke="#d5e1e9" fill="none"/>
    {paths.map((path, i) => <path key={i} d={path.map((p, j) => `${j ? 'L' : 'M'}${x(p.x).toFixed(2)} ${y(p.y).toFixed(2)}`).join(' ')} fill="none" stroke="#138a80" strokeWidth="2"/>)}
  </svg>;
}

export function GraphForm({ plot, onApply, submitLabel = '수식 적용', showPreview = false }: { plot: PlotObject; onApply: (plot: PlotObject) => void; submitLabel?: string; showPreview?: boolean }) {
  const [draft, setDraft] = useState(plot), [message, setMessage] = useState('');
  useEffect(() => { setDraft(plot); setMessage(''); }, [plot.id, plot.mode, plot.expression, plot.xExpression, plot.xMin, plot.xMax, plot.yMin, plot.yMax]);
  const current = { ...plot, mode: draft.mode, expression: draft.expression, xExpression: draft.xExpression, xMin: draft.xMin, xMax: draft.xMax, yMin: draft.yMin, yMax: draft.yMax };
  const error = validatePlotExpression(current);
  const variable = draft.mode === 'cartesian' ? 'x' : 't';
  const patch = (values: Partial<PlotObject>) => { setDraft(value => ({ ...value, ...values })); setMessage(''); };
  const choosePreset = (preset: typeof presets[number]) => patch({ mode: preset.mode, expression: preset.expression, xExpression: preset.xExpression, xMin: preset.xMin, xMax: preset.xMax });
  return <form className="graph-form" noValidate onSubmit={event => {
    event.preventDefault();
    if (error) { setMessage(error); return; }
    if (!samplePlot(current).some(path => path.length > 1)) { setMessage('이 범위에 그릴 수 있는 점이 없습니다. 식과 범위를 확인해 주세요.'); return; }
    onApply(current); setMessage('');
  }}>
    <div className="graph-presets" aria-label="그래프 예제">{presets.map(preset => <button type="button" key={preset.label} onClick={() => choosePreset(preset)}>{preset.label}</button>)}</div>
    <label className="stack-field">그래프 종류<select aria-label="그래프 종류" value={draft.mode} onChange={e => { const mode = e.target.value as PlotObject['mode']; choosePreset(presets[mode === 'cartesian' ? 0 : mode === 'parametric' ? 3 : 4]); }}><option value="cartesian">함수 y = f(x)</option><option value="parametric">매개변수 x(t), y(t)</option><option value="polar">극좌표 r = f(t)</option></select></label>
    {draft.mode === 'parametric' && <label className="formula-field"><span>x(t) =</span><input aria-label="X 수식" maxLength={500} value={draft.xExpression} onChange={e => patch({ xExpression: e.target.value })} spellCheck={false}/></label>}
    <label className="formula-field"><span>{draft.mode === 'cartesian' ? 'y =' : draft.mode === 'polar' ? 'r =' : 'y(t) ='}</span><input autoComplete="off" aria-label="그래프 수식" maxLength={500} value={draft.expression} onChange={e => patch({ expression: e.target.value })} spellCheck={false}/></label>
    <div className="graph-domain"><NumberField label={`${variable} 최솟값`} value={draft.xMin} min={-1000} max={999} onChange={xMin => patch({ xMin })}/><NumberField label={`${variable} 최댓값`} value={draft.xMax} min={-999} max={1000} onChange={xMax => patch({ xMax })}/></div>
    <details className="graph-range"><summary>세로 표시 범위 ({draft.yMin ?? -10} ~ {draft.yMax ?? 10})</summary><div className="graph-domain"><NumberField label="y 표시 최솟값" value={draft.yMin ?? -10} min={-1000} max={999} onChange={yMin => patch({ yMin })}/><NumberField label="y 표시 최댓값" value={draft.yMax ?? 10} min={-999} max={1000} onChange={yMax => patch({ yMax })}/></div><p className="field-hint">이 범위 안의 곡선을 그리고 내보냅니다. 평행이동 전 좌표 기준입니다.</p></details>
    <p className="field-hint">x²는 x^2 · 곱셈은 2*x 또는 2x<br/>sin, cos, tan, sqrt, abs, exp, ln, log · pi<br/>삼각함수와 극좌표 각도는 라디안입니다.</p>
    {showPreview && <PlotPreview plot={current}/>}
    {(message || error) && <p className="form-error" role="alert">{message || error}</p>}
    <button className="primary-button graph-submit" type="submit"><Check size={14}/>{submitLabel}</button>
  </form>;
}

export function GraphProperties({ object }: { object: PlotObject }) {
  const state = useEditor();
  const changeParameter = (key: string, value: number, preview: boolean) => {
    const next = { ...object, parameters: { ...object.parameters, [key]: value } };
    const scene = { ...state.scene, objects: state.scene.objects.map(o => o.id === object.id ? next : o) };
    if (preview) state.preview(scene); else state.change(scene, `계수 ${key} 변경`);
  };
  return <>
    <section className="property-section"><h3><span><FunctionSquare size={13}/> 수식 그래프</span></h3><GraphForm plot={object} onApply={plot => state.updateObject(object.id, plot, '그래프 수식 변경')}/></section>
    <section className="property-section"><h3>계수 슬라이더 <small>실시간 변화</small></h3>{['a', 'b', 'c'].map(key => <div className="parameter-row" key={key}>
      <NumberField label={`계수 ${key}`} value={object.parameters[key] ?? 0} min={-100} max={100} onChange={value => changeParameter(key, value, false)}/>
      <input aria-label={`${key} 슬라이더`} type="range" min={Math.min(-10, object.parameters[key] ?? 0)} max={Math.max(10, object.parameters[key] ?? 0)} step="0.1" value={object.parameters[key] ?? 0} onPointerDown={state.begin} onChange={e => changeParameter(key, Number(e.target.value), true)} onPointerUp={() => state.commit(`계수 ${key} 변경`)} onPointerCancel={state.cancel} onKeyDown={state.begin} onKeyUp={() => state.commit(`계수 ${key} 변경`)} onBlur={() => state.commit(`계수 ${key} 변경`)}/>
    </div>)}</section>
    <section className="property-section"><h3>평행이동 <small>드래그로 이동 가능</small></h3>
      <NumberField label="이동 X" value={object.offset?.x ?? 0} onChange={x => state.updateObject(object.id, { offset: { x, y: object.offset?.y ?? 0 } })}/>
      <NumberField label="이동 Y" value={object.offset?.y ?? 0} onChange={y => state.updateObject(object.id, { offset: { x: object.offset?.x ?? 0, y } })}/>
      <button className="outline-action" onClick={() => state.updateObject(object.id, { offset: { x: 0, y: 0 } })}><RotateCcw size={13}/>이동 초기화</button>
      <p className="field-hint">입력한 식의 결과를 X·Y만큼 옮깁니다.</p>
    </section>
  </>;
}
