import { useEffect, useState } from 'react';

export function NumberField({ label, value, onChange, min = -10000, max = 10000, step = 0.1, suffix }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string;
}) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(3))));
  const [edited, setEdited] = useState(false);
  useEffect(() => { setDraft(String(Number(value.toFixed(3)))); setEdited(false); }, [value]);
  const commit = () => { if (!edited) return; const n = Number(draft); if (draft.trim() && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); else setDraft(String(value)); setEdited(false); };
  return <label className="number-field"><span>{label}</span><div><input aria-label={label} type="number" step={step} min={min} max={max} value={draft} onChange={e => { setDraft(e.target.value); setEdited(true); }} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}/>{suffix && <small>{suffix}</small>}</div></label>;
}
