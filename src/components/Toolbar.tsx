import { MousePointer2, Hand, CircleDot, Minus, ArrowUpRight, RectangleHorizontal, Circle, Pentagon, Type, Sigma, FunctionSquare, Scissors, Paintbrush, Ruler } from 'lucide-react';
import { hasUnsupportedSource, useEditor } from '../state/editor';
import type { ToolId } from '../core/types';
const tools = [
  { id: 'select', label: '선택', key: 'V', icon: MousePointer2 }, { id: 'hand', label: '화면 이동', key: 'H', icon: Hand },
  { id: 'point', label: '점', key: 'P', icon: CircleDot }, { id: 'line', label: '선분', key: 'L', icon: Minus },
  { id: 'arrow', label: '화살표', key: 'A', icon: ArrowUpRight }, { id: 'rectangle', label: '사각형', key: 'R', icon: RectangleHorizontal },
  { id: 'circle', label: '원', key: 'C', icon: Circle }, { id: 'polygon', label: '다각형', key: 'G', icon: Pentagon },
  { id: 'text', label: '텍스트', key: 'T', icon: Type }, { id: 'math', label: '수식', key: 'M', icon: Sigma },
  { id: 'cut', label: '도형 자르기', key: 'X', icon: Scissors }, { id: 'fill', label: '영역 색칠', key: 'B', icon: Paintbrush },
  { id: 'perpendicular', label: '수선', key: 'N', icon: Ruler },
] as const;
export const shortcutTools: Record<string, ToolId> = Object.fromEntries(tools.map(t => [t.key.toLowerCase(), t.id]));
export function Toolbar({ onGraph }: { onGraph: () => void }) {
  const tool = useEditor(s => s.tool), setTool = useEditor(s => s.setTool);
  const readOnlyContext = useEditor(s => hasUnsupportedSource(s.scene));
  return <section className="tools" aria-label="그리기 도구"><div className="panel-heading"><h2>도구</h2><span className="subtle">DRAW</span></div><div className="tool-grid">{tools.map(({ id, label, key, icon: Icon }) => <button key={id} disabled={readOnlyContext && id !== 'select' && id !== 'hand'} title={`${label} (${key})${readOnlyContext ? ' · 미지원 코드가 있어 새 도형 추가를 제한합니다' : ''}`} aria-label={`${label} (${key})`} aria-pressed={tool === id} className={`tool-button ${tool === id ? 'active' : ''}`} onClick={() => setTool(id)}><Icon size={20} strokeWidth={1.6}/><span>{label}</span><kbd>{key}</kbd></button>)}<button disabled={readOnlyContext} className="tool-button graph-tool" title="함수 그래프 (F)" aria-label="함수 그래프 (F)" onClick={onGraph}><FunctionSquare size={20} strokeWidth={1.6}/><span>함수 그래프</span><kbd>F</kbd></button></div></section>;
}
