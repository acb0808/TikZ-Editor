import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from './editor';
import { DEFAULT_STYLE, emptyScene } from '../core/types';
import type { SceneObject } from '../core/types';
import { validateProject } from '../core/validation';

const point: SceneObject = { id: 'a', type: 'point', name: 'A', position: { x: 0, y: 0 }, visible: true, locked: false, style: { ...DEFAULT_STYLE } };
describe('editor transactions', () => {
  beforeEach(() => { useEditor.getState().reset(emptyScene()); });
  it('records creation and reverses it', () => {
    useEditor.getState().change({ ...emptyScene(), objects: [point] }, '점 만들기');
    expect(useEditor.getState().scene.objects).toHaveLength(1);
    useEditor.getState().undo();
    expect(useEditor.getState().scene.objects).toHaveLength(0);
    useEditor.getState().redo();
    expect(useEditor.getState().scene.objects).toEqual([point]);
  });
  it('coalesces a whole drag into one undo and cancels an unfinished drag', () => {
    useEditor.getState().reset({ ...emptyScene(), objects: [point] });
    useEditor.getState().begin();
    for (const x of [1, 2, 3]) useEditor.getState().preview({ ...emptyScene(), objects: [{ ...point, position: { x, y: 0 } }] });
    useEditor.getState().commit('이동');
    expect(useEditor.getState().past).toHaveLength(1);
    useEditor.getState().undo();
    expect(useEditor.getState().scene.objects).toEqual([point]);
    useEditor.getState().begin();
    useEditor.getState().preview(emptyScene());
    useEditor.getState().cancel();
    expect(useEditor.getState().scene.objects).toEqual([point]);
  });
  it('drops redo after a new edit and skips no-ops', () => {
    const a = useEditor.getState(); a.change({ ...emptyScene(), objects: [point] }, '생성');
    a.undo(); a.change({ ...emptyScene(), name: '다른 도면' }, '이름');
    expect(useEditor.getState().future).toHaveLength(0);
    a.change(useEditor.getState().scene, '같은 값');
    expect(useEditor.getState().past).toHaveLength(1);
  });
  it('does not delete locked objects', () => {
    useEditor.getState().reset({ ...emptyScene(), objects: [{ ...point, locked: true }] });
    useEditor.getState().select(['a']); useEditor.getState().deleteSelection();
    expect(useEditor.getState().scene.objects).toHaveLength(1);
  });
  it('removes deleted source bindings and restores them on undo', () => {
    useEditor.getState().reset({ ...emptyScene(), objects: [point], source: [{ kind: 'object', objectId: 'a', raw: '\\coordinate (A) at (0,0);' }] });
    useEditor.getState().select(['a']); useEditor.getState().deleteSelection();
    expect(useEditor.getState().scene.source).toEqual([]);
    expect(() => validateProject({ version: '1.0', scene: useEditor.getState().scene, viewport: { x: 0, y: 0, zoom: 1 } })).not.toThrow();
    useEditor.getState().undo();
    expect(useEditor.getState().scene.source).toHaveLength(1);
  });
  it('preserves unknown code by preventing new copied objects in opaque contexts', () => {
    useEditor.getState().reset({ ...emptyScene(), objects: [point], source: [{ kind: 'raw', raw: '\\tikzset{every path/.style={scale=2}}', reason: 'unsupported' }] });
    useEditor.getState().select(['a']); useEditor.getState().copy(); useEditor.getState().duplicate(); useEditor.getState().paste();
    expect(useEditor.getState().scene.objects).toHaveLength(1);
  });
  it('does not remove a named point declaration used by unsupported code', () => {
    const scene = { ...emptyScene(), objects: [point], source: [{ kind: 'object' as const, objectId: 'a', raw: '\\coordinate (A) at (0,0);' }, { kind: 'raw' as const, raw: '\\draw (A) .. controls (1,1) .. (2,0);', reason: 'unsupported' }] };
    useEditor.getState().reset(scene); useEditor.getState().select(['a']); useEditor.getState().deleteSelection();
    expect(useEditor.getState().scene).toEqual(scene);
  });
});
