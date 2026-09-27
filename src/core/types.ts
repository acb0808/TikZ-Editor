export interface Vec { x: number; y: number }
/** A point reference retains a fallback position for portable imports. */
export interface Anchor extends Vec { pointId?: string }
/** Position along a host path. t is normalized to [0,1]; segment selects a polygon edge. */
export interface PathBinding { objectId: string; t: number; segment?: number }
export interface Viewport { x: number; y: number; zoom: number }
export interface Style {
  stroke: string; fill: string; strokeWidth: number; opacity: number;
  dash: 'solid' | 'dashed' | 'dotted'; arrows: 'none' | 'start' | 'end' | 'both';
}
export interface ObjectBase { id: string; name: string; visible: boolean; locked: boolean; style: Style }
export type SceneObject = ObjectBase & (
  | { type: 'point'; position: Vec; binding?: PathBinding }
  | { type: 'line' | 'arrow' | 'rectangle' | 'polygon'; points: Anchor[] }
  | { type: 'circle'; center: Anchor; radius: number }
  | { type: 'arc' | 'sector'; center: Anchor; radius: number; startAngle: number; sweepAngle: number }
  | { type: 'plot'; mode: 'cartesian' | 'parametric' | 'polar'; expression: string; xExpression: string; xMin: number; xMax: number; parameters: Record<string, number>; offset?: Vec; yMin?: number; yMax?: number }
  | { type: 'text' | 'math'; position: Anchor; text: string; fontSize: number }
);
export type ObjectType = SceneObject['type'];
export type ToolId = 'select' | 'hand' | 'split' | Exclude<ObjectType, 'plot' | 'arc' | 'sector'>;
export type PlotObject = Extract<SceneObject, { type: 'plot' }>;
export type PointObject = Extract<SceneObject, { type: 'point' }>;
export type ArcObject = Extract<SceneObject, { type: 'arc' | 'sector' }>;
export type SourceEntry =
  | { kind: 'raw'; raw: string; reason?: string; line?: number; pointDeclaration?: { objectId: string; position: Vec; name: string } }
  | { kind: 'object'; objectId: string; raw?: string; signature?: string };
export interface SceneSettings { grid: boolean; axes: boolean; snap: boolean; gridSize: number }
export interface Scene {
  version: '1.0'; name: string; objects: SceneObject[]; source: SourceEntry[]; settings: SceneSettings;
}
export interface Project { version: '1.0'; scene: Scene; viewport: Viewport }
export interface Diagnostic { line: number; message: string; severity: 'warning' | 'error' }
export interface ParseResult { scene: Scene; diagnostics: Diagnostic[] }
export const DEFAULT_STYLE: Style = { stroke: '#243b53', fill: 'none', strokeWidth: 1.2, opacity: 1, dash: 'solid', arrows: 'none' };
export const DEFAULT_SETTINGS: SceneSettings = { grid: true, axes: true, snap: true, gridSize: 0.5 };
export const emptyScene = (): Scene => ({ version: '1.0', name: '이름 없는 도면', objects: [], source: [], settings: { ...DEFAULT_SETTINGS } });
export const uid = (): string => `o${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
