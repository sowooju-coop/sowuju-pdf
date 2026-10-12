// 작업 스레드가 만든 "빈 서명 자리" PDF에 실제 서명 값을 채운다.
// PDF 처리(MuPDF)가 아니라 정해진 자리의 바이트만 바꾸는 일이라 화면 쪽에서 한다 (개인키가 작업 스레드로 가지 않게)
import { cmsSign, type SignCert } from './certs';
import { SIG_SPACE } from '../protocol';

const latin = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return s; };

export function fillSignature(pdf: Uint8Array, sc: SignCert): Uint8Array {
  const text = latin(pdf);
  // 덧붙인 마지막 부분에 서명 자리가 있다
  const br = text.lastIndexOf('[0 1111111111') + 3;
  if (br < 0) throw new Error('서명 자리를 찾지 못했어요.');
  const open = text.lastIndexOf('[', br), close = text.indexOf(']', br);
  if (br < 3 || open < 0 || close < 0 || !/^\[\s*0\s+1111111111\s+1111111111\s+1111111111\s*$/.test(text.slice(open, close))) throw new Error('서명 자리를 찾지 못했어요.');
  const a = text.lastIndexOf(`<${'0'.repeat(SIG_SPACE * 2)}>`);
  const b = a + SIG_SPACE * 2 + 2;
  if (a < 0) throw new Error('서명 자리를 찾지 못했어요.');
  const out = pdf.slice();
  const range = `[0 ${a} ${b} ${pdf.length - b}`;
  const width = close - open;
  if (range.length > width) throw new Error('서명 자리를 찾지 못했어요.');
  const padded = range + ' '.repeat(width - range.length);
  for (let i = 0; i < width; i++) out[open + i] = padded.charCodeAt(i);
  const data = new Uint8Array(a + (pdf.length - b));
  data.set(out.subarray(0, a), 0);
  data.set(out.subarray(b), a);
  const cms = cmsSign(sc, data);
  const room = (b - a - 2) / 2;
  if (cms.length > room) throw new Error('인증서가 너무 길어 서명 자리에 들어가지 않아요.');
  let hex = '';
  for (const v of cms) hex += v.toString(16).padStart(2, '0');
  for (let i = 0; i < hex.length; i++) out[a + 1 + i] = hex.charCodeAt(i);
  return out;
}
