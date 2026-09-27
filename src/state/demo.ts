import { DEFAULT_STYLE, emptyScene } from '../core/types';
import type { Scene, SceneObject, Style, Vec } from '../core/types';

const base = (id: string, name: string, style: Partial<Style> = {}) => ({ id, name, visible: true, locked: false, style: { ...DEFAULT_STYLE, ...style } });
const anchor = (pointId: string, p: Vec) => ({ ...p, pointId });
export function demoScene(): Scene {
  const a = { x: -2.1, y: -1.15 }, b = { x: 2.1, y: -1.15 }, c = { x: 0, y: 2.4 };
  const objects: SceneObject[] = [
    { ...base('circumcircle', '외접원', { stroke: '#138a80', strokeWidth: 1.3 }), type: 'circle', center: { x: 0, y: 0 }, radius: 2.4 },
    { ...base('triangle', '삼각형 ABC', { stroke: '#354e79', fill: '#e7eef7', strokeWidth: 1.5 }), type: 'polygon', points: [anchor('pointA', a), anchor('pointB', b), anchor('pointC', c)] },
    { ...base('radius', '반지름', { stroke: '#91a2b6', dash: 'dashed', strokeWidth: 0.9 }), type: 'line', points: [{ x: 0, y: 0 }, anchor('pointC', c)] },
    { ...base('pointA', '점 A', { fill: '#354e79' }), type: 'point', position: a },
    { ...base('pointB', '점 B', { fill: '#354e79' }), type: 'point', position: b },
    { ...base('pointC', '점 C', { fill: '#138a80' }), type: 'point', position: c },
    { ...base('pointO', '중심 O', { fill: '#138a80' }), type: 'point', position: { x: 0, y: 0 } },
    { ...base('labelA', 'A'), type: 'math', position: { x: -2.43, y: -1.43 }, text: 'A', fontSize: 16 },
    { ...base('labelB', 'B'), type: 'math', position: { x: 2.43, y: -1.43 }, text: 'B', fontSize: 16 },
    { ...base('labelC', 'C'), type: 'math', position: { x: 0.3, y: 2.65 }, text: 'C', fontSize: 16 },
    { ...base('labelO', 'O'), type: 'math', position: { x: 0.3, y: -0.28 }, text: 'O', fontSize: 15 },
    { ...base('labelR', '반지름 수식', { stroke: '#138a80' }), type: 'math', position: { x: 0.45, y: 1.05 }, text: 'r', fontSize: 16 },
  ];
  return { ...emptyScene(), name: '원과 삼각형', objects };
}
