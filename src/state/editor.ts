import { create } from 'zustand';
import type { Scene, SceneObject, ToolId, Viewport } from '../core/types';
import { duplicateObjects, removeObjects } from '../core/geometry';
import { applyChange, createChange } from '../core/history';
import type { SceneChange } from '../core/history';
import { demoScene } from './demo';
export const hasUnsupportedSource = (scene: Scene): boolean => scene.source.some(entry => entry.kind === 'raw' && entry.reason === 'unsupported');

interface EditorState {
  scene: Scene; selection: string[]; tool: ToolId; viewport: Viewport;
  past: SceneChange[]; future: SceneChange[]; transaction: Scene | null;
  clipboard: SceneObject[]; clipboardContext: SceneObject[];
  reset: (scene: Scene, viewport?: Viewport) => void;
  select: (ids: string[]) => void; setTool: (tool: ToolId) => void; setViewport: (viewport: Viewport) => void;
  change: (scene: Scene, label: string) => void; begin: () => void; preview: (scene: Scene) => void;
  commit: (label: string) => void; cancel: () => void; undo: () => void; redo: () => void;
  deleteSelection: () => void; duplicate: () => void; copy: () => void; paste: () => void;
  updateObject: (id: string, update: Partial<SceneObject>, label?: string) => void;
}

export const useEditor = create<EditorState>((set, get) => ({
  scene: demoScene(), selection: ['circumcircle'], tool: 'select', viewport: { x: 390, y: 310, zoom: 1.35 },
  past: [], future: [], transaction: null, clipboard: [], clipboardContext: [],
  reset: (scene, viewport) => set({ scene, selection: [], past: [], future: [], transaction: null, tool: 'select', ...(viewport ? { viewport } : {}) }),
  select: (selection) => set({ selection }),
  setTool: (tool) => { get().cancel(); set({ tool: hasUnsupportedSource(get().scene) && tool !== 'select' && tool !== 'hand' ? 'select' : tool }); },
  setViewport: (viewport) => set({ viewport }),
  change: (scene, label) => {
    const state = get();
    const command = createChange(state.transaction ?? state.scene, scene, label);
    if (!command) { set({ transaction: null }); return; }
    set({ scene, past: [...state.past, command].slice(-150), future: [], transaction: null,
      selection: state.selection.filter(id => scene.objects.some(o => o.id === id)) });
  },
  begin: () => { if (!get().transaction) set({ transaction: get().scene }); },
  preview: (scene) => set({ scene }),
  commit: (label) => { const state = get(); if (state.transaction) state.change(state.scene, label); },
  cancel: () => { const state = get(); if (state.transaction) set({ scene: state.transaction, transaction: null }); },
  undo: () => {
    get().cancel(); const state = get(); const command = state.past.at(-1); if (!command) return;
    const scene = applyChange(state.scene, command, 'undo');
    set({ scene, past: state.past.slice(0, -1), future: [...state.future, command], selection: state.selection.filter(id => scene.objects.some(o => o.id === id)) });
  },
  redo: () => {
    get().cancel(); const state = get(); const command = state.future.at(-1); if (!command) return;
    const scene = applyChange(state.scene, command, 'redo');
    set({ scene, future: state.future.slice(0, -1), past: [...state.past, command], selection: state.selection.filter(id => scene.objects.some(o => o.id === id)) });
  },
  deleteSelection: () => {
    const state = get(), opaque = hasUnsupportedSource(state.scene);
    const ids = state.selection.filter(id => { const object = state.scene.objects.find(o => o.id === id); return object && !object.locked && !(opaque && object.type === 'point'); });
    const objects = removeObjects(state.scene.objects, ids), surviving = new Set(objects.map(o => o.id));
    state.change({ ...state.scene, objects, source: state.scene.source.filter(entry => entry.kind === 'raw' ? !entry.pointDeclaration || surviving.has(entry.pointDeclaration.objectId) : surviving.has(entry.objectId)) }, '삭제');
  },
  duplicate: () => {
    const state = get(); if (hasUnsupportedSource(state.scene)) return;
    const copies = duplicateObjects(state.scene.objects, state.selection.filter(id => !state.scene.objects.find(o => o.id === id)?.locked));
    if (!copies.length) return;
    state.change({ ...state.scene, objects: [...state.scene.objects, ...copies] }, '복제'); state.select(copies.map(o => o.id));
  },
  copy: () => { const state = get(); set({ clipboard: state.scene.objects.filter(o => state.selection.includes(o.id)), clipboardContext: state.scene.objects }); },
  paste: () => {
    const state = get(); if (hasUnsupportedSource(state.scene)) return;
    const copies = duplicateObjects(state.clipboardContext, state.clipboard.map(o => o.id));
    if (!copies.length) return;
    state.change({ ...state.scene, objects: [...state.scene.objects, ...copies] }, '붙여넣기'); state.select(copies.map(o => o.id));
  },
  updateObject: (id, update, label = '속성 변경') => {
    const state = get(); if (state.scene.objects.find(o => o.id === id)?.locked) return;
    state.change({ ...state.scene, objects: state.scene.objects.map(o => o.id === id ? { ...o, ...update } as SceneObject : o) }, label);
  },
}));
