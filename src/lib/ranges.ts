// "1-3, 5, 8-" 같은 쪽 범위 글을 쪽 번호(0부터) 묶음으로 바꾼다

/** 묶음마다 쪽 목록. 잘못 쓴 곳이 있으면 error */
export function parseRanges(text: string, total: number): { groups: number[][]; error?: string } {
  const groups: number[][] = [];
  const parts = text.replace(/[~〜–—]/g, '-').replace(/쪽|페이지|p/gi, '').replace(/\s*-\s*/g, '-').split(/[,，、\s]+/).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(\d*)-(\d*)$/) ?? part.match(/^(\d+)$/);
    if (!m) return { groups, error: `"${part}"를 알아볼 수 없어요. 1-3, 5 처럼 써 주세요.` };
    const a = m[1] ? Number(m[1]) : 1;
    const b = m.length > 2 ? (m[2] ? Number(m[2]) : total) : a;
    if (a < 1 || b > total || a > b) return { groups, error: `"${part}"는 1쪽부터 ${total}쪽 사이로 써 주세요.` };
    groups.push(Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
  }
  return { groups };
}

/** 쪽 묶음 → "1-3쪽" 같은 이름 */
export function groupLabel(g: number[]) {
  if (!g.length) return '';
  const contiguous = g.every((v, i) => i === 0 || v === g[i - 1] + 1);
  if (g.length === 1) return `${g[0] + 1}쪽`;
  return contiguous ? `${g[0] + 1}-${g[g.length - 1] + 1}쪽` : `${g.length}쪽`;
}

/** n쪽씩 나누기 */
export function chunks(total: number, n: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < total; i += n) out.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k));
  return out;
}
