// 페이지에 내용을 덧붙일 때 함께 쓰는 도구 (글자 수정, 서명·직인)
import * as mupdf from 'mupdf';

export const applyMatrix = (m: mupdf.Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const num = (v: number) => (Math.abs(v) < 1e-6 ? '0' : String(+v.toFixed(4)));

/** 페이지 Resources 안의 하위 사전(Font, XObject)에 새 이름으로 obj를 넣고 그 이름을 돌려준다 */
export function addResource(doc: mupdf.PDFDocument, page: mupdf.PDFPage, kind: 'Font' | 'XObject', prefix: string, obj: mupdf.PDFObject) {
  const pobj = page.getObject();
  let res = pobj.get('Resources');
  if (res.isNull()) {
    const inh = pobj.getInheritable('Resources');
    res = inh.isNull() ? doc.addObject(doc.newDictionary()) : inh;
    pobj.put('Resources', res);
  }
  let dict = res.get(kind);
  if (dict.isNull()) {
    dict = doc.newDictionary();
    res.put(kind, dict);
  }
  let k = 1;
  while (!dict.get(`${prefix}${k}`).isNull()) k++;
  const key = `${prefix}${k}`;
  dict.put(key, obj);
  return key;
}

/** 원래 내용을 q … Q 로 감싸고 그 뒤에 새 내용 스트림을 붙인다 (원래 그래픽 상태가 새 내용에 영향을 주지 않게) */
export function appendContent(doc: mupdf.PDFDocument, page: mupdf.PDFPage, stream: string) {
  const obj = page.getObject();
  const contents = obj.get('Contents');
  const arr = doc.newArray();
  arr.push(doc.addStream('q\n', doc.newDictionary()));
  if (contents.isArray()) for (let i = 0; i < contents.length; i++) arr.push(contents.get(i));
  else if (!contents.isNull()) arr.push(contents);
  arr.push(doc.addStream('\nQ\n', doc.newDictionary()));
  arr.push(doc.addStream(stream, doc.newDictionary()));
  obj.put('Contents', arr);
}

/** 화면 좌표(위가 0)의 사각형을 PDF 그림 행렬(cm)로: 화면에 보이는 그대로 똑바로 놓인다 (회전된 페이지 포함) */
export function rectToImageMatrix(page: mupdf.PDFPage, x: number, y: number, w: number, h: number) {
  const inv = mupdf.Matrix.invert(page.getTransform());
  const bl = applyMatrix(inv, x, y + h), br = applyMatrix(inv, x + w, y + h), tl = applyMatrix(inv, x, y);
  return [br[0] - bl[0], br[1] - bl[1], tl[0] - bl[0], tl[1] - bl[1], bl[0], bl[1]].map(num).join(' ');
}
