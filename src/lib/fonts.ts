// 새로 쓰는 글자에 쓰는 글꼴. 화면 미리보기(CSS)와 PDF에 넣는 글꼴이 같은 파일이라 폭이 정확히 맞는다.
export type FontFamily = 'sans' | 'serif';

export const FONTS: Record<FontFamily, { label: string; css: string; regular: string; bold: string }> = {
  sans: { label: '고딕', css: "'Pretendard', sans-serif", regular: 'Pretendard-Regular.ttf', bold: 'Pretendard-Bold.ttf' },
  serif: { label: '명조', css: "'NanumMyeongjo', serif", regular: 'NanumMyeongjo-Regular.ttf', bold: 'NanumMyeongjo-Bold.ttf' },
};

export function fontFile(family: FontFamily, bold: boolean) {
  return FONTS[family][bold ? 'bold' : 'regular'];
}

const SERIF = /batang|myeong|myung|mjo|명조|바탕|궁서|gungsuh|times|garamond|georgia|minion|mincho|songti|simsun|hymjre|hysmyeong|serif/i;
const SANS = /gothic|dotum|돋움|고딕|malgun|sans|pretendard|arial|helvetica|nanumsquare|spoqa|gulim|굴림/i;
const BOLD = /bold|black|heavy|extrab|semib|demib|[-,]b$/i;

/** 원래 글꼴 정보로 고딕/명조와 굵기를 짐작한다 */
export function guessFamily(name: string, serifFlag: boolean, boldFlag: boolean): { family: FontFamily; bold: boolean } {
  const n = name.replace(/^[A-Z]{6}\+/, '');
  const serif = !SANS.test(n) && (SERIF.test(n) || serifFlag);
  return { family: serif ? 'serif' : 'sans', bold: boldFlag || BOLD.test(n) };
}

const ctx = document.createElement('canvas').getContext('2d')!;

/** 글자 폭(pt). 자간 sp는 글자마다 뒤에 더해진다 (PDF의 Tc와 같은 규칙) */
export function textWidth(text: string, family: FontFamily, bold: boolean, size: number, sp = 0) {
  ctx.font = `${bold ? 700 : 400} ${size}px ${FONTS[family].css}`;
  return ctx.measureText(text).width + sp * [...text].length;
}

export async function loadFonts() {
  await Promise.all(
    (['Pretendard', 'NanumMyeongjo'] as const).flatMap((f) => [document.fonts.load(`400 16px ${f}`), document.fonts.load(`700 16px ${f}`)]),
  ).catch(() => undefined);
}

/** 새 글자 상자의 줄 간격 (글자 크기의 배수) */
export const LINE_HEIGHT = 1.3;

/** 상자 맨 위에서 첫 줄 바닥선까지의 거리(pt). CSS 줄 상자와 같은 규칙으로 계산해 화면과 PDF가 맞게 */
export function baselineOffset(family: FontFamily, bold: boolean, size: number) {
  ctx.font = `${bold ? 700 : 400} ${size}px ${FONTS[family].css}`;
  const m = ctx.measureText('가Ag');
  const asc = m.fontBoundingBoxAscent ?? size * 0.9, desc = m.fontBoundingBoxDescent ?? size * 0.25;
  return (LINE_HEIGHT * size - (asc + desc)) / 2 + asc;
}
