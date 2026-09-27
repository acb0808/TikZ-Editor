import { useMemo } from 'react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import katex from 'katex';
import { BASE_SCALE, worldToScreen } from '../core/coordinates';
import { resolveAnchor, resolvePoint } from '../core/geometry';
import { isObjectDefined } from '../core/defined';
import { samplePlot } from '../core/plot';
import type { SceneObject, Viewport } from '../core/types';
import { arcSvgPath } from './construction';

export interface SceneShapeProps {
  object: SceneObject;
  objects: SceneObject[];
  viewport: Viewport;
  interactive?: boolean;
  onPointerDown?: (event: PointerEvent<SVGGElement>) => void;
}

export function SceneShape({ object, objects, viewport, interactive = false, onPointerDown }: SceneShapeProps) {
  const math = useMemo(() => {
    if (object.type !== 'math' || !interactive) return '';
    try { return katex.renderToString(object.text, { throwOnError: false, trust: false, strict: 'ignore', output: 'html', maxExpand: 200, maxSize: 20 }); }
    catch { return ''; }
  }, [object.type, object.type === 'math' ? object.text : '', interactive]);
  const plotSegments = useMemo(() => {
    if (object.type !== 'plot') return [];
    try { return samplePlot(object); } catch { return []; }
  }, [object]);
  if (!object.visible || !isObjectDefined(object, objects)) return null;
  const scale = BASE_SCALE * viewport.zoom;
  const strokeWidth = Math.max(0.1, object.style.strokeWidth * 4 / 3 * viewport.zoom);
  const dash = object.style.dash === 'dashed' ? `${6 * viewport.zoom} ${4 * viewport.zoom}` : object.style.dash === 'dotted' ? `${1 * viewport.zoom} ${4 * viewport.zoom}` : undefined;
  const common = { stroke: object.style.stroke, strokeWidth, fill: object.style.fill, strokeDasharray: dash, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, opacity: object.style.opacity };
  const markerId = `arrow-${object.id}`;
  const arrows = object.style.arrows;
  const markers = { markerStart: arrows === 'start' || arrows === 'both' ? `url(#${markerId})` : undefined, markerEnd: arrows === 'end' || arrows === 'both' ? `url(#${markerId})` : undefined };
  let shape: ReactNode;
  let hitArea: ReactNode;
  if (object.type === 'point') {
    const p = worldToScreen(resolvePoint(object, objects), viewport);
    shape = <circle cx={p.x} cy={p.y} r={0.055 * BASE_SCALE * viewport.zoom} {...common} />;
    hitArea = <circle cx={p.x} cy={p.y} r={12} fill="transparent" stroke="none" />;
  } else if (object.type === 'circle') {
    const p = worldToScreen(resolveAnchor(object.center, objects), viewport);
    shape = <circle cx={p.x} cy={p.y} r={object.radius * scale} {...common} />;
    hitArea = <circle cx={p.x} cy={p.y} r={Math.max(object.radius * scale, 8)} fill="transparent" stroke="transparent" strokeWidth={12} />;
  } else if (object.type === 'arc' || object.type === 'sector') {
    const d = arcSvgPath(resolveAnchor(object.center, objects), object.radius, object.startAngle, object.sweepAngle, viewport, object.type === 'sector');
    shape = <path d={d} {...common} {...markers} fill={object.type === 'sector' ? object.style.fill : 'none'} />;
    hitArea = <path d={d} fill={object.type === 'sector' ? 'transparent' : 'none'} stroke="transparent" strokeWidth={Math.max(12, strokeWidth + 8)} />;
  } else if (object.type === 'plot') {
    const d = plotSegments.filter(segment => segment.length > 1).map(segment => segment.map((point, index) => {
      const p = worldToScreen(point, viewport);
      return `${index ? 'L' : 'M'} ${Number(p.x.toFixed(6))} ${Number(p.y.toFixed(6))}`;
    }).join(' ')).join(' ');
    shape = <path d={d} {...common} {...markers} fill="none" />;
    hitArea = <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(12, strokeWidth + 8)} />;
  } else if (object.type === 'text' || object.type === 'math') {
    const p = worldToScreen(resolveAnchor(object.position, objects), viewport);
    const fontSize = object.fontSize * 4 / 3 * viewport.zoom;
    const width = Math.max(fontSize * 2, object.text.length * fontSize * 0.64);
    if (object.type === 'math' && interactive && math) {
      const foreignStyle: CSSProperties = { fontSize, color: object.style.stroke, opacity: object.style.opacity, whiteSpace: 'nowrap', lineHeight: 1.3, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', pointerEvents: 'none' };
      shape = <foreignObject x={p.x - width / 2} y={p.y - fontSize * 2.5} width={width} height={fontSize * 5} overflow="visible" pointerEvents="none"><div style={foreignStyle} dangerouslySetInnerHTML={{ __html: math }} /></foreignObject>;
    } else {
      shape = <text data-math={object.type === 'math' ? object.text : undefined} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fill={object.style.stroke} opacity={object.style.opacity} fontSize={fontSize} fontFamily={object.type === 'math' ? 'Georgia, serif' : 'sans-serif'}>{object.type === 'math' && interactive && !math ? '수식 미리보기 오류' : object.text}</text>;
    }
    hitArea = <rect x={p.x - width / 2 - 4} y={p.y - fontSize * 0.9 - 4} width={width + 8} height={fontSize * 1.8 + 8} fill="transparent" />;
  } else if ('points' in object) {
    const points = object.points.map(point => worldToScreen(resolveAnchor(point, objects), viewport));
    if (!points.length) return null;
    const start = points[0];
    const second = points[1] ?? start;
    let d: string;
    if (object.type === 'rectangle') d = `M ${start.x} ${start.y} H ${second.x} V ${second.y} H ${start.x} Z`;
    else d = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ') + (object.type === 'polygon' ? ' Z' : '');
    const closed = object.type === 'rectangle' || object.type === 'polygon';
    shape = <path d={d} {...common} {...markers} fill={closed ? common.fill : 'none'} />;
    hitArea = <path d={d} fill={closed ? 'transparent' : 'none'} stroke="transparent" strokeWidth={Math.max(12, strokeWidth + 8)} />;
  }
  return <g data-testid={`object-${object.id}`} data-object-id={object.id} data-object-type={object.type} aria-label={`${object.name}${object.locked ? ' (잠김)' : ''}`} onPointerDown={onPointerDown} style={interactive ? { cursor: object.locked ? 'default' : 'inherit' } : undefined}>
    {interactive && <title>{`${object.name}${object.locked ? ' · 잠김' : ''}`}</title>}
    {arrows !== 'none' && <defs><marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M 0 1 L 9 5 L 0 9 Z" fill={object.style.stroke} /></marker></defs>}
    {shape}
    {interactive && !object.locked && hitArea}
  </g>;
}
