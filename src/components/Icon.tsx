const PATHS: Record<string, string> = {
  open: 'M3 7h6l2 2h10v10H3z',
  save: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  print: 'M7 9V4h10v5M7 17H4v-7h16v7h-3M7 14h10v6H7z',
  rotl: 'M4 4v5h5M5 9a8 8 0 1 1-1 5',
  rotr: 'M20 4v5h-5M19 9a8 8 0 1 0 1 5',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  zoomin: 'M8 11h6M11 8v6M16 16l4.5 4.5M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z',
  zoomout: 'M8 11h6M16 16l4.5 4.5M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z',
  fit: 'M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3M4 4v4M20 4v4M4 16v4M20 16v4',
};

export function Icon({ name }: { name: keyof typeof PATHS | string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
