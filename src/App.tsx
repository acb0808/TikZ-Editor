import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Braces, ChevronDown, Code2, Download, FilePlus2, FolderOpen, HelpCircle, Magnet, Maximize, Minus, Plus, Redo2, Save, Undo2, X, Grid2X2, Axis3D, Check, TriangleAlert, SlidersHorizontal } from 'lucide-react';
import { hasUnsupportedSource, useEditor } from './state/editor';
import { Toolbar, shortcutTools } from './components/Toolbar';
import { Layers } from './components/Layers';
import { Inspector } from './components/Inspector';
import { Canvas } from './canvas/Canvas';
import { GraphDialog } from './components/GraphDialog';
import { boundsOf } from './core/geometry';
import { BASE_SCALE } from './core/coordinates';
import { emptyScene } from './core/types';
import type { Vec } from './core/types';
import { download, filename, loadLocally, readProject, saveLocally, toProject } from './io/project';
import { generateTikz, standaloneTex } from './tikz/generator';
const CodePanel = lazy(() => import('./components/CodePanel'));

export default function App() {
  const state = useEditor();
  const [showCode, setShowCode] = useState(true), [codeDirty, setCodeDirty] = useState(false), [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState(''), [saveStatus, setSaveStatus] = useState('이 브라우저에 자동 저장'), [help, setHelp] = useState(false), [newDialog, setNewDialog] = useState(false);
  const [cursor, setCursor] = useState<Vec>({ x: 0, y: 0 });
  const [showInspector, setShowInspector] = useState(false);
  const [graphDialog, setGraphDialog] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null), canvasRef = useRef<HTMLDivElement>(null), hydrated = useRef(false), autosaveEnabled = useRef(true);
  const notify = useCallback((text: string) => setToast(text), []);
  const openGraph = useCallback(() => { const s = useEditor.getState(); if (hasUnsupportedSource(s.scene)) return; s.setTool('select'); setGraphDialog(true); }, []);
  useEffect(() => {
    let frame = 0;
    try { const project = loadLocally(); if (project) useEditor.getState().reset(project.scene, project.viewport);
      else frame = requestAnimationFrame(() => {
        const area = canvasRef.current?.getBoundingClientRect(); if (!area) return;
        const s = useEditor.getState(), zoom = Math.min(1.35, Math.max(0.35, Math.min((area.width - 85) / (5.5 * BASE_SCALE), (area.height - 100) / (5.5 * BASE_SCALE))));
        s.setViewport({ x: area.width / 2, y: area.height / 2, zoom });
      });
    } catch { autosaveEnabled.current = false; setSaveStatus('자동 저장 중지 · 파일로 저장하세요'); notify('저장된 도면을 읽지 못했습니다. 원본을 보존하려고 자동 저장을 중지했습니다.'); }
    hydrated.current = true;
    return () => cancelAnimationFrame(frame);
  }, [notify]);
  useEffect(() => {
    if (!hydrated.current || state.transaction || !autosaveEnabled.current) return;
    const timer = window.setTimeout(() => { try { saveLocally(state.scene, state.viewport); setSaveStatus('이 브라우저에 자동 저장'); } catch { setSaveStatus('자동 저장 실패 · 파일로 저장하세요'); } }, 450);
    return () => window.clearTimeout(timer);
  }, [state.scene, state.viewport, state.transaction]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 4200); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (codeDirty || target.closest('input,textarea,select,[contenteditable="true"],.monaco-editor') || help || newDialog || graphDialog) return;
      const s = useEditor.getState(), key = event.key.toLowerCase();
      // A held pointer owns its transaction. Escape cancels it in Canvas.
      if (s.transaction) { if (event.ctrlKey || event.metaKey || key === 'delete' || key === 'backspace') event.preventDefault(); return; }
      if (event.ctrlKey || event.metaKey) {
        if (['z', 'y', 'a', 'c', 'v', 'd', 's'].includes(key)) event.preventDefault();
        if (key === 'z') event.shiftKey ? s.redo() : s.undo();
        if (key === 'y') s.redo();
        if (key === 'a') s.select(s.scene.objects.filter(o => o.visible && !o.locked).map(o => o.id));
        if (key === 'c') { s.copy(); notify('선택한 객체를 복사했습니다.'); }
        if (key === 'v') s.paste();
        if (key === 'd') s.duplicate();
        if (key === 's') { download(JSON.stringify(toProject(s.scene, s.viewport), null, 2), `${filename(s.scene)}.json`, 'application/json'); notify('프로젝트를 저장했습니다.'); }
        return;
      }
      if (key === 'delete' || key === 'backspace') { event.preventDefault(); s.deleteSelection(); }
      if (shortcutTools[key]) s.setTool(shortcutTools[key]);
      if (key === 'f') openGraph();
      if (key === 'escape') { s.cancel(); setExportOpen(false); }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, [codeDirty, notify, help, newDialog, graphDialog, openGraph]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (codeDirty) event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [codeDirty]);
  const fit = () => {
    const box = boundsOf(state.scene.objects.filter(o => o.visible), state.scene.objects), area = canvasRef.current?.getBoundingClientRect(); if (!area) return;
    if (!box) { state.setViewport({ x: area.width / 2, y: area.height / 2, zoom: 1 }); return; }
    const zoom = Math.min(3, Math.max(0.1, Math.min((area.width - 120) / Math.max(1, box.maxX - box.minX) / BASE_SCALE, (area.height - 100) / Math.max(1, box.maxY - box.minY) / BASE_SCALE)));
    state.setViewport({ x: area.width / 2 - (box.minX + box.maxX) / 2 * BASE_SCALE * zoom, y: area.height / 2 + (box.minY + box.maxY) / 2 * BASE_SCALE * zoom, zoom });
  };
  const zoom = (factor: number) => {
    const area = canvasRef.current?.getBoundingClientRect(); if (!area) return;
    const next = Math.min(10, Math.max(0.1, state.viewport.zoom * factor)), ratio = next / state.viewport.zoom;
    state.setViewport({ x: area.width / 2 + (state.viewport.x - area.width / 2) * ratio, y: area.height / 2 + (state.viewport.y - area.height / 2) * ratio, zoom: next });
  };
  const exportFile = async (type: 'tikz' | 'tex' | 'svg' | 'png' | 'copy') => {
    setExportOpen(false);
    try {
      if (type === 'copy') { await navigator.clipboard.writeText(generateTikz(state.scene)); notify('TikZ 코드를 복사했습니다.'); return; }
      if (type === 'tex' || type === 'tikz') download(type === 'tex' ? standaloneTex(state.scene) : generateTikz(state.scene), `${filename(state.scene)}.${type === 'tex' ? 'tex' : 'tikz'}`);
      else { const module = await import('./io/export'); await module.exportImage(state.scene, type); }
      notify(`${type.toUpperCase()} 파일을 내보냈습니다.`);
    } catch (error) { notify(error instanceof Error ? error.message : '내보내지 못했습니다. 다시 시도해 주세요.'); }
  };
  const unsupported = state.scene.source.filter(entry => entry.kind === 'raw' && entry.reason === 'unsupported').length;
  return <main className="app-shell">
    <header className="topbar" inert={graphDialog || help || newDialog}><div className="brand"><span className="brand-mark"><Braces size={22}/></span><span>TikZ<span className="brand-light"> Studio</span><small>수학을 그리다</small></span></div>
      <div className="document-name" inert={codeDirty}><input aria-label="도면 이름" maxLength={500} value={state.scene.name} onChange={e => state.change({ ...state.scene, name: e.target.value }, '도면 이름')}/><span className="local-badge">LOCAL</span></div>
      <div className="top-actions"><span className="save-status"><span/>{saveStatus}</span><button className="icon-button" aria-label="사용 방법" title="사용 방법" onClick={() => setHelp(true)}><HelpCircle size={18}/></button><div className="export-wrap"><button className="primary-button" disabled={codeDirty} aria-expanded={exportOpen} onClick={() => setExportOpen(!exportOpen)}><Download size={15}/>내보내기<ChevronDown size={13}/></button>{exportOpen && <><button className="menu-backdrop" aria-label="내보내기 메뉴 닫기" onClick={() => setExportOpen(false)}/><div className="export-menu"><strong>그림을 가져가세요</strong><button onClick={() => exportFile('copy')}>TikZ 코드 복사 <span>클립보드</span></button><button onClick={() => exportFile('tex')}>LaTeX 문서 <span>.tex</span></button><button onClick={() => exportFile('tikz')}>TikZ 그림 <span>.tikz</span></button><hr/><button onClick={() => exportFile('svg')}>벡터 이미지 <span>.svg</span></button><button onClick={() => exportFile('png')}>고해상도 이미지 <span>.png</span></button>{unsupported > 0 && <p>이미지에는 편집 가능한 도형만 포함됩니다. 미지원 코드는 TikZ·JSON에 보존됩니다.</p>}</div></>}</div></div>
    </header>
    <div className="workspace-toolbar" inert={codeDirty || graphDialog || help || newDialog}><div className="file-actions"><button title="새 도면" aria-label="새 도면" onClick={() => setNewDialog(true)}><FilePlus2 size={15}/></button><button title="프로젝트 열기" aria-label="프로젝트 열기" onClick={() => inputRef.current?.click()}><FolderOpen size={16}/></button><button title="프로젝트 저장" aria-label="프로젝트 저장" onClick={() => { download(JSON.stringify(toProject(state.scene, state.viewport), null, 2), `${filename(state.scene)}.json`, 'application/json'); notify('프로젝트를 저장했습니다.'); }}><Save size={15}/></button><i/><button aria-label="실행 취소" title="실행 취소 (Ctrl+Z)" disabled={!state.past.length} onClick={state.undo}><Undo2 size={16}/></button><button aria-label="다시 실행" title="다시 실행 (Ctrl+Shift+Z)" disabled={!state.future.length} onClick={state.redo}><Redo2 size={16}/></button></div>
      <div className="view-actions"><button className={state.scene.settings.grid ? 'on' : ''} aria-label="격자" aria-pressed={state.scene.settings.grid} onClick={() => state.change({ ...state.scene, settings: { ...state.scene.settings, grid: !state.scene.settings.grid } }, '격자 표시')}><Grid2X2 size={14}/><span>격자</span></button><button className={state.scene.settings.axes ? 'on' : ''} aria-label="좌표축" aria-pressed={state.scene.settings.axes} onClick={() => state.change({ ...state.scene, settings: { ...state.scene.settings, axes: !state.scene.settings.axes } }, '좌표축 표시')}><Axis3D size={15}/><span>좌표축</span></button><button className={state.scene.settings.snap ? 'on' : ''} aria-label="스냅" aria-pressed={state.scene.settings.snap} onClick={() => state.change({ ...state.scene, settings: { ...state.scene.settings, snap: !state.scene.settings.snap } }, '스냅 설정')}><Magnet size={14}/><span>스냅</span></button><i/><button className={showCode ? 'on' : ''} aria-label="TikZ 코드" aria-pressed={showCode} onClick={() => setShowCode(!showCode)}><Code2 size={16}/><span>TikZ 코드</span></button><button className="mobile-properties" aria-label="속성 패널 열기" onClick={() => setShowInspector(!showInspector)}><SlidersHorizontal size={15}/></button></div>
    </div>
    <div className="workspace"><aside className="left-panel panel" inert={codeDirty || graphDialog || help || newDialog}><Toolbar onGraph={openGraph}/><Layers/><div className="left-note"><span className="tiny-dot"/>로컬 작업 공간<span>v0.3</span></div></aside>
      <div className="center-column" inert={graphDialog || help || newDialog}><div className="canvas-container" ref={canvasRef} inert={codeDirty || help || newDialog || graphDialog}><div className="canvas-caption"><span className="canvas-tag">수학 좌표계</span><span>1 단위 = 1 cm</span></div>
        <Canvas scene={state.scene} selection={state.selection} tool={state.tool} viewport={state.viewport} onSelect={state.select} onTool={state.setTool} onViewport={state.setViewport} onChange={state.change} onBegin={state.begin} onPreview={state.preview} onCommit={state.commit} onCancel={state.cancel} onCursor={setCursor}/>
        {unsupported > 0 && <div className="unsupported-notice"><TriangleAlert size={14}/>{unsupported}개 미지원 구문 보존 중 · 새 도형 추가는 새 도면에서 가능합니다</div>}
        <div className="canvas-bottom"><span className="canvas-tip">{state.tool === 'select' ? '드래그로 이동 · Shift로 여러 개 선택' : state.tool === 'cut' ? '자를 도형을 고른 뒤 절단선을 가로지르도록 두 점 클릭 · Esc 취소' : state.tool === 'fill' ? '닫힌 도형 안쪽이나 선으로 둘러싸인 영역을 클릭' : state.tool === 'perpendicular' ? '점을 찍고 기준 선분을 클릭해 수선을 내리세요 · Esc 취소' : state.tool === 'polygon' ? '꼭짓점 클릭 · Enter로 완성 · Esc로 취소' : state.tool === 'point' ? '도형·끝점·중점·교점 가까이 클릭하면 맞춥니다' : state.tool === 'text' || state.tool === 'math' ? '원하는 위치를 클릭하세요' : '드래그하여 그리기 · Esc로 취소'}</span><div className="zoom-control"><button aria-label="축소" onClick={() => zoom(1 / 1.2)}><Minus size={14}/></button><span>{Math.round(state.viewport.zoom * 100)}%</span><button aria-label="확대" onClick={() => zoom(1.2)}><Plus size={14}/></button><i/><button aria-label="그림에 맞추기" title="그림에 맞추기" onClick={fit}><Maximize size={14}/></button></div></div>
      </div>{showCode && <Suspense fallback={<div className="code-loading">코드 편집기를 여는 중…</div>}><CodePanel onClose={() => setShowCode(false)} onDirty={dirty => { setCodeDirty(dirty); if (dirty) state.setTool('select'); }} notify={notify}/></Suspense>}</div>
      <div className={`inspector-container ${showInspector ? 'mobile-open' : ''}`} inert={codeDirty || graphDialog || help || newDialog}><button className="mobile-properties mobile-close" aria-label="속성 패널 닫기" onClick={() => setShowInspector(false)}><X size={16}/></button><Inspector/></div>
    </div>
    <footer className="statusbar"><span><span className="ready-dot"/> {codeDirty ? '코드 편집 중' : '편집 준비됨'}</span><span>{state.scene.objects.filter(o => o.visible).length}개 객체<span className="status-divider">/</span>선택 {state.selection.length}개</span><span className="status-coordinates">X <b>{cursor.x.toFixed(2)}</b> Y <b>{cursor.y.toFixed(2)}</b><span className="status-divider">|</span>그리드 {state.scene.settings.gridSize} cm</span><span className="status-end">SVG 미리보기 <span className="status-divider">·</span> TikZ 자동 생성</span></footer>
    <input ref={inputRef} hidden type="file" accept=".json,application/json" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try { const project = await readProject(file); state.setTool('select'); state.change(project.scene, '프로젝트 열기'); state.setViewport(project.viewport); state.select([]); notify('프로젝트를 열었습니다. 실행 취소로 이전 도면을 복원할 수 있습니다.'); } catch (error) { notify(error instanceof Error ? error.message : '파일을 열지 못했습니다.'); } }}/>
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}<button aria-label="알림 닫기" onClick={() => setToast('')}><X size={14}/></button></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="modal" role="dialog" aria-modal="true" aria-label="사용 방법" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="닫기" onClick={() => setHelp(false)}><X size={18}/></button><span className="modal-eyebrow">TIKZ STUDIO</span><h2>좌표를 외우지 말고,<br/>그림을 움직여 보세요.</h2><p>왼쪽에서 도구를 선택하고 캔버스에 그립니다. 도형을 선택하면 오른쪽에서 좌표, 색상과 크기를 바꿀 수 있습니다.</p><div className="help-grid"><div><kbd>Space + 드래그</kbd><span>화면 이동</span></div><div><kbd>마우스 휠</kbd><span>포인터 중심 확대</span></div><div><kbd>Ctrl / ⌘ + Z</kbd><span>실행 취소</span></div><div><kbd>Shift + 클릭</kbd><span>여러 객체 선택</span></div><div><kbd>Ctrl / ⌘ + D</kbd><span>선택 객체 복제</span></div><div><kbd>Enter</kbd><span>다각형 완성</span></div></div><p>점 도구는 끝점·중점·교점과 도형에 맞춰집니다. 수선을 만들려면 N을 누른 뒤 기준점을 찍고 선분을 클릭하세요. X로 도형을 자르고 B로 닫힌 영역을 색칠할 수 있습니다. 수식은 오른쪽 입력란에서 작성하세요.</p><p className="help-note">현재 그림은 SVG 미리보기입니다. 임의 TikZ 문법과 실제 LaTeX 컴파일·PDF 출력은 지원 범위에 포함되지 않습니다. 미지원 원문은 프로젝트에 보존됩니다.</p><button className="primary-button" onClick={() => setHelp(false)}>그리기 시작</button></section></div>}
    {newDialog && <div className="modal-backdrop"><section className="modal small-modal" role="dialog" aria-modal="true" aria-label="새 도면 만들기"><h2>새 도면을 만드시겠어요?</h2><p>현재 도면은 실행 취소로 복원할 수 있습니다. 계속 보관하려면 먼저 프로젝트 파일로 저장하세요.</p><div className="dialog-actions"><button onClick={() => setNewDialog(false)}>취소</button><button className="primary-button" onClick={() => { state.change(emptyScene(), '새 도면'); state.select([]); state.setTool('select'); setNewDialog(false); }}>새 도면</button></div></section></div>}
    {graphDialog && <GraphDialog onClose={() => setGraphDialog(false)} onCreate={plot => {
      const s = useEditor.getState();
      const count = s.scene.objects.filter(o => o.type === 'plot').length + 1;
      const next = { ...plot, name: `${plot.mode === 'cartesian' ? '함수' : plot.mode === 'parametric' ? '매개변수 곡선' : '극좌표 곡선'} ${count}` };
      s.change({ ...s.scene, objects: [...s.scene.objects, next] }, '수식 그래프 추가'); s.select([plot.id]);
      setGraphDialog(false); setShowInspector(true); notify('그래프를 추가했습니다. 오른쪽에서 계수를 움직이거나 점을 붙여 보세요.');
    }}/>}
  </main>;
}
