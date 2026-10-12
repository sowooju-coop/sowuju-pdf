// 펜·형광펜·도형·체크를 페이지 내용으로 그린다. 주석이 아니라 내용이라 어느 프로그램에서 열어도, 인쇄해도 똑같다
import * as mupdf from 'mupdf';
import type { NewShape } from '../lib/protocol';
import { shapeCmds } from '../lib/shapeGeom';
import { addResource, appendContent, applyMatrix, num } from './pdfUtil';

type P = [number, number];

/** 화면 좌표 도형을 PDF 경로 명령으로 (회전된 페이지도 화면에 보이는 그대로) */
function pathOps(s: NewShape, tf: (p: P) => P): string {
  const pt = (x: number, y: number) => tf([x, y]).map(num).join(' ');
  return shapeCmds(s.kind, s.points, s.width).map((c) => {
    switch (c[0]) {
      case 'M': return `${pt(c[1], c[2])} m`;
      case 'L': return `${pt(c[1], c[2])} l`;
      case 'C': return `${pt(c[1], c[2])} ${pt(c[3], c[4])} ${pt(c[5], c[6])} c`;
      case 'Z': return 'h';
    }
  }).join(' ');
}

export function drawShapes(doc: mupdf.PDFDocument, shapes: NewShape[]) {
  const byPage = new Map<number, NewShape[]>();
  for (const s of shapes) byPage.set(s.page, [...(byPage.get(s.page) ?? []), s]);
  for (const [index, list] of byPage) {
    const page = doc.loadPage(index);
    const inv = mupdf.Matrix.invert(page.getTransform());
    const tf = (p: P) => applyMatrix(inv, p[0], p[1]);
    let multiply = '';
    const ops = list.map((s) => {
      const [r, g, b] = s.color.map(num);
      if (s.kind === 'highlight') {
        // 곱하기 섞기: 형광펜 아래 글자가 그대로 진하게 보인다
        if (!multiply) {
          const gs = doc.newDictionary();
          gs.put('Type', doc.newName('ExtGState'));
          gs.put('BM', doc.newName('Multiply'));
          multiply = addResource(doc, page, 'ExtGState', 'SowujuGS', doc.addObject(gs));
        }
        return `q /${multiply} gs ${r} ${g} ${b} rg ${pathOps(s, tf)} f Q`;
      }
      return `q ${num(s.width)} w 1 J 1 j ${r} ${g} ${b} RG ${pathOps(s, tf)} S Q`;
    });
    appendContent(doc, page, ops.join('\n'));
    page.destroy();
  }
}
