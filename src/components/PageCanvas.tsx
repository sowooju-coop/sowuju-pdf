import { memo, useEffect, useRef, useState } from 'react';
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
  /** 쪽 목록·한눈에 보기의 작은 그림 (본문보다 나중에 그린다) */
  thumb?: boolean;
}

/** 페이지 한 장을 화면에 보일 때만 MuPDF로 그려 캔버스에 올린다 */
export const PageCanvas = memo(function PageCanvas({ client, index, info, zoom, rev, root, className, thumb }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { root, rootMargin: thumb ? '300px 0px' : '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root, thumb]);

  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // 지금 화면에 보이는 쪽을 먼저, 미리 그려 두는 근처 쪽은 그다음
    let prio = 3;
    if (!thumb) {
      const r = box.current!.getBoundingClientRect();
      const v = root?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
      prio = r.bottom > v.top && r.top < v.bottom ? 1 : 2;
    }
    client.render(index, zoom * dpr, { prio, signal: ctrl.signal }).then((r) => {
      const c = canvas.current;
      if (ctrl.signal.aborted || !c) { r.bitmap.close(); return; }
      if (c.width !== r.width || c.height !== r.height) { c.width = r.width; c.height = r.height; }
      c.getContext('2d')!.drawImage(r.bitmap, 0, 0);
      r.bitmap.close();
      c.dataset.drawn = String(rev);
    }).catch(() => undefined);
    return () => ctrl.abort();
  }, [client, index, zoom, rev, visible, thumb, root]);

  return (
    <div ref={box} className={className} style={{ width: info.width * zoom, height: info.height * zoom }}>
      <canvas ref={canvas} />
    </div>
  );
});
