import type { Project, Scene, Viewport } from '../core/types';
import { validateProject } from '../core/validation';
export const STORAGE_KEY = 'tikz-studio.project.v1';
export const toProject = (scene: Scene, viewport: Viewport): Project => ({ version: '1.0', scene, viewport });
export function saveLocally(scene: Scene, viewport: Viewport): void { localStorage.setItem(STORAGE_KEY, JSON.stringify(validateProject(toProject(scene, viewport)))); }
export function loadLocally(): Project | null { const raw = localStorage.getItem(STORAGE_KEY); return raw ? validateProject(JSON.parse(raw)) : null; }
export async function readProject(file: File): Promise<Project> {
  if (file.size > 5_000_000) throw new Error('5MB 이하의 프로젝트 파일을 선택해 주세요.');
  try { return validateProject(JSON.parse(await file.text())); } catch (error) { if (error instanceof SyntaxError) throw new Error('올바른 JSON 파일이 아닙니다.'); throw error; }
}
export function download(content: BlobPart, filename: string, type = 'text/plain;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function filename(scene: Scene): string { return scene.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'diagram'; }
