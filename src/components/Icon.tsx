// 선 굵기 1.7의 단순한 선 아이콘 모음 (24×24)
const PATHS: Record<string, string> = {
  open: 'M3 7h6l2 2h10v10H3z',
  save: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  print: 'M7 9V4h10v5M7 17H4v-7h16v7h-3M7 14h10v6H7z',
  rotl: 'M4 4v5h5M5 9a8 8 0 1 1-1 5',
  rotr: 'M20 4v5h-5M19 9a8 8 0 1 0 1 5',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  up: 'M12 19V5M6 11l6-6 6 6',
  hash: 'M9 4 7 20M17 4l-2 16M4 9h16M3 15h16',
  water: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  split: 'M6 3v6l6 3 6-3V3M12 12v9M8 17l4 4 4-4',
  ocr: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 9h8M12 9v7',
  compare: 'M4 5h7v14H4zM13 5h7v14h-7M7 9h1M7 12h1M16 9h1M16 12h1',
  batch: 'M5 4h10v4H5zM5 10h14v4H5zM5 16h7v4H5zM17 17l2 2 3-4',
  field: 'M3 7h18v10H3zM7 10v4M6 10h2M6 14h2',
  clean: 'M5 19l9-9M14 10l2-6 1 3 3 1-6 2zM4 8h2M5 7v2M18 15h2M19 14v2',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  down: 'M12 5v14M6 13l6 6 6-6',
  edit: 'M4 7V5h10v2M9 5v11M7 16h4M13 20l6.5-6.5 2 2L15 22h-2z',
  text: 'M5 7V4h14v3M12 4v16M9 20h6',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2.5-2.5L20 17',
  highlight: 'M14 4l6 6-8 8H7v-5zM4 21h16',
  pen: 'M3 17c3-6 5-6 6-2s3 4 6-2 4-5 6-3',
  shape: 'M4 6h16v12H4z',
  sign: 'M3 17c2 0 3-7 5-7s1 6 3 6 2-3 4-3 2 2 6 2M3 21h18',
  stamp: 'M5 5h14v14H5zM9 10h6M9 14h6',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  shieldCheck: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  note: 'M5 4h14v12l-4 4H5zM15 20v-4h4',
  merge: 'M8 3h8l4 4v10H8zM4 7v14h12',
  pages: 'M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z',
  photo: 'M3 7h4l2-3h6l2 3h4v12H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  search: 'M16 16l4.5 4.5M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z',
  left: 'M14 6l-6 6 6 6',
  right: 'M10 6l6 6-6 6',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01',
  move: 'M12 3v18M3 12h18M12 3l-3 3m3-3 3 3M12 21l-3-3m3 3 3-3M3 12l3-3m-3 3 3 3M21 12l-3-3m3 3-3 3',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  fit: 'M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3M4 4v4M20 4v4M4 16v4M20 16v4',
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="ico">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** 소우주 PDF 로고: 남색 문서와 청록 점 */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="10" y="4" width="44" height="56" rx="10" fill="#1E3A5F" />
      <path d="M21 23h22M21 32h22M21 41h12" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="47" cy="47" r="9" fill="#0F766E" />
    </svg>
  );
}
