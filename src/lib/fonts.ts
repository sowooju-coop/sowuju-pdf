// 새로 쓰는 글자에 쓰는 글꼴. 화면 미리보기(CSS)와 PDF에 넣는 글꼴이 같은 파일이라 폭이 정확히 맞는다.
export type FontFamily = 'sans' | 'serif';

export const FONTS: Record<FontFamily, { label: string; css: string; regular: string; bold: string }> = {
  sans: { label: '고딕', css: "'Pretendard', sans-serif", regular: 'Pretendard-Regular.ttf', bold: 'Pretendard-Bold.ttf' },
  serif: { label: '명조', css: "'NanumMyeongjo', serif", regular: 'NanumMyeongjo-Regular.ttf', bold: 'NanumMyeongjo-Bold.ttf' },
};

export function fontFile(family: FontFamily, bold: boolean) {
  return FONTS[family][bold ? 'bold' : 'regular'];
}

const BOLD = /bold|black|heavy|extrab|semib|demib|[-,]b$/i;

/** 원래 글꼴 정보로 고딕/명조와 굵기를 짐작한다 */
export function guessFamily(name: string, serifFlag: boolean, boldFlag: boolean): { family: FontFamily; bold: boolean } {
  // serifFlag는 작업 스레드가 원래 한글 이름·글꼴 정보(Flags)로 미리 가른 값
  return { family: serifFlag ? 'serif' : 'sans', bold: boldFlag || BOLD.test(name.replace(/^[A-Z]{6}\+/, '')) };
}

const ctx = document.createElement('canvas').getContext('2d')!;

/** 글자 폭(pt). 자간 sp는 글자마다 뒤에 더해진다 (PDF의 Tc와 같은 규칙) */
export function textWidth(text: string, family: FontFamily, bold: boolean, size: number, sp = 0, origCss?: string) {
  ctx.font = `${origCss ? 400 : bold ? 700 : 400} ${size}px ${origCss ? `${origCss}, ` : ''}${FONTS[family].css}`;
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

/** 원래 글꼴을 브라우저에 올린다. 같은 문서·같은 글꼴은 한 번만 */
const registered = new Map<string, Promise<string | null>>();
export function registerOrigFont(docId: number, info: { key: number; bytes: Uint8Array }): Promise<string | null> {
  const id = `${docId}:${info.key}`;
  if (!registered.has(id)) {
    const family = `SowujuOrig-${docId}-${info.key}`;
    registered.set(id, (async () => {
      try {
        const face = new FontFace(family, info.bytes.slice().buffer as ArrayBuffer);
        await face.load();
        document.fonts.add(face);
        return `"${family}"`;
      } catch {
        return null; // 브라우저가 받지 않는 글꼴: 비슷한 글꼴로 대신 쓴다
      }
    })());
  }
  return registered.get(id)!;
}
