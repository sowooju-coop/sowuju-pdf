import { useEffect, useRef, useState } from 'react';
import type { PdfClient } from '../lib/pdfClient';
import type { PageInfo } from '../lib/protocol';

interface Props {
  client: PdfClient;
  index: number;
  info: PageInfo;
  /** 1pt 당 화면 px */
  zoom: number;
  /** 문서가 바뀔 때마다 올라가는 번호. 바뀌면 다시 그린다 */
  rev: number;
  /** 화면에 가까울 때만 그리기 위한 스크롤 영역 */
  root: Element | null;
  className?: string;
}

/** 페이지 한 장을 화면에 보일 때만 MuPDF로 그려 캔버스에 올린다 */
export function PageCanvas({ client, index, info, zoom, rev, root, className }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { root, rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    client.render(index, zoom * dpr).then((r) => {
      const c = canvas.current;
      if (cancelled || !c) return;
      c.width = r.width;
      c.height = r.height;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.pixels.buffer as ArrayBuffer), r.width, r.height), 0, 0);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [client, index, zoom, rev, visible]);

  return (
    <div ref={box} className={className} style={{ width: info.width * zoom, height: info.height * zoom }}>
      <canvas ref={canvas} />
    </div>
  );
}
