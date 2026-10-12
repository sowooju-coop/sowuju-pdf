// PDF 안에 들어 있는 부분 글꼴(TrueType)을 브라우저에서 쓸 수 있는 글꼴로 다시 묶는다.
// 한글(HWP)·워드에서 만든 PDF의 글꼴에는 글자 표(cmap)·이름 표 등이 빠져 있어 브라우저가 거부하므로,
// PDF의 ToUnicode 정보로 글자 표를 새로 만들고 빠진 표를 채운다. 글리프(모양)는 원래 것 그대로.

const tag = (s: string) => (s.charCodeAt(0) << 24 | s.charCodeAt(1) << 16 | s.charCodeAt(2) << 8 | s.charCodeAt(3)) >>> 0;
const tagStr = (n: number) => String.fromCharCode(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

class W {
  private b: number[] = [];
  u8(v: number) { this.b.push(v & 255); return this; }
  u16(v: number) { return this.u8(v >> 8).u8(v); }
  i16(v: number) { return this.u16(v < 0 ? v + 65536 : v); }
  u32(v: number) { return this.u16(v >>> 16).u16(v & 65535); }
  bytes(a: ArrayLike<number>) { for (let i = 0; i < a.length; i++) this.b.push(a[i]); return this; }
  get length() { return this.b.length; }
  out() { return Uint8Array.from(this.b); }
}

/** 글자표 형식 4 (기본 다국어 평면). 글자마다 한 구간 */
function cmap4(map: Map<number, number>) {
  const codes = [...map.keys()].filter((c) => c < 0xffff).sort((a, b) => a - b);
  const segs = [...codes.map((c) => ({ s: c, e: c, d: (map.get(c)! - c + 65536) % 65536 })), { s: 0xffff, e: 0xffff, d: 1 }];
  const n = segs.length;
  let pow = 1, log = 0;
  while (pow * 2 <= n) { pow *= 2; log++; }
  const sub = new W();
  sub.u16(4).u16(16 + n * 8).u16(0).u16(n * 2).u16(pow * 2).u16(log).u16(n * 2 - pow * 2);
  segs.forEach((g) => sub.u16(g.e));
  sub.u16(0);
  segs.forEach((g) => sub.u16(g.s));
  segs.forEach((g) => sub.u16(g.d));
  segs.forEach(() => sub.u16(0));
  const t = new W();
  t.u16(0).u16(1).u16(3).u16(1).u32(12).bytes(sub.out());
  return t.out();
}

function nameTable(family: string) {
  const recs: [number, string][] = [[1, family], [2, 'Regular'], [4, family], [6, family.replace(/[^A-Za-z0-9-]/g, '') || 'Font']];
  const strs = recs.map(([, s]) => { const w = new W(); for (const ch of s) w.u16(ch.charCodeAt(0)); return w.out(); });
  const t = new W();
  t.u16(0).u16(recs.length).u16(6 + 12 * recs.length);
  let off = 0;
  recs.forEach(([id], i) => { t.u16(3).u16(1).u16(0x409).u16(id).u16(strs[i].length).u16(off); off += strs[i].length; });
  strs.forEach((s) => t.bytes(s));
  return t.out();
}

function postTable() {
  return new W().u32(0x00030000).u32(0).i16(-100).i16(50).u32(0).u32(0).u32(0).u32(0).u32(0).out();
}

function os2Table(ascent: number, descent: number, upm: number) {
  const t = new W();
  t.u16(4).i16(Math.round(upm / 2)).u16(400).u16(5).u16(0);
  [0.65, 0.6, 0, 0.075, 0.65, 0.6, 0, 0.35].forEach((f) => t.i16(Math.round(upm * f)));
  t.i16(Math.round(upm * 0.05)).i16(Math.round(upm * 0.3)).i16(0);
  t.bytes(new Array(10).fill(0));
  t.u32(0).u32(0).u32(0).u32(0);
  t.bytes([78, 79, 78, 69]); // 'NONE'
  t.u16(0x40).u16(0x20).u16(0xffff);
  t.i16(ascent).i16(descent).i16(0).u16(Math.max(0, ascent)).u16(Math.max(0, -descent));
  t.u32(1).u32(0);
  t.i16(Math.round(upm / 2)).i16(Math.round(upm * 0.7)).u16(0).u16(32).u16(1);
  return t.out();
}

const checksum = (d: Uint8Array) => {
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s = (s + ((d[i] << 24) | ((d[i + 1] ?? 0) << 16) | ((d[i + 2] ?? 0) << 8) | (d[i + 3] ?? 0))) >>> 0;
  return s;
};

/** 브라우저용 글꼴을 만든다. map: 유니코드 → 글리프 번호 */
export function buildWebFont(ttf: Uint8Array, map: Map<number, number>, family: string): { bytes: Uint8Array; ascent: number; descent: number; upm: number } {
  const dv = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const num = dv.getUint16(4);
  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < num; i++) {
    const p = 12 + i * 16;
    const t = tagStr(dv.getUint32(p)), off = dv.getUint32(p + 8), len = dv.getUint32(p + 12);
    if (off + len <= ttf.length) tables.set(t, ttf.slice(off, off + len));
  }
  const head = tables.get('head'), hhea = tables.get('hhea');
  if (!head || !hhea || !tables.has('glyf') || !tables.has('loca') || !tables.has('maxp') || !tables.has('hmtx')) throw new Error('글꼴 표가 모자라요');
  const upm = new DataView(head.buffer).getUint16(18);
  const hv = new DataView(hhea.buffer);
  const ascent = hv.getInt16(4), descent = hv.getInt16(6);
  tables.set('cmap', cmap4(map));
  tables.set('name', nameTable(family));
  if (!tables.has('post')) tables.set('post', postTable());
  if (!tables.has('OS/2')) tables.set('OS/2', os2Table(ascent, descent, upm));
  // 브라우저가 따로 검사하다 거부하는 일이 없도록 쓰지 않는 표는 뺀다
  for (const t of [...tables.keys()]) if (!['cmap', 'name', 'post', 'OS/2', 'head', 'hhea', 'hmtx', 'maxp', 'glyf', 'loca', 'cvt ', 'fpgm', 'prep', 'gasp'].includes(t)) tables.delete(t);
  const headCopy = head.slice();
  new DataView(headCopy.buffer).setUint32(8, 0);
  tables.set('head', headCopy);

  const tags = [...tables.keys()].sort();
  const n = tags.length;
  let pow = 1, log = 0;
  while (pow * 2 <= n) { pow *= 2; log++; }
  const dir = new W();
  dir.u32(0x00010000).u16(n).u16(pow * 16).u16(log).u16(n * 16 - pow * 16);
  let off = 12 + n * 16;
  const body: Uint8Array[] = [];
  for (const t of tags) {
    const d = tables.get(t)!;
    dir.u32(tag(t)).u32(checksum(d)).u32(off).u32(d.length);
    const pad = (4 - (d.length % 4)) % 4;
    body.push(d, new Uint8Array(pad));
    off += d.length + pad;
  }
  const out = new Uint8Array(off);
  out.set(dir.out(), 0);
  let p = 12 + n * 16;
  for (const b of body) { out.set(b, p); p += b.length; }
  // head.checkSumAdjustment
  const headOff = new DataView(out.buffer).getUint32(12 + tags.indexOf('head') * 16 + 8);
  new DataView(out.buffer).setUint32(headOff + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return { bytes: out, ascent, descent, upm };
}

/** ToUnicode CMap을 읽어 유니코드 → 글자 번호(CID) 표를 만든다 (한 글자짜리만) */
export function parseToUnicode(cmap: string): Map<number, number> {
  const map = new Map<number, number>();
  const put = (cid: number, hex: string) => {
    if (hex.length !== 4) return; // 여러 글자로 풀리는 합자는 쓰지 않는다
    const u = parseInt(hex, 16);
    if (u === 0xffff || u === 0xfffd || map.has(u)) return;
    map.set(u, cid);
  };
  for (const block of cmap.split(/beginbfchar/).slice(1)) {
    const body = block.split('endbfchar')[0];
    for (const m of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) put(parseInt(m[1], 16), m[2]);
  }
  for (const block of cmap.split(/beginbfrange/).slice(1)) {
    const body = block.split('endbfrange')[0];
    for (const m of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
      const a = parseInt(m[1], 16), b = parseInt(m[2], 16);
      if (b - a > 20000) continue;
      if (m[3].startsWith('<')) {
        const base = parseInt(m[3].slice(1, -1), 16);
        if (m[3].length - 2 !== 4) continue;
        for (let c = a; c <= b; c++) put(c, (base + c - a).toString(16).padStart(4, '0'));
      } else {
        const list = [...m[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => x[1]);
        list.forEach((h, k) => put(a + k, h));
      }
    }
  }
  return map;
}
