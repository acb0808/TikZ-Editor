import { useEffect, useMemo, useState } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { Check, Copy, WrapText, X, Code2, TriangleAlert } from 'lucide-react';
import { generateTikz } from '../tikz/generator';
import { parseTikz } from '../tikz/parser';
import { useEditor } from '../state/editor';
import type { Diagnostic } from '../core/types';
import { validateProject } from '../core/validation';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });
monaco.languages.register({ id: 'tikz' });
monaco.languages.setMonarchTokensProvider('tikz', { tokenizer: { root: [[/%.*$/, 'comment'], [/\\[a-zA-Z@]+/, 'keyword'], [/\$[^$]*\$/, 'string'], [/-?\d+(\.\d+)?/, 'number'], [/[{}[\]()]/, 'delimiter'], [/[a-zA-Z]+(?==)/, 'attribute.name']] } });
monaco.editor.defineTheme('studio', { base: 'vs', inherit: true, rules: [{ token: 'keyword', foreground: '18877E' }, { token: 'comment', foreground: '9AA7B5' }, { token: 'number', foreground: '976547' }, { token: 'string', foreground: '697CB1' }], colors: { 'editor.background': '#fafcfd', 'editorLineNumber.foreground': '#b1bcc9', 'editor.lineHighlightBackground': '#f0f5f7', 'editorGutter.background': '#fafcfd' } });

export default function CodePanel({ onClose, onDirty, notify }: { onClose: () => void; onDirty: (dirty: boolean) => void; notify: (text: string) => void }) {
  const scene = useEditor(s => s.scene), change = useEditor(s => s.change);
  const code = useMemo(() => generateTikz(scene), [scene]);
  const [draft, setDraft] = useState(code), [dirty, setDirty] = useState(false), [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  useEffect(() => { if (!dirty) setDraft(code); }, [code, dirty]);
  const edit = (value: string) => { setDraft(value); const next = value !== code; setDirty(next); onDirty(next); };
  const discard = () => { setDraft(code); setDirty(false); onDirty(false); setDiagnostics([]); };
  const apply = () => {
    if (draft.length > 500000) { notify('TikZ 코드는 50만 자 이하로 나누어 적용해 주세요.'); return; }
    const result = parseTikz(draft); setDiagnostics(result.diagnostics);
    if (result.diagnostics.some(d => d.severity === 'error')) { notify('코드 오류를 수정한 뒤 다시 적용해 주세요.'); return; }
    const next = { ...result.scene, name: scene.name, settings: scene.settings };
    try { validateProject({ version: '1.0', scene: next, viewport: useEditor.getState().viewport }); } catch (error) { notify(error instanceof Error ? error.message : '도면으로 적용할 수 없는 값이 있습니다.'); return; }
    useEditor.getState().setTool('select');
    change(next, 'TikZ 코드 적용');
    setDirty(false); onDirty(false); notify(`도면에 적용했습니다.${scene.objects.some(o => o.type === 'point' && o.binding) ? ' 경로에 연결된 점은 현재 좌표의 자유점으로 적용됩니다.' : ''}${result.diagnostics.length ? ' 아래 코드 진단을 확인해 주세요.' : ''}`);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(draft); notify('TikZ 코드를 복사했습니다.'); } catch { notify('복사하지 못했습니다. 코드에서 Ctrl+A, Ctrl+C를 사용해 주세요.'); } };
  const format = () => {
    if (draft.length > 500000) { notify('TikZ 코드는 50만 자 이하로 나누어 주세요.'); return; }
    const result = parseTikz(draft); setDiagnostics(result.diagnostics);
    if (result.diagnostics.some(d => d.severity === 'error')) return;
    // Only canonicalize mapped objects; untouched raw islands keep their exact bytes.
    edit(generateTikz({ ...result.scene, source: result.scene.source.map(entry => entry.kind === 'object' ? { kind: 'object', objectId: entry.objectId } : entry) }));
  };
  return <section className="code-panel" aria-label="TikZ 코드 편집기">
    <div className="code-heading"><div><Code2 size={17}/><strong>TikZ 코드</strong><span className={`code-state ${dirty ? 'dirty' : ''}`}>{dirty ? '적용 전 변경사항' : '도면과 동기화됨'}</span></div><div className="code-actions"><button title="지원 구문 정리" onClick={format}><WrapText size={14}/><span>정리</span></button><button onClick={copy}><Copy size={14}/><span>복사</span></button>{dirty && <button onClick={discard}>취소</button>}<button className="apply-button" disabled={!dirty} onClick={apply}><Check size={14}/>도면에 적용</button><button aria-label="코드 패널 닫기" disabled={dirty} onClick={onClose}><X size={16}/></button></div></div>
    {dirty && <div className="code-draft-note">코드를 수정하고 있습니다. 도면에 적용하거나 취소하면 그림 편집을 계속할 수 있습니다.</div>}
    {scene.objects.some(o => o.type === 'point' && o.binding) && <div className="code-binding-note">TikZ는 현재 그림을 저장합니다. 코드를 다시 적용하면 도형 위 점의 연결이 풀립니다. 연결 관계는 JSON 프로젝트로 보관하세요.</div>}
    <div className="monaco-wrap"><Editor height="100%" language="tikz" theme="studio" value={draft} onChange={value => edit(value ?? '')} options={{ minimap: { enabled: false }, fontSize: 12, fontFamily: 'Consolas, monospace', scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2, padding: { top: 12 }, wordWrap: 'on', folding: true, lineNumbersMinChars: 3, renderLineHighlight: 'line', ariaLabel: 'TikZ 소스 코드' }}/></div>
    <div className="code-foot"><span>기본 도형 문법 지원 · 실제 LaTeX 컴파일은 포함되지 않습니다</span><span>{draft.split('\n').length} lines · UTF-8</span></div>
    {diagnostics.length > 0 && <div className="diagnostics">{diagnostics.map((d, i) => <div key={i} className={d.severity}><TriangleAlert size={12}/><span>{d.line}행 · {d.message}</span></div>)}</div>}
  </section>;
}
