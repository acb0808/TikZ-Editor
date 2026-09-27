import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { DEFAULT_STYLE, uid } from '../core/types';
import type { PlotObject } from '../core/types';
import { GraphForm } from './GraphFields';

export function GraphDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (plot: PlotObject) => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const [plot] = useState<PlotObject>(() => ({ id: uid(), name: '함수 그래프', type: 'plot', visible: true, locked: false, style: { ...DEFAULT_STYLE, stroke: '#138a80', strokeWidth: 1.6 }, mode: 'cartesian', expression: 'a*x^2+b*x+c', xExpression: 't', xMin: -5, xMax: 5, parameters: { a: 1, b: 0, c: 0 }, offset: { x: 0, y: 0 } }));
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLInputElement>('input[aria-label="그래프 수식"]')?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary') ?? [])].filter(node => node.offsetParent !== null);
        const current = items.indexOf(document.activeElement as HTMLElement);
        if (items.length && (current < 0 || (e.shiftKey ? current === 0 : current === items.length - 1))) { e.preventDefault(); items[e.shiftKey ? items.length - 1 : 0].focus(); }
      }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, [onClose]);
  return <div className="modal-backdrop"><section ref={dialogRef} className="modal graph-modal" role="dialog" aria-modal="true" aria-label="수식으로 그래프 그리기">
    <button className="modal-close" aria-label="그래프 입력 닫기" onClick={onClose}><X size={18}/></button><span className="modal-eyebrow">EXPLORE MATHEMATICS</span><h2>수식이 그림이 됩니다.</h2>
    <p>함수, 매개변수, 극좌표를 그려 보세요.<br/>추가한 뒤 계수를 움직이고 그래프 위에 점을 붙일 수 있습니다.</p>
    <GraphForm plot={plot} onApply={onCreate} submitLabel="그래프 추가" showPreview/>
  </section></div>;
}
