import { Eye, EyeOff, LockKeyhole, LockKeyholeOpen, ArrowUp, ArrowDown, Circle, CircleDot, Minus, MoveUpRight, Pentagon, Square, Type, Sigma, Layers2, FunctionSquare, CircleDashed, PieChart } from 'lucide-react';
import { useEditor } from '../state/editor';
import type { SceneObject } from '../core/types';
const icons = { point: CircleDot, line: Minus, arrow: MoveUpRight, rectangle: Square, circle: Circle, polygon: Pentagon, text: Type, math: Sigma, plot: FunctionSquare, arc: CircleDashed, sector: PieChart };
export function Layers() {
  const state = useEditor(); const { scene, selection } = state;
  const change = (id: string, patch: Partial<SceneObject>) => state.change({ ...scene, objects: scene.objects.map(o => o.id === id ? { ...o, ...patch } as SceneObject : o) }, '레이어 변경');
  const raw = scene.source.some(s => s.kind === 'raw' && s.reason === 'unsupported');
  const reorder = (direction: number) => {
    if (selection.length !== 1 || raw) return;
    const objects = [...scene.objects], i = objects.findIndex(o => o.id === selection[0]), j = i + direction;
    if (j < 0 || j >= objects.length || i < 0 || objects[i].locked) return;
    [objects[i], objects[j]] = [objects[j], objects[i]];
    state.change({ ...scene, objects }, '레이어 순서');
  };
  return <section className="layers" aria-label="레이어 패널">
    <div className="panel-heading"><h2>레이어 <span className="count">{scene.objects.length}</span></h2><Layers2 size={15}/></div>
    <div className="layer-list">{[...scene.objects].reverse().map(o => {
      const Icon = icons[o.type]; return <div data-testid="layer-row" key={o.id} className={`layer-row ${selection.includes(o.id) ? 'selected' : ''} ${!o.visible ? 'hidden-layer' : ''}`}>
        <button className="layer-select" aria-label={`${o.name} 선택`} onClick={e => state.select(e.shiftKey ? selection.includes(o.id) ? selection.filter(id => id !== o.id) : [...selection, o.id] : [o.id])}><Icon size={15}/><span>{o.name}</span></button>
        <button aria-label={`${o.name} ${o.visible ? '숨기기' : '보이기'}`} className="layer-action" onClick={() => change(o.id, { visible: !o.visible })}>{o.visible ? <Eye size={13}/> : <EyeOff size={13}/>}</button>
        <button aria-label={`${o.name} ${o.locked ? '잠금 해제' : '잠금'}`} className={`layer-action ${o.locked ? 'locked' : ''}`} onClick={() => change(o.id, { locked: !o.locked })}>{o.locked ? <LockKeyhole size={13}/> : <LockKeyholeOpen size={13}/>}</button>
      </div>;
    })}{!scene.objects.length && <p className="empty-layers">도구를 선택하고<br/>첫 번째 도형을 그려 보세요.</p>}</div>
    <div className="layer-footer"><span>{selection.length ? `${selection.length}개 선택` : 'Shift로 여러 개 선택'}</span><button aria-label="레이어 앞으로" title={raw ? '미지원 코드가 있어 순서를 보존합니다' : '앞으로'} disabled={raw || selection.length !== 1} onClick={() => reorder(1)}><ArrowUp size={14}/></button><button aria-label="레이어 뒤로" disabled={raw || selection.length !== 1} onClick={() => reorder(-1)}><ArrowDown size={14}/></button></div>
  </section>;
}
