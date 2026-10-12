import { useEffect, useState } from 'react';
import type { PdfClient } from '../lib/pdfClient';
import type { FormField, PageInfo } from '../lib/protocol';

interface Props {
  client: PdfClient;
  index: number;
  info: PageInfo;
  zoom: number;
  rev: number;
  onSet: (page: number, id: number, value: string) => Promise<void>;
}

/**
 * PDF 양식의 입력칸 위에 바로 쓸 수 있는 칸을 겹쳐 둔다.
 * 쓰지 않을 때는 글자를 투명하게 해서 PDF에 실제로 들어간 모양이 보이고, 누르면 흰 바탕 입력칸이 된다.
 */
export function FormLayer({ client, index, info, zoom, rev, onSet }: Props) {
  const [fields, setFields] = useState<FormField[]>([]);
  useEffect(() => {
    let off = false;
    client.fields(index).then((f) => { if (!off) setFields(f.filter((x) => !x.readOnly && x.type !== 'signature' && x.type !== 'button')); }).catch(() => undefined);
    return () => { off = true; };
  }, [client, index, rev]);
  if (!fields.length) return null;
  const box = (f: FormField) => ({ left: f.rect[0] * zoom, top: f.rect[1] * zoom, width: (f.rect[2] - f.rect[0]) * zoom, height: (f.rect[3] - f.rect[1]) * zoom });
  return (
    <div className="formlayer" style={{ width: info.width * zoom, height: info.height * zoom }}>
      {fields.map((f) => {
        const label = f.label || f.name;
        if (f.type === 'checkbox' || f.type === 'radiobutton') {
          return (
            <button
              key={f.id}
              className={`ffield fcheck${f.on ? ' on' : ''}`}
              style={box(f)}
              role={f.type === 'checkbox' ? 'checkbox' : 'radio'}
              aria-checked={f.on}
              aria-label={label}
              title={label}
              onClick={() => onSet(index, f.id, f.type === 'radiobutton' ? 'on' : f.on ? 'off' : 'on')}
            />
          );
        }
        if (f.type === 'combobox' || f.type === 'listbox') {
          return (
            <select key={f.id} className="ffield fselect" style={{ ...box(f), fontSize: Math.min(14, (f.rect[3] - f.rect[1]) * 0.65) * zoom }} value={f.value} aria-label={label} title={label} onChange={(e) => onSet(index, f.id, e.target.value)}>
              {!f.options.includes(f.value) && <option value={f.value}>{f.value}</option>}
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          );
        }
        return <TextField key={f.id + ':' + f.value} f={f} style={box(f)} zoom={zoom} label={label} onCommit={(v) => onSet(index, f.id, v)} />;
      })}
    </div>
  );
}

function TextField({ f, style, zoom, label, onCommit }: { f: FormField; style: React.CSSProperties; zoom: number; label: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(f.value);
  const h = f.rect[3] - f.rect[1];
  const fontSize = (f.multiline ? Math.min(11, h * 0.6) : Math.min(12, h * 0.7)) * zoom;
  const commit = () => { if (v !== f.value) onCommit(v); };
  const common = {
    className: `ffield ftext${f.comb ? ' comb' : ''}`,
    style: { ...style, fontSize, ...(f.comb && f.maxLen ? { letterSpacing: `${((f.rect[2] - f.rect[0]) / f.maxLen) * zoom - fontSize * 0.6}px`, paddingLeft: ((f.rect[2] - f.rect[0]) / f.maxLen) * zoom * 0.3 } : {}) },
    value: v,
    maxLength: f.maxLen > 0 ? f.maxLen : undefined,
    'aria-label': label,
    title: label,
    spellCheck: false,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: commit,
  };
  return f.multiline
    ? <textarea {...common} />
    : <input {...common} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) (e.target as HTMLInputElement).blur(); }} />;
}
