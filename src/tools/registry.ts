import { DEFAULT_STYLE, uid } from '../core/types';
import type { Anchor, ObjectType, PathBinding, SceneObject, ToolId } from '../core/types';

export type DrawingObjectType = Exclude<ObjectType, 'plot' | 'arc' | 'sector'>;
export type DrawingObject = Extract<SceneObject, { type: DrawingObjectType }>;

export interface ToolDefinition { id: ToolId; label: string; shortcut: string; hint: string }
export const tools: ToolDefinition[] = [
  { id: 'select', label: '선택', shortcut: 'V', hint: '클릭하여 선택 · 드래그하여 이동 · Shift로 다중 선택' },
  { id: 'hand', label: '이동', shortcut: 'H', hint: '드래그하여 작업지 이동 · 휠로 확대·축소' },
  { id: 'point', label: '점', shortcut: 'P', hint: '위치를 클릭 · 선이나 곡선 가까이 클릭하면 도형 위에 연결된 점 생성' },
  { id: 'line', label: '선분', shortcut: 'L', hint: '시작점에서 끝점까지 드래그하세요 · Shift로 방향 고정' },
  { id: 'arrow', label: '화살표', shortcut: 'A', hint: '시작점에서 끝점까지 드래그하세요 · Shift로 방향 고정' },
  { id: 'circle', label: '원', shortcut: 'C', hint: '중심에서 드래그하여 반지름을 정하세요' },
  { id: 'rectangle', label: '사각형', shortcut: 'R', hint: '대각선으로 드래그하세요 · Shift로 정사각형' },
  { id: 'polygon', label: '다각형', shortcut: 'G', hint: '꼭짓점을 차례로 클릭 · 첫 점 또는 Enter로 완성 · Esc로 취소' },
  { id: 'text', label: '텍스트', shortcut: 'T', hint: '위치를 클릭한 뒤 속성 패널에서 내용을 편집하세요' },
  { id: 'math', label: '수식', shortcut: 'M', hint: '위치를 클릭한 뒤 속성 패널에서 LaTeX 수식을 입력하세요' },
  { id: 'cut', label: '도형 자르기', shortcut: 'X', hint: '도형을 선택한 뒤 자를 선을 가로질러 두 점 지정 · Esc로 취소' },
  { id: 'fill', label: '영역 색칠', shortcut: 'B', hint: '닫힌 도형이나 선으로 둘러싸인 안쪽을 클릭해 채우기' },
  { id: 'perpendicular', label: '수선', shortcut: 'N', hint: '점을 클릭한 뒤 기준 선분을 클릭해 수선 내리기' },
];
export const TOOL_REGISTRY = tools;

export function makeObject(type: DrawingObjectType, anchors: Anchor[], binding?: PathBinding): DrawingObject {
  const first = anchors[0] ?? { x: 0, y: 0 };
  const second = anchors[1] ?? first;
  const base = { id: uid(), name: tools.find(tool => tool.id === type)?.label ?? type, visible: true, locked: false, style: { ...DEFAULT_STYLE } };
  if (type === 'point') return { ...base, type, position: { x: first.x, y: first.y }, ...(binding ? { binding: { ...binding } } : {}), style: { ...base.style, fill: base.style.stroke } };
  if (type === 'circle') return { ...base, type, center: { ...first }, radius: Math.hypot(second.x - first.x, second.y - first.y) };
  if (type === 'text' || type === 'math') return { ...base, type, position: { ...first }, text: type === 'math' ? 'x^{2} + y^{2} = r^{2}' : '텍스트', fontSize: 16 };
  return { ...base, type, points: anchors.map(anchor => ({ ...anchor })), style: { ...base.style, arrows: type === 'arrow' ? 'end' : 'none' } };
}
