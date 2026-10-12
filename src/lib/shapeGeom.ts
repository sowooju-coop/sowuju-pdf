// 펜·도형 모양 계산. 화면(SVG)과 PDF가 같은 계산을 써서 적용 전후 모양이 똑같다
import type { ShapeKind } from './protocol';

type P = [number, number];
export type Cmd = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Z'];

export function shapeCmds(kind: ShapeKind, points: P[], width: number): Cmd[] {
  const a = points[0], b = points[points.length - 1];
  const poly = (ps: P[], close = false): Cmd[] => [...ps.map((p, i): Cmd => [i ? 'L' : 'M', p[0], p[1]]), ...(close ? [['Z'] as Cmd] : [])];
  switch (kind) {
    case 'pen':
    case 'line':
      return poly(points);
    case 'arrow': {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), head = Math.max(6, width * 4);
      const l: P = [b[0] - head * Math.cos(ang - 0.45), b[1] - head * Math.sin(ang - 0.45)];
      const r: P = [b[0] - head * Math.cos(ang + 0.45), b[1] - head * Math.sin(ang + 0.45)];
      return [...poly([a, b]), ...poly([l, b, r])];
    }
    case 'rect':
    case 'highlight':
      return poly([[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]], true);
    case 'ellipse': {
      // 네 개의 베지어 곡선으로 그린 타원
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2, k = 0.5523;
      const c = (x: number, y: number): [number, number] => [cx + x, cy + y];
      return [
        ['M', ...c(rx, 0)],
        ['C', ...c(rx, ry * k), ...c(rx * k, ry), ...c(0, ry)],
        ['C', ...c(-rx * k, ry), ...c(-rx, ry * k), ...c(-rx, 0)],
        ['C', ...c(-rx, -ry * k), ...c(-rx * k, -ry), ...c(0, -ry)],
        ['C', ...c(rx * k, -ry), ...c(rx, -ry * k), ...c(rx, 0)],
        ['Z'],
      ];
    }
    case 'check': {
      // points[0] = 왼쪽 위, points[1] = 오른쪽 아래
      const w = b[0] - a[0], h = b[1] - a[1], at = (u: number, v: number): P => [a[0] + w * u, a[1] + h * v];
      return poly([at(0.08, 0.55), at(0.38, 0.86), at(0.94, 0.12)]);
    }
  }
}

export function svgPath(cmds: Cmd[], zoom: number) {
  return cmds.map(([op, ...v]) => op + (v as number[]).map((n) => +(n * zoom).toFixed(2)).join(' ')).join('');
}
