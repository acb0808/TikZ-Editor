import { Copy, LockKeyhole, Trash2, SlidersHorizontal, MousePointer2, Scissors, Link2, Unlink, PieChart } from 'lucide-react';
import { hasUnsupportedSource, useEditor } from '../state/editor';
import { objectAnchors, moveHandle, resolvePoint } from '../core/geometry';
import type { SceneObject, Style } from '../core/types';
import { NumberField } from './Field';
import { GraphProperties } from './GraphFields';
import { isObjectDefined } from '../core/defined';

const names = { point: '점', line: '선분', arrow: '화살표', rectangle: '사각형', circle: '원', polygon: '다각형', text: '텍스트', math: '수학 텍스트', plot: '수식 그래프', arc: '호', sector: '부채꼴' };
const colors = ['#243b53', '#354e79', '#138a80', '#e4a63a', '#de776a', '#8f71b4'];
export function Inspector() {
  const state = useEditor(); const { scene, selection, updateObject } = state;
  const selected = scene.objects.filter(o => selection.includes(o.id)); const object = selected[0];
  const circular = object && (object.type === 'circle' || object.type === 'arc' || object.type === 'sector');
  const defined = !object || isObjectDefined(object, scene.objects);
  const update = (patch: Partial<SceneObject>) => object && updateObject(object.id, patch);
  const style = (patch: Partial<Style>) => {
    state.change({ ...scene, objects: scene.objects.map(o => selection.includes(o.id) && !o.locked ? { ...o, style: { ...o.style, ...patch } } : o) }, '스타일 변경');
  };
  return <aside className="inspector panel" aria-label="속성 패널">
    <div className="panel-heading"><h2>속성</h2><SlidersHorizontal size={15}/></div>
    {!object ? <div className="inspector-empty"><MousePointer2 size={28}/><h3>그림을 선택해 주세요</h3><p>크기와 위치, 색상을<br/>여기에서 바꿀 수 있어요.</p><div className="shortcut-card"><b>빠른 시작</b><span><kbd>V</kbd> 선택 및 이동</span><span><kbd>P</kbd> 점 추가</span><span><kbd>C</kbd> 원 그리기</span><span><kbd>Space</kbd> 화면 이동</span></div></div> : <>
      <div className="object-title"><span className="type-badge">{selected.length > 1 ? `${selected.length}개 선택` : names[object.type]}</span><span className="subtle">{object.locked ? <LockKeyhole size={14}/> : '편집 가능'}</span></div>
      {!defined && <p className="undefined-notice" role="status">현재 수식이나 연결점이 정의되지 않아 숨겨져 있습니다. 기준 값이 유효해지면 다시 나타납니다.</p>}
      {selected.length === 1 && <fieldset disabled={object.locked} className="inspector-fields">
        <label className="stack-field">이름<input aria-label="객체 이름" maxLength={500} value={object.name} onChange={e => update({ name: e.target.value })}/></label>
        {object.type === 'plot' ? <GraphProperties object={object}/> : <section className="property-section"><h3>위치와 크기 <small>cm</small></h3>
          {(defined ? objectAnchors(object, scene.objects) : []).slice(0, circular ? 1 : undefined).map((p, index) => <div className="coordinate-row" key={index}>
            <span className="coordinate-label">{circular ? '중심' : ['line', 'arrow', 'rectangle'].includes(object.type) ? index === 0 ? '시작' : '끝' : `점 ${index + 1}`}</span>
            <NumberField label={`X${index + 1}`} value={p.x} onChange={x => state.change({ ...scene, objects: moveHandle(scene.objects, object.id, index, { x, y: p.y }) }, '좌표 변경')}/>
            <NumberField label={`Y${index + 1}`} value={p.y} onChange={y => state.change({ ...scene, objects: moveHandle(scene.objects, object.id, index, { x: p.x, y }) }, '좌표 변경')}/>
          </div>)}
          {circular && <NumberField label="반지름" value={object.radius} min={0.01} max={1000} suffix="cm" onChange={radius => update({ radius })}/>}
          {(object.type === 'arc' || object.type === 'sector') && <><NumberField label="시작 각도" value={object.startAngle} min={-360} max={360} suffix="°" onChange={startAngle => update({ startAngle })}/><NumberField label="중심각" value={object.sweepAngle} min={-360} max={360} suffix="°" onChange={sweepAngle => update({ sweepAngle: Math.abs(sweepAngle) < 0.1 ? (sweepAngle < 0 ? -0.1 : 0.1) : sweepAngle })}/><p className="field-hint">양의 x축이 0°입니다. 중심각이 양수면 반시계, 음수면 시계방향입니다.</p></>}
        </section>}
        {object.type === 'point' && object.binding && <section className="property-section binding-card"><h3><span><Link2 size={13}/> 도형 위의 점</span></h3><p>{scene.objects.find(o => o.id === object.binding?.objectId)?.name}에 연결되어 있습니다. 드래그하면 도형을 따라 이동합니다.</p><button className="outline-action" onClick={() => update({ position: resolvePoint(object, scene.objects), binding: undefined })}><Unlink size={13}/>연결 해제</button></section>}
        {object.type === 'circle' && <section className="property-section"><h3>도형 편집</h3><button className="outline-action" aria-label="선택한 원 나누기" disabled={hasUnsupportedSource(scene)} onClick={() => state.setTool('split')}><Scissors size={14}/>원 나누기</button><p className="field-hint">둘레의 두 위치를 클릭하면 두 호가 됩니다. 남길 호를 선택해 부채꼴로 닫아 보세요.</p></section>}
        {(object.type === 'arc' || object.type === 'sector') && <section className="property-section"><h3>도형 편집</h3><button className="outline-action" onClick={() => update({ type: object.type === 'arc' ? 'sector' : 'arc', style: { ...object.style, fill: object.type === 'sector' ? 'none' : object.style.fill === 'none' ? '#e7eef7' : object.style.fill } })}><PieChart size={14}/>{object.type === 'arc' ? '부채꼴로 닫기' : '호로 열기'}</button><p className="field-hint">지울 부분을 선택해 Delete를 누르세요. 중심각과 끝점 핸들로 모양을 조절할 수 있습니다.</p></section>}
        {(object.type === 'text' || object.type === 'math') && <section className="property-section"><h3>{object.type === 'math' ? '수식' : '텍스트'}</h3><textarea aria-label="텍스트 내용" maxLength={20000} value={object.text} onChange={e => update({ text: e.target.value })} rows={3}/>{object.type === 'math' && <p className="field-hint">예: x^2, \frac&#123;a&#125;&#123;b&#125;, \alpha</p>}<NumberField label="글자 크기" value={object.fontSize} min={6} max={72} suffix="pt" onChange={fontSize => update({ fontSize })}/></section>}
      </fieldset>}
      <fieldset disabled={selected.every(o => o.locked)} className="inspector-fields"><section className="property-section"><h3>선과 색상</h3>
        <label className="color-field"><span>선 색상</span><input aria-label="선 색상" type="color" value={object.style.stroke === 'none' ? '#000000' : object.style.stroke} onChange={e => style({ stroke: e.target.value })}/><code>{object.style.stroke.toUpperCase()}</code></label>
        <div className="swatches">{colors.map(color => <button key={color} aria-label={`색상 ${color}`} className={object.style.stroke === color ? 'chosen' : ''} style={{ background: color }} onClick={() => style({ stroke: color })}/>)}</div>
        <NumberField label="선 두께" value={object.style.strokeWidth} min={0.1} max={12} suffix="pt" onChange={strokeWidth => style({ strokeWidth })}/>
        <div className="segmented" aria-label="선 모양">{(['solid', 'dashed', 'dotted'] as const).map((dash, i) => <button key={dash} aria-label={['실선', '파선', '점선'][i]} className={object.style.dash === dash ? 'active' : ''} onClick={() => style({ dash })}><svg width="42" height="12"><line x1="2" y1="6" x2="40" y2="6" stroke="currentColor" strokeWidth="2" strokeDasharray={['', '7 4', '2 4'][i]}/></svg></button>)}</div>
        <label className="range-field"><span>불투명도 <b>{Math.round(object.style.opacity * 100)}%</b></span><input aria-label="불투명도" type="range" min="0" max="100" value={Math.round(object.style.opacity * 100)} onPointerDown={state.begin} onChange={e => state.preview({ ...state.scene, objects: state.scene.objects.map(o => selection.includes(o.id) && !o.locked ? { ...o, style: { ...o.style, opacity: Number(e.target.value) / 100 } } : o) })} onPointerUp={() => state.commit('불투명도 변경')} onKeyDown={() => state.begin()} onKeyUp={() => state.commit('불투명도 변경')} onBlur={() => state.commit('불투명도 변경')}/></label>
      </section>
      {!['arc', 'plot', 'line', 'arrow', 'text', 'math'].includes(object.type) && <section className="property-section"><h3>채우기</h3><label className="toggle-field"><span>색 채우기</span><input aria-label="색 채우기" type="checkbox" checked={object.style.fill !== 'none'} onChange={e => style({ fill: e.target.checked ? '#e7eef7' : 'none' })}/></label>{object.style.fill !== 'none' && <label className="color-field"><span>채우기 색상</span><input aria-label="채우기 색상" type="color" value={object.style.fill} onChange={e => style({ fill: e.target.value })}/><code>{object.style.fill.toUpperCase()}</code></label>}</section>}
      {(object.type === 'line' || object.type === 'arrow') && <section className="property-section"><h3>화살표</h3><select aria-label="화살표 방향" value={object.style.arrows} onChange={e => style({ arrows: e.target.value as Style['arrows'] })}><option value="none">없음</option><option value="start">시작점</option><option value="end">끝점</option><option value="both">양쪽</option></select></section>}
      </fieldset>
      <div className="inspector-actions"><button onClick={state.duplicate} disabled={object.locked || hasUnsupportedSource(scene)}><Copy size={14}/> 복제</button><button onClick={state.deleteSelection} disabled={object.locked || (hasUnsupportedSource(scene) && selected.every(o => o.type === 'point'))} title={hasUnsupportedSource(scene) && object.type === 'point' ? '미지원 코드가 참조할 수 있는 점의 선언은 유지합니다' : '선택 객체 삭제'} className="danger"><Trash2 size={14}/> 삭제</button></div>
      <p className="inspector-note">핸들을 드래그하면 도형의 크기와<br/>위치를 직접 바꿀 수 있습니다.</p>
    </>}
  </aside>;
}
