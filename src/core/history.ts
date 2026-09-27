import type { Scene, SceneObject } from './types';
type Metadata = Omit<Scene, 'objects'>;
export interface SceneChange {
  label: string;
  objects: { id: string; before?: SceneObject; after?: SceneObject }[];
  order?: { before: string[]; after: string[] };
  metadata?: { before: Partial<Metadata>; after: Partial<Metadata> };
}
const equal = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

export function createChange(before: Scene, after: Scene, label: string): SceneChange | null {
  const oldObjects = new Map(before.objects.map(object => [object.id, object]));
  const newObjects = new Map(after.objects.map(object => [object.id, object]));
  const ids = new Set([...oldObjects.keys(), ...newObjects.keys()]);
  const changes: SceneChange['objects'] = [];
  for (const id of ids) {
    const oldObject = oldObjects.get(id);
    const newObject = newObjects.get(id);
    if (!equal(oldObject, newObject)) changes.push({ id, ...(oldObject ? { before: structuredClone(oldObject) } : {}), ...(newObject ? { after: structuredClone(newObject) } : {}) });
  }
  const change: SceneChange = { label, objects: changes };
  const beforeOrder = [...oldObjects.keys()];
  const afterOrder = [...newObjects.keys()];
  if (!equal(beforeOrder, afterOrder)) change.order = { before: beforeOrder, after: afterOrder };
  const oldMetadata: Partial<Metadata> = {};
  const newMetadata: Partial<Metadata> = {};
  for (const key of ['version', 'name', 'source', 'settings'] as const) {
    if (!equal(before[key], after[key])) {
      Object.assign(oldMetadata, { [key]: structuredClone(before[key]) });
      Object.assign(newMetadata, { [key]: structuredClone(after[key]) });
    }
  }
  if (Object.keys(oldMetadata).length) change.metadata = { before: oldMetadata, after: newMetadata };
  return changes.length || change.order || change.metadata ? change : null;
}

export function applyChange(scene: Scene, change: SceneChange, direction: 'undo' | 'redo'): Scene {
  const side = direction === 'undo' ? 'before' : 'after';
  const objects = new Map(scene.objects.map(object => [object.id, object]));
  for (const edit of change.objects) {
    const object = edit[side];
    if (object) objects.set(edit.id, structuredClone(object));
    else objects.delete(edit.id);
  }
  const order = change.order?.[side] ?? [...objects.keys()];
  return { ...scene, ...(change.metadata ? structuredClone(change.metadata[side]) : {}), objects: order.flatMap(id => objects.has(id) ? [objects.get(id)!] : []) };
}
