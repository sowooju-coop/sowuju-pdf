import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PdfClient, type EditResult } from './lib/pdfClient';
import type { PageInfo, ReplaceRequest } from './lib/protocol';
import { baselineOffset, fontFile, FONTS, LINE_HEIGHT, loadFonts, textWidth } from './lib/fonts';
import { dateFormats, hexRgb, loadTextStyle, saveTextStyle } from './lib/textTools';
import type { EditStyle } from './lib/textDiff';
import { fileKind, openFile, openFiles, openRecent, printPages, readDroppedAll, recentAdd, saveFile, saveFiles, type OpenedFile, type PrintPage, type RecentFile } from './lib/host';
import { PageRail } from './components/PageRail';
import { PageGrid } from './components/PageGrid';
import { PageMenu, type PageActions, type PageMenuState } from './components/PageMenu';
import { MarkDialog } from './components/MarkDialogs';
import { PlaceLayer, type Placed } from './components/PlaceLayer';
import { NOTE_COLOR, NOTE_PAD, TextLayer, type TextBox } from './components/TextLayer';
import { FormLayer } from './components/FormLayer';
import { SelectLayer, type TextSelection } from './components/SelectLayer';
import { PageNumberDialog, savedPageNumberOptions, savedWatermarkOptions, WatermarkDialog } from './components/PageMarks';
import { ImageExportDialog, type ImageExportOptions } from './components/ImageExport';
import { OcrDialog, type OcrProgress } from './components/Ocr';
import { recognize, stopOcr } from './lib/ocr';
import { RecipeDialog, type RecipeRun } from './components/Recipe';
import { CompareView } from './components/Compare';
import { OutlinePanel } from './components/Outline';
import { SplitDialog } from './components/SplitDialog';
import { groupLabel, parseRanges } from './lib/ranges';
import { FindBar, FindLayer, type FindState } from './components/Find';
import { LockDialog, PrivacyPanel, privacyAreas, RedactLayer, ShrinkDialog, type PrivacyState } from './components/Protect';
import { MARKER_COLORS, PEN_COLORS, PEN_WIDTHS, ShapeLayer, type Shape } from './components/ShapeLayer';
import type { ShapeKind } from './lib/protocol';
import { dataUrlBytes, fileToDataUrl, loadImage, markName, newId, type Mark, type MarkKind } from './lib/library';
import { EditLayer, type EditingState } from './components/EditLayer';
import { PageCanvas } from './components/PageCanvas';
import { Icon, Logo } from './components/Icon';
import { StartScreen, type QuickAction } from './components/StartScreen';

interface Doc {
  name: string;
  path?: string;
  size: number;
  pages: PageInfo[];
}
type PrintRange = 'all' | 'current' | 'selected' | 'custom';
interface PrintOptions { range: PrintRange; custom: number[]; dpi: number; per: 1 | 2 | 4; border: boolean }
type Tab = 'home' | 'edit' | 'page' | 'note' | 'protect';
/** 실행 취소 기록 한 칸: 오른쪽 패널의 "이번에 고친 곳"에 쓴다 */
interface HistItem { kind: 'text' | 'page' | 'mark'; page: number; before?: string; after?: string }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const baseName = (n: string) => n.replace(/\.pdf$/i, '');
const pt2mm = (v: number) => Math.round((v / 72) * 25.4);
function paperName(p: PageInfo) {
  const [w, h] = [Math.min(p.width, p.height), Math.max(p.width, p.height)];
  const near = (a: number, b: number) => Math.abs(a - b) < 3;
  if (near(w, 595) && near(h, 842)) return 'A4';
  if (near(w, 612) && near(h, 792)) return 'Letter';
  if (near(w, 516) && near(h, 729)) return 'B5';
  if (near(w, 842) && near(h, 1191)) return 'A3';
  return '사용자 크기';
}
const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: '홈' }, { id: 'edit', label: '편집' }, { id: 'page', label: '페이지' }, { id: 'note', label: '주석' }, { id: 'protect', label: '보호' },
];

const SHAPE_KINDS: { id: ShapeKind; label: string; icon: string }[] = [
  { id: 'check', label: '체크 표시', icon: '✓' },
  { id: 'rect', label: '네모', icon: '□' },
  { id: 'ellipse', label: '동그라미', icon: '○' },
  { id: 'line', label: '선', icon: '─' },
  { id: 'arrow', label: '화살표', icon: '→' },
];
const DRAW_LABEL: Record<ShapeKind, string> = { pen: '펜', highlight: '형광펜', check: '체크 표시', rect: '네모', ellipse: '동그라미', line: '선', arrow: '화살표' };

/** 열린 문서 탭 하나의 정보 (위쪽 탭 줄에 보여 준다) */
export interface TabInfo { id: string; name: string | null; dirty: boolean; unsaved: boolean }

/** 탭 바깥(App)에서 이 탭에 시키는 일 */
export interface WorkspaceHandle {
  save: () => Promise<boolean>;
  requestClose: () => void;
  load: (f: OpenedFile) => void;
}

interface WorkspaceProps {
  tabId: string;
  active: boolean;
  tabs: TabInfo[];
  /** 처음 열 파일 (새 탭으로 연 경우) */
  initialFile?: OpenedFile;
  initialAction?: QuickAction;
  onInfo: (id: string, info: Omit<TabInfo, 'id'>) => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onRemoveTab: (id: string) => void;
  openInNewTab: (f: OpenedFile, then?: QuickAction) => void;
  register: (id: string, h: WorkspaceHandle | null) => void;
  easy: boolean;
  easyScale: number;
  setEasy: (v: boolean) => void;
  setEasyScale: (v: number) => void;
  onHelp: (topic?: string) => void;
}

/** 위쪽 탭 줄 */
export function TabStrip({ tabs, activeId, onSelect, onClose, onNew }: { tabs: TabInfo[]; activeId: string; onSelect: (id: string) => void; onClose: (id: string) => void; onNew: () => void }) {
  return (
    <div className="doctabs" role="tablist" aria-label="열린 문서">
      {tabs.map((t) => (
        <div key={t.id} role="tab" aria-selected={t.id === activeId} className={`doctab${t.id === activeId ? ' on' : ''}`} title={t.name ?? '새 탭'} onClick={() => onSelect(t.id)}>
          {t.dirty && <span className="dot" aria-label="저장하지 않은 고침 있음" />}
          <span className="dname">{t.name ?? '새 탭'}</span>
          <button className="x" aria-label={`${t.name ?? '새 탭'} 닫기`} onClick={(e) => { e.stopPropagation(); onClose(t.id); }}><Icon name="close" size={13} /></button>
        </div>
      ))}
      <button className="newtab" aria-label="새 탭" title="새 탭 (Ctrl+T)" onClick={onNew}><Icon name="plus" size={16} /></button>
    </div>
  );
}

export function Workspace(props: WorkspaceProps) {
  const { tabId, active, easy, easyScale, setEasy, setEasyScale } = props;
  const client = useMemo(() => new PdfClient(), []);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [rev, setRev] = useState(0);
  // 쪽 하나만 바뀐 편집(글자 고치기, 넣기, 돌리기)은 그 쪽만 다시 그린다
  const [pageRev, setPageRev] = useState<Record<number, number>>({});
  const [zoom, setZoom] = useState(1.25);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [cur, setCur] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pw, setPw] = useState<{ file: OpenedFile; wrong: boolean } | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [tab, setTab] = useState<Tab>('edit');
  const [overview, setOverview] = useState(false);
  const [gridSize, setGridSize] = useState(170);
  const [gridMenu, setGridMenu] = useState<PageMenuState | null>(null);
  const [markDialog, setMarkDialog] = useState<MarkKind | null>(null);
  const [placing, setPlacing] = useState<Mark | null>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [activePlaced, setActivePlaced] = useState<string | null>(null);
  // 글자 추가: 놓아 둔 글자 상자, 넣을 곳 고르는 중, 고른 상자, 마지막에 쓴 모양
  const [texts, setTexts] = useState<TextBox[]>([]);
  const [addingText, setAddingText] = useState<{ text: string; note?: boolean } | null>(null);
  const [activeText, setActiveText] = useState<string | null>(null);
  const [dateMenu, setDateMenu] = useState(false);
  // 펜·형광펜·도형: 놓아 둔 것, 고른 것, 지금 쓰는 도구와 색
  // 보호: 개인정보 지우기 상태, 암호·용량 대화상자, 처음 열 때 암호가 있었는지
  const [privacy, setPrivacy] = useState<PrivacyState | null>(null);
  // 문서 안 글자 찾기 (Ctrl+F)
  const [find, setFind] = useState<FindState>({ q: '', hits: [], idx: 0, busy: false, open: false });
  // 양식 입력칸이 있는 문서면 그 개수 (0이면 입력칸 층을 그리지 않는다)
  const [fieldCount, setFieldCount] = useState(0);
  const [lockOpen, setLockOpen] = useState(false);
  const [shrinkOpen, setShrinkOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [imgOpen, setImgOpen] = useState(false);
  const [compareWith, setCompareWith] = useState<OpenedFile | null>(null);
  const [recipeOpen, setRecipeOpen] = useState(false);
  // 왼쪽: 쪽 목록 / 목차
  const [side, setSide] = useState<'pages' | 'outline'>('pages');
  const [outlineCount, setOutlineCount] = useState(0);
  // 글자 읽기(OCR)
  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const ocrStop = useRef(false);
  const [textless, setTextless] = useState<number[] | null>(null);
  const [scanHint, setScanHint] = useState(false);
  const [markOpen, setMarkOpen] = useState<'num' | 'wm' | null>(null);
  const [encrypted, setEncrypted] = useState(false);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [activeShape, setActiveShape] = useState<string | null>(null);
  const [drawKind, setDrawKind] = useState<ShapeKind | null>(null);
  const [shapeMenu, setShapeMenu] = useState(false);
  const [penColor, setPenColor] = useState(PEN_COLORS[0].id);
  const [markerColor, setMarkerColor] = useState(MARKER_COLORS[0].id);
  const [penWidth, setPenWidth] = useState(PEN_WIDTHS[1].id);
  const drawTool = drawKind ? { kind: drawKind, color: drawKind === 'highlight' ? markerColor : penColor, width: penWidth } : null;
  const textStyle = useRef<Pick<TextBox, 'size' | 'family' | 'bold' | 'color'>>(loadTextStyle());
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [hist, setHist] = useState({ canUndo: false, canRedo: false });
  const [log, setLog] = useState<{ done: HistItem[]; undone: HistItem[] }>({ done: [], undone: [] });
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [liveText, setLiveText] = useState('');
  const [styleOverride, setStyleOverride] = useState<EditStyle | null>(null);
  const pendingAction = useRef<QuickAction | undefined>(undefined);
  const viewer = useRef<HTMLDivElement | null>(null);
  const [viewerEl, setViewerEl] = useState<HTMLDivElement | null>(null);
  // ref 함수가 매번 바뀌면 React가 null→요소로 다시 붙이면서 모든 쪽을 다시 그리므로 한 번만 만든다
  const viewerRef = useCallback((el: HTMLDivElement | null) => { viewer.current = el; if (el) setViewerEl(el); }, []);
  const lastClick = useRef<number | null>(null);

  useEffect(() => { loadFonts(); }, []);

  const say = useCallback((m: string) => {
    setToast(m);
    window.clearTimeout((say as any).t);
    (say as any).t = window.setTimeout(() => setToast(null), 3500);
  }, []);

  const fitWidth = useCallback((pages: PageInfo[], cap = false) => {
    const v = viewer.current;
    if (!v || !pages.length) return;
    const maxW = Math.max(...pages.map((p) => p.width));
    let z = (v.clientWidth - 64) / maxW;
    if (cap) z = Math.min(z, 1.4);
    setZoom(clamp(z, 0.25, 4));
  }, []);

  const load = useCallback(async (file: OpenedFile, password?: string): Promise<boolean> => {
    setBusy('여는 중…');
    try {
      const r = await client.open(file.bytes, password);
      if (r.needsPassword) { setPw({ file, wrong: !!r.wrongPassword }); return false; }
      setPw(null);
      setDoc({ name: file.name, path: file.path, size: file.bytes.length, pages: r.pages! });
      setSel(new Set());
      setCur(0);
      // 한글·워드에서 바꾼 문서는 아직 PDF 파일로 저장된 적이 없다
      setDirty(!!file.convertedFrom);
      setSavedAt(null);
      setHist({ canUndo: false, canRedo: false });
      setLog({ done: [], undone: [] });
      setRev((v) => v + 1);
      if (file.path) recentAdd({ path: file.path, name: file.name, pages: r.pages!.length });
      const act = pendingAction.current;
      pendingAction.current = undefined;
      setMode(act === 'edit' ? 'edit' : 'view');
      setTab(act === 'pages' ? 'page' : 'edit');
      setOverview(act === 'pages');
      setPlaced([]); setPlacing(null); setActivePlaced(null);
      setTexts([]); setAddingText(null); setActiveText(null);
      setShapes([]); setActiveShape(null); setDrawKind(null);
      if (act === 'print') setPrintOpen(true);
      if (act === 'sign') setMarkDialog('sign');
      setPrivacy(null);
      if (act === 'privacy') setTimeout(() => startPrivacyRef.current(), 0);
      client.info().then((i) => setEncrypted(!!i.encryption && i.encryption !== 'None')).catch(() => setEncrypted(false));
      setFieldCount(0);
      if (file.convertedFrom) say(`"${file.convertedFrom}"을 PDF로 바꿔 열었어요. 저장하면 PDF 파일로 따로 저장돼요.`);
      client.fieldCount().then((n) => { setFieldCount(n); if (n) say(`이 문서에는 입력칸이 ${n}개 있어요. 칸을 눌러 바로 쓰세요.`); }).catch(() => undefined);
      requestAnimationFrame(() => { viewer.current?.scrollTo(0, 0); fitWidth(r.pages!, true); });
      return true;
    } catch (e) {
      say(`"${file.name}" 파일을 열지 못했어요. ${(e as Error).message}`);
      return false;
    } finally {
      setBusy(null);
    }
  }, [client, fitWidth, say]);

  // 이미 문서가 열려 있으면 새 탭으로 연다
  const doOpen = useCallback(async (then?: QuickAction) => {
    let f: OpenedFile | null;
    try { f = await openFile(); } catch (e) { say((e as Error).message); return; }
    if (!f) return;
    if (doc) { props.openInNewTab(f, then); return; }
    pendingAction.current = then;
    load(f);
  }, [load, doc, props, say]);

  const doOpenRecent = useCallback(async (r: RecentFile) => {
    try {
      const f = await openRecent(r.path);
      if (f && doc) props.openInNewTab(f);
      else if (f) load(f); else say('파일을 찾지 못했어요. 옮겨졌거나 지워졌을 수 있어요.');
    } catch { say('파일을 열지 못했어요.'); }
  }, [load, say, doc, props]);

  /** 놓아 둔 서명·직인을 PDF에 고정한다 */
  const applyPlaced = useCallback(async () => {
    const boxes = texts.filter((t) => t.text.trim());
    if (!placed.length && !boxes.length && !shapes.length) { setTexts([]); setActiveText(null); setAddingText(null); return; }
    const marks = shapes.map((sh) => ({ page: sh.page, kind: sh.kind, points: sh.points, color: hexRgb(sh.color), width: sh.width }));
    const items = placed.map((p) => ({ page: p.page, x: p.x, y: p.y, w: p.w, h: p.h, png: dataUrlBytes(p.src) }));
    // 메모는 노란 쪽지(형광펜과 같은 곱하기 섞기 상자)를 먼저 깔고 그 위에 글자를 쓴다
    const notes = boxes.filter((b) => b.note).map((b) => {
      const ls = b.text.split('\n');
      const w = Math.max(...ls.map((l) => textWidth(l, b.family, b.bold, b.size))) + NOTE_PAD.x * 2;
      const h = ls.length * LINE_HEIGHT * b.size + NOTE_PAD.y * 2;
      return { page: b.page, kind: 'highlight' as const, points: [[b.x, b.y], [b.x + w, b.y + h]] as [number, number][], color: hexRgb(NOTE_COLOR), width: 0 };
    });
    marks.unshift(...notes);
    const lines = boxes.flatMap((b) => {
      const base = baselineOffset(b.family, b.bold, b.size);
      const ox = b.note ? NOTE_PAD.x : 0, oy = b.note ? NOTE_PAD.y : 0;
      return b.text.split('\n').map((text, i) => ({
        page: b.page, x: b.x + ox, y: b.y + oy + base + i * LINE_HEIGHT * b.size, size: b.size,
        color: hexRgb(b.color), fontFile: fontFile(b.family, b.bold), text,
      }));
    });
    const kinds = new Set(placed.map((p) => p.kind));
    const what = [kinds.has('sign') && '서명', kinds.has('stamp') && '직인', kinds.has('image') && '그림', boxes.length && '글자', shapes.length && '그린 것'].filter(Boolean).join('·');
    setBusy('넣는 중…');
    try {
      applyPages(await client.place(items, lines, marks), { kind: 'mark', page: (placed[0] ?? boxes[0] ?? shapes[0]).page }, [...new Set([...placed, ...boxes, ...shapes].map((x) => x.page))]);
      setPlaced([]); setActivePlaced(null); setPlacing(null);
      setTexts([]); setActiveText(null); setAddingText(null);
      setShapes([]); setActiveShape(null);
      say(`${what}을 넣었어요. 되돌리기로 뺄 수 있어요.`);
    } catch (e) { say(`넣지 못했어요. ${(e as Error).message}`); }
    finally { setBusy(null); }
  }, [placed, texts, shapes, client, say]); // eslint-disable-line react-hooks/exhaustive-deps
  const applyPlacedRef = useRef(applyPlaced);
  applyPlacedRef.current = applyPlaced;

  /** 놓은 서명·직인을 다른 모든 쪽의 같은 자리에도 놓는다 (쪽 크기가 다르면 비율로 맞춤) */
  const placeOnAllPages = useCallback((id: string) => {
    if (!doc) return;
    const it = placed.find((x) => x.id === id);
    if (!it) return;
    const src = doc.pages[it.page];
    const copies: Placed[] = [];
    doc.pages.forEach((p, i) => {
      if (i === it.page || placed.some((x) => x.page === i && x.src === it.src)) return;
      copies.push({ ...it, id: newId(), page: i, x: (it.x / src.width) * p.width, y: (it.y / src.height) * p.height });
    });
    setPlaced((l) => [...l, ...copies]);
    say(copies.length ? `${copies.length + 1}쪽 모두 같은 자리에 놓았어요. 확인한 뒤 적용을 누르세요.` : '이미 모든 쪽에 놓여 있어요.');
  }, [doc, placed, say]);

  /** 펜·형광펜·도형 그리기 시작/끝 (같은 도구를 다시 누르면 끝) */
  const toggleDraw = useCallback((kind: ShapeKind | null) => {
    setShapeMenu(false);
    setActiveShape(null);
    setDrawKind((k) => (k === kind ? null : kind));
    if (kind) { setPlacing(null); setAddingText(null); setMode('view'); setOverview(false); }
  }, []);

  /** 글자 넣을 곳 고르기 시작 (text: 날짜처럼 미리 정한 글자) */
  const startText = useCallback((text = '', note = false) => {
    setDrawKind(null);
    setPlacing(null);
    setMode('view');
    setOverview(false);
    setDateMenu(false);
    setAddingText({ text, note });
    say(note ? '메모를 붙일 곳을 누르세요. Esc를 누르면 취소돼요.' : text ? '날짜를 넣을 곳을 누르세요. Esc를 누르면 취소돼요.' : '글자를 넣을 곳을 누르세요. Esc를 누르면 취소돼요.');
  }, [say]);

  /** 개인정보 찾기 (옵션이 바뀌면 다시 찾는다. 직접 그린 상자는 그대로) */
  const scanPrivacy = useCallback(async (base: PrivacyState | null, patch: Partial<PrivacyState> = {}) => {
    const opts = { rrnBackOnly: true, clearInfo: true, search: [] as string[], manual: [] as PrivacyState['manual'], drawing: false, ...(base ?? {}), ...patch };
    setBusy('개인정보를 찾는 중…');
    try {
      const r = await client.findPrivate(opts.rrnBackOnly, opts.search);
      setPrivacy({ ...opts, hits: r.hits, noText: r.noText, checked: new Set(r.hits.map((h) => h.id)) });
    } catch (e) { say(`찾지 못했어요. ${(e as Error).message}`); }
    finally { setBusy(null); }
  }, [client, say]);
  const startPrivacy = useCallback(async () => {
    await applyPlacedRef.current();
    setDrawKind(null); setAddingText(null); setPlacing(null); setMode('view'); setOverview(false); setTab('protect');
    await scanPrivacy(null);
  }, [scanPrivacy]);
  const startPrivacyRef = useRef(startPrivacy);
  startPrivacyRef.current = startPrivacy;
  const [confirmRedact, setConfirmRedact] = useState(false);
  const applyPrivacy = useCallback(async () => {
    if (!privacy) return;
    setConfirmRedact(false);
    const areas = privacyAreas(privacy);
    setBusy('지우는 중…');
    try {
      const r = await client.redact(areas, privacy.clearInfo);
      applyPages(r, { kind: 'page', page: areas[0]?.page ?? 0 }, [...new Set(areas.map((a) => a.page))]);
      say(`${areas.length}곳을 지웠어요. 저장하기 전에는 되돌리기로 되돌릴 수 있어요.`);
      setPrivacy(null);
    } catch (e) { say(`지우지 못했어요. ${(e as Error).message}`); }
    finally { setBusy(null); }
  }, [privacy, client, say]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 양식 입력칸에 값 넣기 */
  const setField = useCallback(async (page: number, id: number, value: string) => {
    try { applyPages(await client.setField(page, id, value), { kind: 'mark', page }, [page]); }
    catch (e) { say(`입력하지 못했어요. ${(e as Error).message}`); }
  }, [client, say]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 암호 걸어 저장 / 암호 풀어 저장 */
  const saveLocked = useCallback(async (password: string, printOnly: boolean) => {
    if (!doc) return;
    setLockOpen(false);
    await applyPlacedRef.current();
    setBusy(password ? '암호를 거는 중…' : '암호를 푸는 중…');
    try {
      const bytes = await client.saveProtected(password, printOnly);
      const where = await saveFile(`${baseName(doc.name)}_${password ? '암호' : '암호해제'}.pdf`, bytes);
      if (where) say(password ? '암호를 건 파일로 저장했어요. 암호를 잊지 않게 적어 두세요.' : '암호를 푼 파일로 저장했어요.');
    } catch (e) { say(`저장하지 못했어요. ${(e as Error).message}`); }
    finally { setBusy(null); }
  }, [client, doc, say]);

  /** 그림 파일을 골라 쪽에 놓기 (서명·직인과 같은 방식으로 옮기고 크기를 바꾼다) */
  const pickImageFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f || !doc) return;
      try {
        const src = await fileToDataUrl(f);
        const img = await loadImage(src);
        const page = doc.pages[cur];
        // 96dpi 기준 크기, 쪽 폭의 절반을 넘지 않게
        let w = img.naturalWidth * 0.75, h = img.naturalHeight * 0.75;
        const k = Math.min(1, (page.width * 0.5) / w, (page.height * 0.5) / h);
        w *= k; h *= k;
        pickMarkRef.current({ id: newId(), kind: 'image', src, w, h });
      } catch { say('그림을 열지 못했어요. PNG나 JPG 파일을 골라 주세요.'); }
    };
    input.click();
  }, [doc, cur, say]);

  const pickMark = useCallback((m: Mark) => {
    setMarkDialog(null);
    setMode('view');
    setOverview(false);
    setPlacing(m);
    setDrawKind(null); setAddingText(null);
    say(`${markName(m.kind)}을 넣을 곳을 누르세요. Esc를 누르면 취소돼요.`);
  }, [say]);
  const pickMarkRef = useRef(pickMark);
  pickMarkRef.current = pickMark;

  /** 파일들을 at 자리부터 차례로 넣는다 */
  const insertFiles = useCallback(async (at: number, files: OpenedFile[], navigate = true) => {
    let pos = at, total = 0, first = -1, last: EditResult | null = null;
    const skipped: string[] = [];
    for (let k = 0; k < files.length; k++) {
      const f = files[k], kind = fileKind(f);
      if (!kind || kind === 'office') { skipped.push(f.name); continue; }
      setBusy(`쪽 넣는 중… ${k + 1} / ${files.length}`);
      try {
        const r = await client.insertFile(pos, f.bytes, kind);
        if (r.needsPassword) { skipped.push(`${f.name}(암호)`); continue; }
        if (first < 0) first = r.at;
        pos = r.at + r.count; total += r.count; last = r;
      } catch { skipped.push(f.name); }
    }
    setBusy(null);
    if (last) {
      applyPages(last, { kind: 'page', page: at });
      setSel(new Set());
      requestAnimationFrame(() => goToRef.current(navigate ? first : 0));
    }
    if (total) say(`${total}쪽을 ${first + 1}번째 자리에 넣었어요.${skipped.length ? ` 넣지 못한 파일: ${skipped.join(', ')}` : ''}`);
    else if (skipped.length) say(`넣지 못했어요: ${skipped.join(', ')}. 암호가 걸린 PDF는 먼저 따로 열어 주세요.`);
  }, [client, say]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 시작 화면의 합치기: 첫 PDF를 열고 나머지를 뒤에 붙인다. 사진만 고르면 새 PDF로 만든다 */
  const doMerge = useCallback(async () => {
    const files = (await openFiles()).filter((f) => fileKind(f));
    if (!files.length) return;
    const first = files.findIndex((f) => fileKind(f) === 'pdf');
    if (first >= 0) {
      const ok = await load(files[first]);
      if (!ok) return;
      const rest = files.filter((_, i) => i !== first);
      if (rest.length) await insertFiles(Number.MAX_SAFE_INTEGER, rest, false);
    } else {
      const r = await client.newDoc();
      setDoc({ name: '새 문서.pdf', size: 0, pages: r.pages });
      setDirty(true); setSavedAt(null); setHist({ canUndo: false, canRedo: false }); setLog({ done: [], undone: [] }); setMode('view'); setTab('page'); setOverview(false);
      await insertFiles(0, files, false);
      requestAnimationFrame(() => setTimeout(() => fitWidthRef.current(), 50));
    }
  }, [client, load, insertFiles]);

  /** 저장하고, 실제로 저장했으면 true */
  const doSave = useCallback(async (): Promise<boolean> => {
    if (!doc) return false;
    await applyPlacedRef.current();
    setBusy('저장하는 중…');
    try {
      const bytes = await client.save();
      const where = await saveFile(`${baseName(doc.name)}${dirty ? '_편집' : ''}.pdf`, bytes);
      if (where) { say('저장했어요.'); setDirty(false); setSavedAt(new Date()); return true; }
      return false;
    } catch (e) {
      say(`저장하지 못했어요. ${(e as Error).message}`);
      return false;
    } finally {
      setBusy(null);
    }
  }, [client, doc, dirty, say]);

  // 창을 닫을 때 저장 안 한 내용이 있으면 묻는다 (설치형은 운영체제 창, 브라우저는 떠나기 경고)
  // (탭이 여러 개라 창 닫기 확인은 App이 모아서 한다. 여기서는 이 탭의 상태만 알린다)
  const unsaved = !!doc && (dirty || placed.length > 0 || texts.length > 0 || shapes.length > 0);
  const { onInfo } = props;
  useEffect(() => { onInfo(tabId, { name: doc?.name ?? null, dirty: !!doc && dirty, unsaved }); }, [onInfo, tabId, doc?.name, dirty, unsaved]); // eslint-disable-line react-hooks/exhaustive-deps
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  /** 문서 닫기: 탭이 여러 개면 탭째 닫고, 하나뿐이면 시작 화면으로 */
  const closeDoc = useCallback(() => {
    setConfirmClose(false);
    if (props.tabs.length > 1) { props.onRemoveTab(tabId); return; }
    setPlaced([]); setPlacing(null); setActivePlaced(null);
    setTexts([]); setShapes([]); setPrivacy(null);
    setDoc(null);
    setMode('view');
    setEditing(null);
  }, [props, tabId]);
  const requestClose = useCallback(() => {
    if (unsaved) setConfirmClose(true); else closeDoc();
  }, [unsaved, closeDoc]);

  const targets = useCallback((): number[] => (sel.size ? [...sel].sort((a, b) => a - b) : doc ? [cur] : []), [sel, cur, doc]);

  const applyPages = useCallback((r: EditResult, item?: HistItem, only?: number[]) => {
    if (r.pages) setDoc((d) => (d ? { ...d, pages: r.pages! } : d));
    setHist({ canUndo: r.canUndo, canRedo: r.canRedo });
    if (only) setPageRev((m) => { const n = { ...m }; for (const i of only) n[i] = (n[i] ?? 0) + 1; return n; });
    else { setRev((v) => v + 1); setPageRev({}); }
    setDirty(true);
    if (item) setLog((l) => ({ done: [...l.done, item], undone: [] }));
  }, []);

  const replace = useCallback(async (req: ReplaceRequest, before: string, after: string) => {
    setBusy('글자 바꾸는 중…');
    try { applyPages(await client.replace(req), { kind: 'text', page: req.page, before, after }, [req.page]); }
    catch (e) { say(`글자를 바꾸지 못했어요. ${(e as Error).message}`); }
    finally { setBusy(null); }
  }, [client, applyPages, say]);

  const undo = useCallback(async () => {
    if (!hist.canUndo) return;
    applyPages(await client.undo());
    setLog((l) => (l.done.length ? { done: l.done.slice(0, -1), undone: [...l.undone, l.done[l.done.length - 1]] } : l));
  }, [client, hist, applyPages]);
  const redo = useCallback(async () => {
    if (!hist.canRedo) return;
    applyPages(await client.redo());
    setLog((l) => (l.undone.length ? { done: [...l.done, l.undone[l.undone.length - 1]], undone: l.undone.slice(0, -1) } : l));
  }, [client, hist, applyPages]);

  const rotate = useCallback(async (delta: number, idx?: number[]) => {
    const t = idx ?? targets();
    if (t.length) applyPages(await client.rotate(t, delta), { kind: 'page', page: t[0] }, t);
  }, [client, targets, applyPages]);

  const insertBlank = useCallback(async (at: number) => {
    if (!doc) return;
    const ref = doc.pages[clamp(at - 1, 0, doc.pages.length - 1)] ?? { width: 595.28, height: 841.89 };
    applyPages(await client.insertBlank(at, ref.width, ref.height), { kind: 'page', page: at });
    setSel(new Set());
    requestAnimationFrame(() => goToRef.current(at));
    say(`${at + 1}번째 자리에 빈 쪽을 넣었어요.`);
  }, [client, doc, applyPages, say]);

  const pickFiles = useCallback(async (at: number) => {
    const files = await openFiles();
    if (files.length) insertFiles(at, files);
  }, [insertFiles]);

  const duplicate = useCallback(async (idx?: number[]) => {
    const t = idx ?? targets();
    if (!t.length) return;
    applyPages(await client.duplicate(t), { kind: 'page', page: t[t.length - 1] + 1 });
    setSel(new Set());
    say(`${t.length}쪽을 복제했어요.`);
  }, [client, targets, applyPages, say]);

  const extract = useCallback(async (idx?: number[]) => {
    const t = idx ?? targets();
    if (!doc || !t.length) return;
    setBusy('새 PDF 만드는 중…');
    try {
      const bytes = await client.extract(t);
      const label = t.length === 1 ? `${t[0] + 1}쪽` : `${t.length}쪽`;
      const where = await saveFile(`${baseName(doc.name)}_${label}.pdf`, bytes);
      if (where) say(`${label}을 새 PDF로 저장했어요.`);
    } catch (e) { say(`저장하지 못했어요. ${(e as Error).message}`); }
    finally { setBusy(null); }
  }, [client, doc, targets, say]);

  /** 여러 PDF로 나눠 한 폴더에 저장 */
  const split = useCallback(async (groups: number[][]) => {
    if (!doc) return;
    setSplitOpen(false);
    await applyPlacedRef.current();
    const base = baseName(doc.name), width = String(groups.length).length;
    const files: { name: string; bytes: Uint8Array }[] = [];
    try {
      for (let i = 0; i < groups.length; i++) {
        setBusy(`나누는 중… ${i + 1} / ${groups.length}`);
        files.push({ name: `${base}_${String(i + 1).padStart(width, '0')}_${groupLabel(groups[i])}.pdf`, bytes: await client.extract(groups[i]) });
      }
      setBusy(null);
      const r = await saveFiles('나눈 PDF를 저장할 폴더 고르기', files);
      if (r) say(`PDF ${r.count}개로 나눠 저장했어요.`);
    } catch (e) { say(`나누지 못했어요. ${(e as Error).message}`); }
    finally { setBusy(null); }
  }, [client, doc, say]);

  /** 쪽을 그림 파일로: 한 쪽이면 파일 하나, 여러 쪽이면 폴더에 */
  const exportImages = useCallback(async ({ pages, format, dpi }: ImageExportOptions) => {
    if (!doc) return;
    setImgOpen(false);
    await applyPlacedRef.current();
    const base = baseName(doc.name), width = String(doc.pages.length).length;
    try {
      const files: { name: string; bytes: Uint8Array }[] = [];
      for (let k = 0; k < pages.length; k++) {
        setBusy(`그림 만드는 중… ${k + 1} / ${pages.length}`);
        files.push({ name: `${base}_${String(pages[k] + 1).padStart(width, '0')}쪽.${format}`, bytes: await client.renderImage(pages[k], dpi, format) });
      }
      setBusy(null);
      if (files.length === 1) { if (await saveFile(files[0].name, files[0].bytes)) say('그림으로 저장했어요.'); }
      else { const r = await saveFiles('그림을 저장할 폴더 고르기', files); if (r) say(`그림 ${r.count}개를 저장했어요.`); }
    } catch (e) { say(`그림으로 저장하지 못했어요. ${(e as Error).message}`); }
    finally { setBusy(null); }
  }, [client, doc, say]);

  // 문서를 열면 스캔 문서인지 살펴보고, 글자가 없는 쪽이 절반 이상이면 글자 읽기를 권한다
  const docKey = doc ? `${client.docId}` : '';
  useEffect(() => {
    setTextless(null); setScanHint(false);
    if (!docKey || !doc) return;
    let off = false;
    client.textless().then((t) => { if (off) return; setTextless(t); if (t.length && t.length >= doc.pages.length / 2) setScanHint(true); }).catch(() => {});
    return () => { off = true; };
  }, [docKey]); // eslint-disable-line react-hooks/exhaustive-deps
  /** 한 번에 처리: 지금 문서(되돌리기 가능하게 문서에 넣고 새 이름 저장) 또는 여러 파일(따로 열어 처리 후 폴더에 저장) */
  const runRecipe = async ({ recipe: r, password, target }: RecipeRun) => {
    if (!doc) return;
    setRecipeOpen(false);
    await applyPlacedRef.current();
    const fin = { clearInfo: r.clearInfo, shrink: r.shrink, password: r.lock ? password : '', printOnly: r.printOnly };
    const marks = async (c: PdfClient) => {
      if (r.pageNumbers) await c.pageNumbers(savedPageNumberOptions());
      if (r.watermark.trim()) await c.watermark(savedWatermarkOptions(r.watermark.trim()));
    };
    try {
      if (target === 'current') {
        setBusy(`${r.name} 처리 중…`);
        if (r.pageNumbers || r.watermark.trim()) {
          if (r.pageNumbers) applyPages(await client.pageNumbers(savedPageNumberOptions()), { kind: 'mark', page: cur });
          if (r.watermark.trim()) applyPages(await client.watermark(savedWatermarkOptions(r.watermark.trim())), { kind: 'mark', page: cur });
        }
        const bytes = await client.finish(fin);
        setBusy(null);
        if (await saveFile(`${baseName(doc.name)}${r.suffix}.pdf`, bytes)) say(`${r.name}으로 저장했어요.${r.pageNumbers || r.watermark.trim() ? ' 넣은 쪽 번호·워터마크는 되돌리기로 뺄 수 있어요.' : ''}`);
        return;
      }
      let files: OpenedFile[];
      try { files = await openFiles(); } catch (e) { say((e as Error).message); return; }
      files = files.filter((f) => fileKind(f) === 'pdf');
      if (!files.length) return;
      const out: { name: string; bytes: Uint8Array }[] = [];
      const skipped: string[] = [];
      for (let k = 0; k < files.length; k++) {
        setBusy(`${r.name} 처리 중… ${k + 1} / ${files.length}`);
        const c = new PdfClient();
        try {
          const o = await c.open(files[k].bytes);
          if (o.needsPassword) { skipped.push(`${files[k].name}(암호)`); continue; }
          await marks(c);
          out.push({ name: `${baseName(files[k].name)}${r.suffix}.pdf`, bytes: await c.finish(fin) });
        } catch { skipped.push(files[k].name); }
        finally { c.close(); }
      }
      setBusy(null);
      if (out.length) {
        const w = await saveFiles('처리한 PDF를 저장할 폴더 고르기', out);
        if (w) say(`PDF ${w.count}개를 ${r.name}으로 저장했어요.${skipped.length ? ` 못 한 파일: ${skipped.join(', ')}` : ''}`);
      } else say(`처리하지 못했어요. ${skipped.join(', ')}`);
    } catch (e) { say(`처리하지 못했어요. ${(e as Error).message}`); }
    finally { setBusy(null); }
  };
  /** 비교할 이전 판 PDF 고르기 */
  const startCompare = async () => {
    await applyPlacedRef.current();
    try { const f = await openFile(); if (f) setCompareWith(f); }
    catch (e) { say((e as Error).message); }
  };
  const openOcr = () => {
    setScanHint(false);
    setTextless(null);
    client.textless().then(setTextless).catch(() => setTextless([]));
    setOcrOpen(true);
  };
  /** 고른 쪽을 차례로 그림으로 그려 읽고, 다 읽으면 한 번에 넣는다 (되돌리기 한 번) */
  const runOcr = useCallback(async (pages: number[]) => {
    if (!doc) return;
    await applyPlacedRef.current();
    ocrStop.current = false;
    setOcrProgress({ done: 0, total: pages.length, stopping: false });
    const scale = 300 / 72;
    const results: { index: number; scale: number; words: import('./lib/protocol').OcrWord[] }[] = [];
    let words = 0, failed = '';
    try {
      // 그리기는 PDF 스레드에서 차례로, 읽기는 OCR 일꾼 여럿이 함께
      let next = 0, done = 0;
      const lanes = Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
      await Promise.all(Array.from({ length: lanes }, async () => {
        while (next < pages.length && !ocrStop.current) {
          const i = pages[next++];
          const img = await client.renderOcr(i, scale);
          const r = await recognize(img.png, img.table);
          results.push({ index: i, scale, words: r.words });
          words += r.words.length;
          done++;
          setOcrProgress((p) => (p ? { ...p, done } : p));
        }
      }));
    } catch (e) { failed = (e as Error).message || String(e); }
    try {
      const got = results.filter((r) => r.words.length);
      if (got.length) {
        applyPages(await client.ocrText(got), { kind: 'mark', page: got[0].index }, got.map((r) => r.index));
        setTextless((t) => (t ? t.filter((i) => !got.some((r) => r.index === i)) : t));
      }
      if (failed) say(`글자를 읽다가 멈췄어요. ${failed}`);
      else if (!got.length) say('읽을 수 있는 글자를 찾지 못했어요.');
      else say(`${got.length}쪽에서 낱말 ${words.toLocaleString()}개를 읽었어요. 이제 찾기(Ctrl+F)와 복사가 돼요.`);
    } catch (e) { say(`읽은 글자를 넣지 못했어요. ${(e as Error).message}`); }
    finally {
      setOcrProgress(null); setOcrOpen(false);
      void stopOcr();
    }
  }, [client, doc, say]); // eslint-disable-line react-hooks/exhaustive-deps

  const reorder = useCallback(async (order: number[]) => {
    applyPages(await client.move(order), { kind: 'page', page: order.indexOf(cur) });
    setSel(new Set());
    setCur(order.indexOf(cur));
  }, [client, applyPages, cur]);

  const remove = useCallback(async (idx?: number[]) => {
    const t = idx ?? targets();
    if (!doc || !t.length) return;
    if (t.length >= doc.pages.length) { say('모든 페이지를 지울 수는 없어요. 한 쪽 이상 남겨 주세요.'); return; }
    applyPages(await client.delete(t), { kind: 'page', page: t[0] });
    setSel(new Set());
    setCur((c) => clamp(c, 0, doc.pages.length - t.length - 1));
    say(`${t.length}쪽을 지웠어요. 되돌리기로 살릴 수 있어요.`);
  }, [client, doc, targets, applyPages, say]);

  const move = useCallback(async (dir: -1 | 1) => {
    if (!doc) return;
    const t = new Set(targets());
    const order = doc.pages.map((_, i) => i);
    if (dir < 0) { for (let i = 1; i < order.length; i++) if (t.has(order[i]) && !t.has(order[i - 1])) [order[i - 1], order[i]] = [order[i], order[i - 1]]; }
    else { for (let i = order.length - 2; i >= 0; i--) if (t.has(order[i]) && !t.has(order[i + 1])) [order[i + 1], order[i]] = [order[i], order[i + 1]]; }
    applyPages(await client.move(order), { kind: 'page', page: cur });
    const newSel = new Set(order.map((o, i) => (t.has(o) ? i : -1)).filter((i) => i >= 0));
    setSel(sel.size ? newSel : new Set());
    setCur(order.indexOf(cur));
  }, [client, doc, targets, applyPages, sel, cur]);

  const doPrint = useCallback(async ({ range, custom, dpi, per, border }: PrintOptions) => {
    if (!doc) return;
    setPrintOpen(false);
    await applyPlacedRef.current();
    const list = range === 'all' ? doc.pages.map((_, i) => i) : range === 'current' ? [cur] : range === 'custom' ? custom : targets();
    const pages: PrintPage[] = [];
    try {
      // 모아 찍기: per쪽씩 한 장에
      if (per > 1) {
        const sheets = Math.ceil(list.length / per);
        for (let k = 0; k < sheets; k++) {
          setBusy(`인쇄 준비 중… ${k + 1} / ${sheets}장`);
          pages.push({ png: await client.renderSheet(list.slice(k * per, (k + 1) * per), per as 2 | 4, dpi, border), landscape: per === 2 });
        }
      }
      else for (let k = 0; k < list.length; k++) {
        setBusy(`인쇄 준비 중… ${k + 1} / ${list.length}쪽`);
        const info = doc.pages[list[k]];
        const landscape = info.width > info.height;
        // 가로 페이지는 세로 용지에 꽉 차도록 90도 돌려 그린다
        pages.push({ png: await client.renderPng(list[k], dpi / 72, landscape ? 90 : 0), landscape });
      }
      setBusy(null);
      const r = await printPages(baseName(doc.name), pages);
      if (!r.ok && r.reason && r.reason !== 'cancelled') say(`인쇄하지 못했어요. (${r.reason})`);
    } catch (e) {
      say(`인쇄 준비 중 문제가 생겼어요. ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [client, doc, cur, targets, say]);

  // 스크롤 위치로 지금 보는 쪽 추적
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const mid = v.scrollTop + v.clientHeight * 0.4;
        let c = 0;
        v.querySelectorAll<HTMLElement>('.page').forEach((el, i) => { if (el.offsetTop <= mid) c = i; });
        setCur(c);
      });
    };
    v.addEventListener('scroll', onScroll);
    return () => v.removeEventListener('scroll', onScroll);
  }, [doc]);

  const goTo = useCallback((i: number) => {
    const els = viewer.current?.querySelectorAll<HTMLElement>('.page');
    if (!els || !els.length) return;
    const n = clamp(i, 0, els.length - 1);
    if (viewer.current) viewer.current.scrollTop = els[n].offsetTop - 24;
    setCur(n);
  }, []);
  // 찾기: 글자를 바꾸거나 문서가 바뀌면 다시 찾는다
  const findSeq = useRef(0);
  useEffect(() => {
    if (!find.open || !doc) return;
    const q = find.q.trim();
    const seq = ++findSeq.current;
    if (!q) { setFind((f) => ({ ...f, hits: [], idx: 0, busy: false })); return; }
    setFind((f) => ({ ...f, busy: true }));
    const t = setTimeout(async () => {
      try {
        const hits = await client.find(q);
        if (seq !== findSeq.current) return;
        setFind((f) => {
          // 같은 쪽 근처의 첫 결과부터 보여 준다
          const start = Math.max(0, hits.findIndex((h) => h.page >= cur));
          return { ...f, hits, idx: f.q.trim() === q && f.hits.length ? Math.min(f.idx, Math.max(0, hits.length - 1)) : start, busy: false };
        });
      } catch { if (seq === findSeq.current) setFind((f) => ({ ...f, hits: [], busy: false })); }
    }, 180);
    return () => clearTimeout(t);
  }, [find.q, find.open, doc, hist, client]); // eslint-disable-line react-hooks/exhaustive-deps
  const findCur = find.open && find.hits.length ? find.hits[find.idx] ?? null : null;
  // 지금 찾은 자리가 화면 가운데 오도록
  useEffect(() => {
    const v = viewer.current;
    if (!findCur || !v) return;
    const el = v.querySelectorAll<HTMLElement>('.page')[findCur.page];
    if (!el) return;
    const y = el.offsetTop + findCur.rect[1] * zoom, x = el.offsetLeft + findCur.rect[0] * zoom;
    if (y < v.scrollTop + 40 || y > v.scrollTop + v.clientHeight - 60) v.scrollTop = y - v.clientHeight * 0.35;
    if (x < v.scrollLeft || x > v.scrollLeft + v.clientWidth - 40) v.scrollLeft = x - v.clientWidth * 0.3;
  }, [findCur, zoom]);
  const moveFind = (d: 1 | -1) => setFind((f) => (f.hits.length ? { ...f, idx: (f.idx + d + f.hits.length) % f.hits.length } : f));
  const openFind = () => {
    if (!doc) return;
    const picked = window.getSelection()?.toString().trim();
    setFind((f) => ({ ...f, open: true, q: picked && picked.length < 60 && !picked.includes('\n') ? picked : f.q }));
  };

  // 보기 화면에서 끌어 고른 글자
  const [textSel, setTextSel] = useState<TextSelection | null>(null);
  useEffect(() => { setTextSel(null); }, [doc, hist]);
  const copySel = useCallback(async (s = textSel) => {
    if (!s) return;
    try { await navigator.clipboard.writeText(s.text); say('복사했어요. 다른 곳에 Ctrl+V로 붙여 넣으세요.'); }
    catch { say('복사하지 못했어요.'); }
  }, [textSel, say]);
  const highlightSel = useCallback(async () => {
    const s = textSel;
    if (!s) return;
    setTextSel(null);
    const marks = s.rects.map((r) => ({ page: s.page, kind: 'highlight' as const, points: [[r[0], r[1]], [r[2], r[3]]] as [number, number][], color: hexRgb(markerColor), width: 0 }));
    try {
      applyPages(await client.place([], [], marks), { kind: 'mark', page: s.page }, [s.page]);
      say('형광펜을 칠했어요. 되돌리기로 뺄 수 있어요.');
    } catch (e) { say(`칠하지 못했어요. ${(e as Error).message}`); }
  }, [textSel, markerColor, client, say]); // eslint-disable-line react-hooks/exhaustive-deps
  // Ctrl+C: 입력칸 밖에서 고른 글자가 있으면 그것을 복사
  useEffect(() => {
    if (!active || !textSel) return;
    const onCopy = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA'].includes(t.tagName))) return;
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', textSel.text);
      say('복사했어요. 다른 곳에 Ctrl+V로 붙여 넣으세요.');
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, [active, textSel, say]);
  const selecting = mode !== 'edit' && !privacy && !drawKind && !placing && !addingText && !placed.length && !texts.length && !shapes.length;

  /** 쪽 안의 높이(y)까지 맞춰 이동 (목차) */
  const goToY = useCallback((i: number, y?: number) => {
    const v = viewer.current, el = v?.querySelectorAll<HTMLElement>('.page')[i];
    if (!v || !el) return;
    v.scrollTop = el.offsetTop + (y ?? 0) * zoom - 24;
    setCur(i);
  }, [zoom]);
  // 목차 개수 (왼쪽 '목차' 옆 숫자)
  useEffect(() => {
    if (!doc) return;
    let off = false;
    client.outline().then((l) => { if (!off) { const c = (x: typeof l): number => x.reduce((n, b) => n + 1 + c(b.children), 0); setOutlineCount(c(l)); } }).catch(() => {});
    return () => { off = true; };
  }, [client, doc, hist]); // eslint-disable-line react-hooks/exhaustive-deps

  const goToRef = useRef(goTo);
  goToRef.current = goTo;
  const fitWidthRef = useRef(() => {});
  fitWidthRef.current = () => { if (doc) fitWidth(doc.pages, true); };

  const onThumb = (i: number, e: React.MouseEvent) => {
    if (i < 0) { setSel(new Set()); return; }
    const s = new Set(sel);
    if (e.shiftKey && lastClick.current !== null) {
      s.clear();
      for (let k = Math.min(lastClick.current, i); k <= Math.max(lastClick.current, i); k++) s.add(k);
    } else if (e.ctrlKey || e.metaKey) {
      s.has(i) ? s.delete(i) : s.add(i);
      lastClick.current = i;
    } else {
      s.clear();
      s.add(i);
      lastClick.current = i;
    }
    setSel(s);
    if (!overview) goTo(i); else setCur(i);
  };

  // 단축키, 끌어다 놓기, 설치형에서 파일 연결로 열기
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.cmpview')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'o') { e.preventDefault(); doOpen(); }
      else if (mod && k === 's') { e.preventDefault(); doSave(); }
      else if (mod && k === 'p') { e.preventDefault(); if (doc) setPrintOpen(true); }
      else if (mod && k === 'f') { e.preventDefault(); if (doc && !document.querySelector('.modal')) { setOverview(false); openFind(); } }
      else if (e.key === 'F3' && find.open) { e.preventDefault(); moveFind(e.shiftKey ? -1 : 1); }
      else if ((e.target as HTMLElement).isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) || document.querySelector('.modal')) return;
      else if (e.key === 'Escape' && addingText) { e.preventDefault(); setAddingText(null); }
      else if (e.key === 'Escape' && privacy?.drawing) { e.preventDefault(); setPrivacy({ ...privacy, drawing: false }); }
      else if (e.key === 'Escape' && drawKind) { e.preventDefault(); setDrawKind(null); }
      else if (e.key === 'Escape' && activeShape) { e.preventDefault(); setActiveShape(null); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && activeShape) { e.preventDefault(); setShapes((l) => l.filter((x) => x.id !== activeShape)); setActiveShape(null); }
      else if (e.key === 'Escape' && (placing || activePlaced)) { e.preventDefault(); if (placing) setPlacing(null); else setActivePlaced(null); }
      else if (e.key === 'Enter' && (placed.length || texts.length || shapes.length)) { e.preventDefault(); applyPlacedRef.current(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && activePlaced) { e.preventDefault(); setPlaced((l) => l.filter((x) => x.id !== activePlaced)); setActivePlaced(null); }
      else if (!mod && k === 't' && doc && !overview) { e.preventDefault(); startText(); }
      else if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && k === 'y') { e.preventDefault(); redo(); }
      else if (!mod && k === 'e' && doc) { setTab('edit'); setMode((m) => (m === 'edit' ? 'view' : 'edit')); }
      else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom((z) => clamp(z * 1.2, 0.25, 4)); }
      else if (mod && e.key === '-') { e.preventDefault(); setZoom((z) => clamp(z / 1.2, 0.25, 4)); }
      else if (e.key === 'Escape') { setPrintOpen(false); if (mode === 'edit' && !editing) setMode('view'); }
      else if (doc && (e.key === 'PageDown' || (e.key === 'ArrowRight' && !mod))) { goTo(cur + 1); }
      else if (doc && (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !mod))) { goTo(cur - 1); }
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      const list = [...(e.dataTransfer?.files ?? [])].filter((f) => fileKind(f));
      if (!list.length) { say('PDF, 한글·워드·엑셀, JPG·PNG 파일을 넣을 수 있어요.'); return; }
      const files = await readDroppedAll(list, (name, msg) => say(`"${name}": ${msg}`));
      if (!files.length) return;
      if (doc) { insertFiles(cur + 1, files); return; }
      const first = files.findIndex((f) => fileKind(f) === 'pdf');
      if (first < 0) { say('사진을 PDF로 만들려면 시작 화면의 "합치기"를 써 주세요.'); return; }
      if (await load(files[first])) {
        const rest = files.filter((_, i) => i !== first);
        if (rest.length) insertFiles(Number.MAX_SAFE_INTEGER, rest);
      }
    };
    const onOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener('keydown', onKey);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onOver);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onOver);
    };
  }, [doOpen, doSave, load, doc, undo, redo, mode, editing, goTo, cur, say, insertFiles, placing, activePlaced, placed.length, addingText, texts.length, startText, overview, drawKind, activeShape, shapes.length, privacy, active, find.open]);

  // 탐색기에서 PDF를 두 번 눌러 열거나, 이미 켜진 창에 파일을 보낼 때
  const loadRef = useRef(load);
  loadRef.current = load;
  // 바깥(App)에서 이 탭에 시킬 수 있는 일
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  const { register } = props;
  useEffect(() => {
    register(tabId, {
      save: () => doSaveRef.current(),
      requestClose: () => requestCloseRef.current(),
      load: (f) => loadRef.current(f),
    });
    return () => register(tabId, null);
  }, [register, tabId]);
  // 새 탭으로 연 파일
  useEffect(() => {
    if (props.initialFile) { pendingAction.current = props.initialAction; loadRef.current(props.initialFile); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const curPage = doc?.pages[cur];
  const edits = log.done.filter((h) => h.kind === 'text');
  const curStyle = editing ? styleOverride ?? editing.style : null;
  const activeItem = placed.find((x) => x.id === activePlaced) ?? null;
  const soon = '다음 버전에서 추가돼요';
  const pageActions: PageActions = {
    targetsFor: (i) => (sel.has(i) ? [...sel].sort((a, b) => a - b) : [i]),
    onInsertBlank: insertBlank,
    onPickFiles: pickFiles,
    onDuplicate: duplicate,
    onRotate: (idx, d) => rotate(d, idx),
    onExtract: extract,
    onDelete: remove,
  };

  if (!doc) {
    return (
      <>
        {props.tabs.length > 1 && <div className="starttabs"><TabStrip tabs={props.tabs} activeId={tabId} onSelect={props.onSelectTab} onClose={(id) => (id === tabId ? closeDoc() : props.onCloseTab(id))} onNew={props.onNewTab} /></div>}
        <StartScreen easy={easy} easyScale={easyScale} onEasy={setEasy} onEasyScale={setEasyScale} onHelp={() => props.onHelp()} onOpen={(a) => (a === 'merge' ? doMerge() : doOpen(a))} onOpenRecent={doOpenRecent} />
        {pw && <PasswordDialog pw={pw} onCancel={() => setPw(null)} onSubmit={(v) => load(pw.file, v)} />}
        {busy && <div className="busy"><div>{busy}</div></div>}
        <div className={`toast${toast ? ' show' : ''}`} role="status">{toast}</div>
      </>
    );
  }

  const tool = (icon: string, label: string, onClick?: () => void, opts: { on?: boolean; disabled?: boolean; danger?: boolean; title?: string } = {}) => (
    <button
      className={`tool${opts.on ? ' on' : ''}${opts.danger ? ' danger' : ''}`}
      onClick={onClick}
      disabled={opts.disabled || !onClick}
      aria-pressed={opts.on}
      title={opts.title ?? (!onClick ? soon : undefined)}
    >
      <Icon name={icon} />{label}
    </button>
  );

  return (
    <div className="app">
      <header className="topbar">
        <Logo size={24} />
        <TabStrip tabs={props.tabs} activeId={tabId} onSelect={props.onSelectTab} onClose={(id) => (id === tabId ? requestClose() : props.onCloseTab(id))} onNew={props.onNewTab} />
        <div className="topright">
          <button className="iconbtn" aria-label="문서에서 찾기" title="문서에서 찾기 (Ctrl+F)" onClick={() => { setOverview(false); openFind(); }}><Icon name="search" size={19} /></button>
          <button className="iconbtn" aria-label="실행 취소" title="실행 취소 (Ctrl+Z)" onClick={undo} disabled={!hist.canUndo}><Icon name="undo" size={19} /></button>
          <button className="iconbtn" aria-label="다시 실행" title="다시 실행 (Ctrl+Shift+Z)" onClick={redo} disabled={!hist.canRedo}><Icon name="redo" size={19} /></button>
          <span className="vsep" aria-hidden="true" />
          <button className="iconbtn helpbtn" aria-label="도움말" title="도움말 (F1)" onClick={() => props.onHelp(privacy ? 'privacy' : mode === 'edit' ? 'edit' : drawKind ? 'draw' : addingText ? (addingText.note ? 'memo' : 'text') : placing ? (placing.kind === 'stamp' ? 'stamp' : 'sign') : overview ? 'pages' : fieldCount ? 'form' : undefined)}><Icon name="help" size={19} /><span>도움말</span></button>
          <span className="vsep" aria-hidden="true" />
          <button className="btn" onClick={() => setPrintOpen(true)} title="인쇄 (Ctrl+P)"><Icon name="print" size={17} />인쇄</button>
          <button className="btn navy" onClick={doSave} title="저장 (Ctrl+S)">저장</button>
        </div>
      </header>

      <div className="toolbar" role="toolbar" aria-label="도구">
        <div className="menutabs" role="tablist" aria-label="메뉴">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => { setTab(t.id); if (t.id !== 'page') setOverview(false); }}>{t.label}</button>
          ))}
        </div>
        <span className="vsep" aria-hidden="true" />
        {tab === 'home' && (
          <div className="tools">
            {tool('open', '열기', () => doOpen())}
            {tool('merge', '합치기', () => pickFiles(doc.pages.length), { title: '다른 PDF나 사진을 맨 뒤에 붙이기' })}
            {tool('save', '저장', doSave)}
            {tool('print', '인쇄', () => setPrintOpen(true))}
            {tool('image', '그림으로', () => setImgOpen(true), { title: '쪽을 JPG·PNG 그림 파일로 저장' })}
            {tool('ocr', '글자 읽기', () => openOcr(), { title: '스캔·사진 문서의 글자를 읽어서 찾기·복사가 되게 하기' })}
            {tool('batch', '한 번에', () => setRecipeOpen(true), { title: '쪽 번호·워터마크·용량 줄이기·암호 등을 묶어서 한 번에 (여러 파일도)' })}
            {tool('compare', '비교', () => startCompare(), { title: '다른 PDF(이전 판)와 글자가 어디가 다른지 비교' })}
            <span className="vsep" aria-hidden="true" />
            {tool('fit', '폭에 맞추기', () => fitWidth(doc.pages))}
          </div>
        )}
        {tab === 'edit' && (
          <div className="tools">
            {tool('edit', '글자 고치기', () => { applyPlacedRef.current(); setPlacing(null); setAddingText(null); setDrawKind(null); setOverview(false); setMode((m) => (m === 'edit' ? 'view' : 'edit')); }, { on: mode === 'edit', title: '글자 고치기 (E)' })}
            {tool('text', '글자 추가', () => (addingText && !addingText.text ? setAddingText(null) : startText()), { on: !!addingText && !addingText.text, title: '빈 곳에 글자 쓰기 (T)' })}
            <div className="dropwrap">
              {tool('calendar', '날짜', () => setDateMenu((v) => !v), { on: dateMenu || !!addingText?.text, title: '오늘 날짜 넣기' })}
              {dateMenu && (
                <div className="dropmenu" role="menu" onMouseLeave={() => setDateMenu(false)}>
                  {dateFormats(new Date()).map((d) => (
                    <button key={d} role="menuitem" onClick={() => startText(d)}>{d}</button>
                  ))}
                </div>
              )}
            </div>
            {tool('image', '그림', pickImageFile, { title: '사진·그림 파일을 쪽 위에 넣기' })}
            <span className="vsep" aria-hidden="true" />
            {tool('highlight', '형광펜', () => toggleDraw('highlight'), { on: drawKind === 'highlight', title: '끌어서 형광펜 칠하기' })}
            {tool('pen', '펜', () => toggleDraw('pen'), { on: drawKind === 'pen', title: '자유롭게 그리기' })}
            <div className="dropwrap">
              {tool('shape', '도형·체크', () => setShapeMenu((v) => !v), { on: shapeMenu || (!!drawKind && SHAPE_KINDS.some((k) => k.id === drawKind)), title: '체크 표시, 네모, 동그라미, 선, 화살표' })}
              {shapeMenu && (
                <div className="dropmenu" role="menu" onMouseLeave={() => setShapeMenu(false)}>
                  {SHAPE_KINDS.map((k) => (
                    <button key={k.id} role="menuitem" onClick={() => toggleDraw(k.id)}><span className="dm-ico">{k.icon}</span>{k.label}</button>
                  ))}
                </div>
              )}
            </div>
            <span className="vsep" aria-hidden="true" />
            {tool('ocr', '글자 읽기', () => openOcr(), { title: '스캔·사진 문서의 글자를 읽어서 찾기·복사가 되게 하기' })}
            <span className="vsep" aria-hidden="true" />
            {tool('sign', '서명', () => setMarkDialog('sign'), { title: '서명 그리기·불러오기' })}
            {tool('stamp', '직인', () => setMarkDialog('stamp'), { title: '직인 만들기·불러오기' })}
          </div>
        )}
        {tab === 'page' && (
          <div className="tools">
            {tool('pages', '한눈에 보기', () => { setOverview((o) => !o); setMode('view'); }, { on: overview, title: '모든 쪽을 펼쳐 놓고 끌어서 순서 바꾸기' })}
            <span className="vsep" aria-hidden="true" />
            {tool('plus', '빈 쪽 넣기', () => insertBlank((sel.size ? Math.max(...sel) : cur) + 1), { title: '지금 보는 쪽 뒤에 빈 쪽 넣기' })}
            {tool('merge', '파일에서 넣기', () => pickFiles((sel.size ? Math.max(...sel) : cur) + 1), { title: '다른 PDF나 사진을 지금 보는 쪽 뒤에 넣기' })}
            {tool('pages', '복제', () => duplicate())}
            <span className="vsep" aria-hidden="true" />
            {tool('rotl', '왼쪽으로', () => rotate(-90))}
            {tool('rotr', '오른쪽으로', () => rotate(90))}
            {tool('up', '앞으로', () => move(-1))}
            {tool('down', '뒤로', () => move(1))}
            <span className="vsep" aria-hidden="true" />
            {tool('hash', '쪽 번호', () => setMarkOpen('num'), { title: '모든 쪽에 쪽 번호 넣기' })}
            {tool('water', '워터마크', () => setMarkOpen('wm'), { title: '"사본", "대외비" 같은 글자를 쪽 가운데에 연하게 넣기' })}
            <span className="vsep" aria-hidden="true" />
            {tool('save', '새 PDF로 저장', () => extract(), { title: '고른 쪽(없으면 지금 보는 쪽)만 새 PDF로 저장' })}
            {tool('image', '그림으로', () => setImgOpen(true), { title: '쪽을 JPG·PNG 그림 파일로 저장' })}
            {tool('split', '나누기', () => setSplitOpen(true), { title: '한 쪽씩, 몇 쪽씩, 원하는 범위대로 여러 PDF로 나누기' })}
            {tool('trash', '지우기', () => remove(), { danger: true })}
            <span className="hint">{sel.size ? `${sel.size}쪽 골랐어요` : 'Ctrl·Shift로 여러 쪽 고르기'}</span>
          </div>
        )}
        {tab === 'note' && (
          <div className="tools">
            {tool('note', '메모', () => (addingText?.note ? setAddingText(null) : startText('', true)), { on: !!addingText?.note, title: '노란 쪽지처럼 붙이는 메모 (인쇄에도 나와요)' })}
            {tool('highlight', '형광펜', () => toggleDraw('highlight'), { on: drawKind === 'highlight' })}
            {tool('pen', '밑줄', () => toggleDraw('line'), { on: drawKind === 'line', title: '끌어서 밑줄 긋기' })}
          </div>
        )}
        {tab === 'protect' && (
          <div className="tools">
            {tool('shield', '개인정보 지우기', () => (privacy ? setPrivacy(null) : startPrivacy()), { on: !!privacy, title: '주민번호·전화번호 등을 찾아 완전히 지우기' })}
            {tool('lock', encrypted ? '암호 걸기·풀기' : '암호 걸기', () => setLockOpen(true), { title: '열 때 암호를 묻는 파일로 저장' })}
            {tool('save', '용량 줄이기', () => setShrinkOpen(true), { title: '사진·스캔을 줄여 메일로 보내기 좋게' })}
          </div>
        )}
      </div>

      <div className="work">
        <div className={`side${side === 'outline' ? ' wide' : ''}`}>
          <div className="sidetabs" role="tablist" aria-label="왼쪽 보기">
            <button role="tab" aria-selected={side === 'pages'} className={side === 'pages' ? 'on' : ''} onClick={() => setSide('pages')}>쪽</button>
            <button role="tab" aria-selected={side === 'outline'} className={side === 'outline' ? 'on' : ''} onClick={() => setSide('outline')}>목차{outlineCount > 0 && <small>{outlineCount}</small>}</button>
          </div>
          {side === 'pages' ? (
            <PageRail client={client} pages={doc.pages} rev={rev} pageRev={pageRev} cur={cur} sel={sel} onThumb={onThumb} onReorder={reorder} onInsertFiles={insertFiles} {...pageActions} />
          ) : (
            <OutlinePanel
              client={client} version={`${client.docId}:${rev}:${hist.canUndo}:${hist.canRedo}:${JSON.stringify(pageRev).length}`} cur={cur}
              onGo={goToY}
              onApply={async (list) => { try { applyPages(await client.setOutline(list), { kind: 'page', page: cur }, []); } catch (e) { say(`목차를 고치지 못했어요. ${(e as Error).message}`); } }}
              onMessage={say}
            />
          )}
        </div>

        <main className="stage">
          {overview && (
            <>
              <PageGrid
                client={client} pages={doc.pages} rev={rev} pageRev={pageRev} cur={cur} sel={sel} size={gridSize}
                onThumb={(i, e) => { if (i < 0) { setSel(new Set()); return; } onThumb(i, e); }}
                onOpenPage={(i) => { setOverview(false); requestAnimationFrame(() => goToRef.current(i)); }}
                onReorder={reorder}
                onInsertBlank={insertBlank}
                onContext={(i, x, y) => setGridMenu({ i, x, y })}
              />
              <div className="floatnav">
                <span className="pn">{sel.size ? `${sel.size}쪽 골랐어요` : `모두 ${doc.pages.length}쪽`}</span>
                <span className="vsep" aria-hidden="true" />
                <button aria-label="작게 보기" onClick={() => setGridSize((g) => clamp(g - 30, 100, 290))}><Icon name="minus" size={16} /></button>
                <span className="zv">크기</span>
                <button aria-label="크게 보기" onClick={() => setGridSize((g) => clamp(g + 30, 100, 290))}><Icon name="plus" size={16} /></button>
                <button className="txt" onClick={() => setOverview(false)}>한 쪽씩 보기</button>
              </div>
              <PageMenu menu={gridMenu} onClose={() => setGridMenu(null)} actions={pageActions} />
            </>
          )}
          <div className="viewer" hidden={overview} ref={viewerRef}>
            <div className={`pages${mode === 'edit' ? ' editing' : ''}`}>
              {doc.pages.map((p, i) => (
                <div key={i} className="page">
                  <PageCanvas client={client} index={i} info={p} zoom={zoom} rev={rev * 10000 + (pageRev[i] ?? 0)} root={viewerEl} className="sheet" />
                  {fieldCount > 0 && mode !== 'edit' && !privacy && (
                    <FormLayer client={client} index={i} info={p} zoom={zoom} rev={rev * 10000 + (pageRev[i] ?? 0)} onSet={setField} />
                  )}
                  {selecting && (
                    <SelectLayer
                      client={client} index={i} info={p} zoom={zoom} rev={rev * 10000 + (pageRev[i] ?? 0)}
                      current={textSel} onSelect={setTextSel} onCopy={() => copySel()} onHighlight={highlightSel}
                    />
                  )}
                  {find.open && find.hits.some((h) => h.page === i) && (
                    <FindLayer info={p} zoom={zoom} hits={find.hits.filter((h) => h.page === i)} current={findCur?.page === i ? findCur : null} />
                  )}
                  {privacy && (
                    <RedactLayer
                      index={i} info={p} zoom={zoom} state={privacy}
                      onToggle={(id) => { const c = new Set(privacy.checked); if (c.has(id)) c.delete(id); else c.add(id); setPrivacy({ ...privacy, checked: c }); }}
                      onAddBox={(page, rect) => setPrivacy({ ...privacy, manual: [...privacy.manual, { id: newId(), page, rect }] })}
                      onRemoveBox={(id) => setPrivacy({ ...privacy, manual: privacy.manual.filter((m) => m.id !== id) })}
                    />
                  )}
                  {(drawKind || shapes.some((x) => x.page === i)) && (
                    <ShapeLayer
                      index={i} info={p} zoom={zoom}
                      shapes={shapes.filter((x) => x.page === i)}
                      activeId={activeShape}
                      tool={drawTool}
                      onAdd={(sh) => setShapes((l) => [...l, { ...sh, id: newId() }])}
                      onSelect={setActiveShape}
                      onChange={(id, patch) => setShapes((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)))}
                      onRemove={(id) => { setShapes((l) => l.filter((x) => x.id !== id)); setActiveShape(null); }}
                      onApply={() => applyPlacedRef.current()}
                    />
                  )}
                  {(placing || placed.some((x) => x.page === i)) && (
                    <PlaceLayer
                      index={i} info={p} zoom={zoom}
                      items={placed.filter((x) => x.page === i)}
                      activeId={activePlaced}
                      placing={placing}
                      onPlace={(page, cx, cy) => {
                        if (!placing) return;
                        const it: Placed = { id: newId(), page, kind: placing.kind, src: placing.src, w: placing.w, h: placing.h, x: cx - placing.w / 2, y: cy - placing.h / 2 };
                        setPlaced((l) => [...l, it]); setActivePlaced(it.id); setPlacing(null);
                      }}
                      onChange={(id, patch) => setPlaced((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)))}
                      onSelect={setActivePlaced}
                      onRemove={(id) => { setPlaced((l) => l.filter((x) => x.id !== id)); setActivePlaced(null); }}
                      onApply={() => applyPlacedRef.current()}
                      onAgain={(id) => { const it = placed.find((x) => x.id === id); if (it) setPlacing({ id: newId(), kind: it.kind, src: it.src, w: it.w, h: it.h }); }}
                      onAllPages={doc.pages.length > 1 ? placeOnAllPages : undefined}
                    />
                  )}
                  {(addingText || texts.some((t) => t.page === i)) && (
                    <TextLayer
                      index={i} info={p} zoom={zoom}
                      boxes={texts.filter((t) => t.page === i)}
                      activeId={activeText}
                      adding={addingText}
                      onAdd={(page, x, y) => {
                        const st = textStyle.current;
                        const b: TextBox = { id: newId(), page, x, y: Math.max(0, y - st.size * LINE_HEIGHT * 0.5), text: addingText?.text ?? '', ...st, note: addingText?.note };
                        setTexts((l) => [...l, b]); setActiveText(b.id); setAddingText(null);
                      }}
                      onChange={(id, patch) => {
                        setTexts((l) => l.map((t) => (t.id === id ? { ...t, ...patch } : t)));
                        const { size, family, bold, color } = patch;
                        if (size || family || bold !== undefined || color) { textStyle.current = { ...textStyle.current, ...Object.fromEntries(Object.entries({ size, family, bold, color }).filter(([, v]) => v !== undefined)) }; saveTextStyle(textStyle.current); }
                      }}
                      onSelect={(id) => { setActiveText(id); if (!id) setTexts((l) => l.filter((t) => t.text.trim())); }}
                      onRemove={(id) => { setTexts((l) => l.filter((t) => t.id !== id)); setActiveText(null); }}
                      onApply={() => applyPlacedRef.current()}
                    />
                  )}
                  {mode === 'edit' && (
                    <EditLayer
                      client={client} index={i} info={p} zoom={zoom} rev={rev * 10000 + (pageRev[i] ?? 0)}
                      onReplace={(req) => replace(req, editing?.original ?? '', liveText)}
                      onMessage={say}
                      onEditing={(s) => { setEditing(s); setStyleOverride(null); if (!s) setLiveText(''); }}
                      onText={setLiveText}
                      styleOverride={editing?.page === i ? styleOverride : null}
                      onStyle={setStyleOverride}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          {scanHint && !overview && !ocrOpen && (
            <div className="scanhint" role="status">
              <span>스캔한 문서 같아요. <b>글자 읽기</b>를 하면 찾기·복사가 돼요.</span>
              <button className="ok" onClick={openOcr}>글자 읽기</button>
              <button onClick={() => setScanHint(false)} aria-label="안내 닫기">닫기</button>
            </div>
          )}
          {find.open && !overview && (
            <FindBar state={find} onQuery={(q) => setFind((f) => ({ ...f, q }))} onMove={moveFind} onClose={() => setFind((f) => ({ ...f, open: false }))} />
          )}
          {drawKind && !overview && (
            <div className="statuspill" role="status">
              <span className="dot" aria-hidden="true" />
              <span><b>{DRAW_LABEL[drawKind]}</b><span className="muted"> · {drawKind === 'check' ? '넣을 곳을 누르세요' : drawKind === 'pen' ? '끌어서 그리세요' : '끌어서 그리세요'}</span></span>
              <span className="drawopts">
                {(drawKind === 'highlight' ? MARKER_COLORS : PEN_COLORS).map((c) => (
                  <button key={c.id} className={`mb-color${(drawKind === 'highlight' ? markerColor : penColor) === c.id ? ' on' : ''}`} aria-label={c.label} title={c.label} onClick={() => (drawKind === 'highlight' ? setMarkerColor(c.id) : setPenColor(c.id))}><span style={{ background: c.id }} /></button>
                ))}
                {drawKind !== 'highlight' && drawKind !== 'check' && PEN_WIDTHS.map((w) => (
                  <button key={w.id} className={`wbtn${penWidth === w.id ? ' on' : ''}`} onClick={() => setPenWidth(w.id)}>{w.label}</button>
                ))}
              </span>
              {shapes.length > 0 && <button className="ok" onClick={() => { setDrawKind(null); applyPlacedRef.current(); }}>적용</button>}
              <button onClick={() => setDrawKind(null)}>끝내기</button>
            </div>
          )}
          {!drawKind && !addingText && !placing && placed.length === 0 && texts.length === 0 && shapes.length > 0 && !overview && (
            <div className="statuspill" role="status">
              <span className="dot" aria-hidden="true" />
              <span><b>그린 것 {shapes.length}개</b><span className="muted"> · 눌러서 고르면 색을 바꾸거나 뺄 수 있어요</span></span>
              <button className="ok" onClick={() => applyPlacedRef.current()}>적용</button>
            </div>
          )}
          {addingText && !overview && (
            <div className="statuspill" role="status">
              <span className="dot" aria-hidden="true" />
              <span><b>{addingText.note ? '메모' : addingText.text ? '날짜' : '글자'} 넣을 곳을 누르세요</b><span className="muted"> · Esc로 취소</span></span>
              <button onClick={() => setAddingText(null)}>취소</button>
            </div>
          )}
          {!drawKind && !addingText && !placing && placed.length === 0 && texts.length > 0 && !overview && (
            <div className="statuspill" role="status">
              <span className="dot" aria-hidden="true" />
              <span><b>글자 {texts.length}개</b><span className="muted"> · 왼쪽 위 손잡이로 옮기고, 다 쓰면 적용</span></span>
              <button className="ok" onClick={() => applyPlacedRef.current()}>적용</button>
            </div>
          )}
          {!drawKind && (placing || placed.length > 0) && !overview && (
            <div className="statuspill" role="status">
              <span className="dot" aria-hidden="true" />
              {placing
                ? <span><b>{markName(placing.kind)} 넣을 곳을 누르세요</b><span className="muted"> · Esc로 취소</span></span>
                : <span><b>{placed.length}개 놓았어요</b><span className="muted"> · 끌어서 옮기고 모서리로 크기를 바꾼 뒤 적용</span></span>}
              {placing
                ? <button onClick={() => setPlacing(null)}>취소</button>
                : <button className="ok" onClick={() => applyPlacedRef.current()}>적용</button>}
            </div>
          )}
          {mode === 'edit' && !overview && !placing && placed.length === 0 && texts.length === 0 && !addingText && !drawKind && (
            <div className="statuspill" role="status">
              <span className="dot" aria-hidden="true" />
              <span><b>글자 고치는 중</b><span className="muted"> · 줄을 누르거나 글자 위를 끌어서 고르세요</span></span>
              <button onClick={() => setMode('view')}>끝내기</button>
            </div>
          )}
          <div className="floatnav" hidden={overview}>
            <button aria-label="이전 쪽" onClick={() => goTo(cur - 1)} disabled={cur === 0}><Icon name="left" size={16} /></button>
            <span className="pn"><b>{cur + 1}</b> <span className="muted">/ {doc.pages.length}</span></span>
            <button aria-label="다음 쪽" onClick={() => goTo(cur + 1)} disabled={cur >= doc.pages.length - 1}><Icon name="right" size={16} /></button>
            <span className="vsep" aria-hidden="true" />
            <button aria-label="축소" onClick={() => setZoom((z) => clamp(z / 1.2, 0.25, 4))}><Icon name="minus" size={16} /></button>
            <span className="zv">{Math.round(zoom * 100)}%</span>
            <button aria-label="확대" onClick={() => setZoom((z) => clamp(z * 1.2, 0.25, 4))}><Icon name="plus" size={16} /></button>
            <button className="txt" onClick={() => fitWidth(doc.pages)}>폭 맞춤</button>
          </div>
        </main>

        <aside className="inspector" aria-label="속성">
          {privacy ? (
            <PrivacyPanel
              state={privacy}
              busy={!!busy}
              onChange={(patch) => setPrivacy({ ...privacy, ...patch })}
              onRescan={(patch) => scanPrivacy(privacy, patch)}
              onGo={goTo}
              onApply={() => setConfirmRedact(true)}
              onClose={() => setPrivacy(null)}
            />
          ) : activeItem ? (
            <>
              <section>
                <h2>넣은 {markName(activeItem.kind)}</h2>
                <div className="markprev checker"><img src={activeItem.src} alt="" /></div>
                <dl className="props">
                  <dt>크기</dt><dd>{pt2mm(activeItem.w)} × {pt2mm(activeItem.h)}mm</dd>
                  <dt>쪽</dt><dd>{activeItem.page + 1}쪽</dd>
                </dl>
                <div className="row3">
                  <button className="btn sm" onClick={() => setPlaced((l) => l.map((x) => (x.id === activeItem.id ? { ...x, w: x.w * 0.9, h: x.h * 0.9 } : x)))}>작게</button>
                  <button className="btn sm" onClick={() => setPlaced((l) => l.map((x) => (x.id === activeItem.id ? { ...x, w: x.w * 1.1, h: x.h * 1.1 } : x)))}>크게</button>
                  <button className="btn sm iconly danger" aria-label="빼기" onClick={() => { setPlaced((l) => l.filter((x) => x.id !== activeItem.id)); setActivePlaced(null); }}><Icon name="trash" size={16} /></button>
                </div>
                {doc.pages.length > 1 && <button className="btn" onClick={() => placeOnAllPages(activeItem.id)}>모든 쪽 같은 자리에 넣기</button>}
                <button className="btn navy" onClick={() => applyPlacedRef.current()}>{placed.length > 1 ? `${placed.length}개 모두 적용` : '적용해서 문서에 고정'}</button>
              </section>
              <p className="note"><Icon name="shieldCheck" size={16} />적용하면 문서에 그림으로 고정돼요. 저장이나 인쇄를 누르면 자동으로 적용돼요.</p>
            </>
          ) : mode === 'edit' && editing && curStyle ? (
            <>
              <section>
                <h2>고치는 글자</h2>
                <div className="compare">
                  <span className="before">{editing.original}</span>
                  <Icon name="arrow" size={16} />
                  <span className="after" style={curStyle.orig ? { fontFamily: `${curStyle.orig.css}, ${FONTS[curStyle.family].css}` } : undefined}>{liveText || ' '}</span>
                </div>
              </section>
              <section>
                <div className="h2row"><h2>원래 글자에 맞춘 모양</h2><span className="badge">자동</span></div>
                <dl className="props">
                  <dt>글꼴</dt><dd>{curStyle.orig
                    ? <><b>원래 글꼴 그대로</b><small>{editing.fontName || '문서 글꼴'} · 문서에 없던 글자만 {FONTS[curStyle.family].label}</small></>
                    : <><b>{FONTS[curStyle.family].label}{curStyle.bold ? ' · 굵게' : ''}</b><small>원본 {editing.fontName || '알 수 없음'}</small></>}</dd>
                  <dt>크기</dt><dd>{Math.round(editing.size * 10) / 10}pt</dd>
                  <dt>자간</dt><dd>원래 폭에 맞춰 자동</dd>
                  <dt>색</dt><dd>원래 글자색</dd>
                </dl>
              </section>
              <p className="note"><Icon name="shieldCheck" size={16} />바뀐 글자만 파일에서 지우고 같은 자리에 새로 써요. 원래 글자는 남지 않고, 표 선과 배경은 그대로예요.</p>
            </>
          ) : (
            <>
              {curPage && (
                <section>
                  <h2>이 페이지</h2>
                  <dl className="props">
                    <dt>쪽</dt><dd>{cur + 1} / {doc.pages.length}</dd>
                    <dt>용지</dt><dd>{paperName(curPage)} · {pt2mm(curPage.width)} × {pt2mm(curPage.height)}mm</dd>
                    <dt>방향</dt><dd>{curPage.width > curPage.height ? '가로' : '세로'}</dd>
                  </dl>
                  <div className="row3">
                    <button className="btn sm" onClick={() => rotate(90, [cur])}>돌리기</button>
                    <button className="btn sm" onClick={() => duplicate([cur])}>복제</button>
                    <button className="btn sm" onClick={() => insertBlank(cur + 1)}>빈 쪽</button>
                    <button className="btn sm iconly danger" aria-label="이 쪽 지우기" onClick={() => remove([cur])}><Icon name="trash" size={16} /></button>
                  </div>
                </section>
              )}
              <section>
                <h2>문서</h2>
                <dl className="props">
                  <dt>쪽수</dt><dd>{doc.pages.length}쪽</dd>
                  <dt>원본 크기</dt><dd>{fmtSize(doc.size)}</dd>
                </dl>
              </section>
              {mode === 'edit' && <p className="note"><Icon name="edit" size={16} />고칠 글자를 누르거나 끌어서 고르면, 원래 글꼴과 크기에 맞춰 바로 고칠 수 있어요.</p>}
            </>
          )}
          {edits.length > 0 && (
            <section className="edits">
              <h2>이번에 고친 곳 · {edits.length}</h2>
              {edits.slice(-5).reverse().map((h, i) => (
                <button key={i} className="editrow" onClick={() => goTo(h.page)}>
                  <span className="et">{h.after || '(지움)'}</span><span className="muted">{h.page + 1}쪽</span>
                </button>
              ))}
            </section>
          )}
          <div className="savestate">
            <span><span className={`dot${dirty ? ' warn' : ''}`} aria-hidden="true" />{dirty ? '저장하지 않은 고침이 있어요' : savedAt ? `저장됨 · ${savedAt.getHours() < 12 ? '오전' : '오후'} ${((savedAt.getHours() + 11) % 12) + 1}:${String(savedAt.getMinutes()).padStart(2, '0')}` : '바뀐 내용 없음'}</span>
            <button className="linkbtn" onClick={() => setEasy(!easy)}>{easy ? '글씨 보통으로' : '글씨 크게'}</button>
          </div>
        </aside>
      </div>

      {markDialog && <MarkDialog kind={markDialog} onClose={() => setMarkDialog(null)} onPick={pickMark} />}
      {printOpen && <PrintDialog hasSel={sel.size > 0} pageCount={doc.pages.length} current={cur + 1} onClose={() => setPrintOpen(false)} onPrint={doPrint} />}
      {confirmClose && (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) setConfirmClose(false); }}>
          <div className="dlg" role="alertdialog" aria-labelledby="cc-t">
            <h3 id="cc-t">저장하지 않고 닫을까요?</h3>
            <p>고친 내용이 있어요. 닫으면 저장하지 않은 고침은 사라져요.</p>
            <div className="acts">
              <button className="btn" onClick={() => setConfirmClose(false)}>돌아가기</button>
              <button className="btn danger" onClick={closeDoc}>저장하지 않고 닫기</button>
              <button className="btn navy" autoFocus onClick={async () => { await doSave(); closeDoc(); }}>저장하고 닫기</button>
            </div>
          </div>
        </div>
      )}
      {recipeOpen && <RecipeDialog onClose={() => setRecipeOpen(false)} onRun={runRecipe} />}
      {compareWith && <CompareView client={client} pages={doc.pages} name={doc.name} other={compareWith} onClose={() => setCompareWith(null)} />}
      {ocrOpen && (
        <OcrDialog
          total={doc.pages.length} current={cur} textless={textless} progress={ocrProgress}
          onClose={() => setOcrOpen(false)} onRun={runOcr}
          onStop={() => { ocrStop.current = true; setOcrProgress((p) => (p ? { ...p, stopping: true } : p)); }}
        />
      )}
      {imgOpen && <ImageExportDialog total={doc.pages.length} current={cur} selected={[...sel].sort((a, b) => a - b)} onClose={() => setImgOpen(false)} onExport={exportImages} />}
      {splitOpen && <SplitDialog total={doc.pages.length} selected={[...sel].sort((a, b) => a - b)} onClose={() => setSplitOpen(false)} onSplit={split} />}
      {markOpen === 'num' && (
        <PageNumberDialog info={doc.pages[0]} total={doc.pages.length} onClose={() => setMarkOpen(null)} onApply={async (o) => {
          setMarkOpen(null); await applyPlacedRef.current(); setBusy('쪽 번호 넣는 중…');
          try { applyPages(await client.pageNumbers(o), { kind: 'mark', page: cur }); say('쪽 번호를 넣었어요. 되돌리기로 뺄 수 있어요.'); }
          catch (e) { say(`쪽 번호를 넣지 못했어요. ${(e as Error).message}`); }
          finally { setBusy(null); }
        }} />
      )}
      {markOpen === 'wm' && (
        <WatermarkDialog info={doc.pages[cur] ?? doc.pages[0]} selected={[...sel].sort((a, b) => a - b)} onClose={() => setMarkOpen(null)} onApply={async (o) => {
          setMarkOpen(null); await applyPlacedRef.current(); setBusy('워터마크 넣는 중…');
          try { applyPages(await client.watermark(o), { kind: 'mark', page: cur }, o.pages); say('워터마크를 넣었어요. 되돌리기로 뺄 수 있어요.'); }
          catch (e) { say(`워터마크를 넣지 못했어요. ${(e as Error).message}`); }
          finally { setBusy(null); }
        }} />
      )}
      {lockOpen && <LockDialog encrypted={encrypted} onClose={() => setLockOpen(false)} onSave={saveLocked} />}
      {shrinkOpen && (
        <ShrinkDialog
          onClose={() => setShrinkOpen(false)}
          onRun={async (level) => { await applyPlacedRef.current(); try { return await client.shrink(level); } catch (e) { say(`줄이지 못했어요. ${(e as Error).message}`); return null; } }}
          onSave={async (bytes) => { const w = await saveFile(`${baseName(doc.name)}_용량줄임.pdf`, bytes); if (w) { say('줄인 파일로 저장했어요.'); setShrinkOpen(false); } }}
        />
      )}
      {confirmRedact && privacy && (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) setConfirmRedact(false); }}>
          <div className="dlg">
            <h3>{privacyAreas(privacy).length}곳을 지울까요?</h3>
            <p>고른 곳의 글자와 그림을 파일에서 완전히 지우고 검은 상자로 덮어요. 지운 글자는 복사하거나 검색해도 나오지 않아요.</p>
            <p className="small muted">저장하기 전에는 되돌리기로 되돌릴 수 있어요.</p>
            <div className="acts">
              <button className="btn" onClick={() => setConfirmRedact(false)}>취소</button>
              <button className="btn navy" autoFocus onClick={applyPrivacy}>지우기</button>
            </div>
          </div>
        </div>
      )}
      {pw && <PasswordDialog pw={pw} onCancel={() => setPw(null)} onSubmit={(v) => load(pw.file, v)} />}
      {busy && <div className="busy"><div>{busy}</div></div>}
      <div className={`toast${toast ? ' show' : ''}`} role="status">{toast}</div>
    </div>
  );
}

function PasswordDialog({ pw, onCancel, onSubmit }: { pw: { file: OpenedFile; wrong: boolean }; onCancel: () => void; onSubmit: (v: string) => void }) {
  return (
    <div className="modal">
      <form className="dlg" onSubmit={(e) => { e.preventDefault(); onSubmit((e.currentTarget.elements.namedItem('pw') as HTMLInputElement).value); }}>
        <h3>암호가 걸린 PDF</h3>
        <p>{pw.wrong ? '암호가 맞지 않아요. 다시 입력해 주세요. ' : ''}"{pw.file.name}" 파일을 열려면 암호가 필요해요.</p>
        <input name="pw" type="password" autoFocus autoComplete="off" aria-label="PDF 암호" className="field" />
        <div className="acts">
          <button type="button" className="btn" onClick={onCancel}>취소</button>
          <button type="submit" className="btn navy">열기</button>
        </div>
      </form>
    </div>
  );
}

function PrintDialog({ hasSel, pageCount, current, onClose, onPrint }: { hasSel: boolean; pageCount: number; current: number; onClose: () => void; onPrint: (o: PrintOptions) => void }) {
  const [range, setRange] = useState<PrintRange>(hasSel ? 'selected' : 'all');
  const [dpi, setDpi] = useState(300);
  const [per, setPer] = useState<1 | 2 | 4>(() => { try { return (Number(localStorage.getItem('sowuju.printPer')) || 1) as 1 | 2 | 4; } catch { return 1; } });
  const [border, setBorder] = useState(true);
  const [text, setText] = useState('');
  const parsed = parseRanges(text, pageCount);
  const custom = parsed.groups.flat();
  const bad = range === 'custom' && (!!parsed.error || !custom.length);
  const count = range === 'all' ? pageCount : range === 'current' ? 1 : range === 'custom' ? custom.length : 0;
  const opt = (name: string, checked: boolean, onChange: () => void, title: string, sub: string, disabled = false) => (
    <label className={`opt${checked ? ' on' : ''}${disabled ? ' dis' : ''}`}>
      <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} />
      <span><b>{title}</b><small>{sub}</small></span>
    </label>
  );
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dlg wide" onSubmit={(e) => {
        e.preventDefault();
        if (bad) return;
        try { localStorage.setItem('sowuju.printPer', String(per)); } catch { /* 괜찮음 */ }
        onPrint({ range, custom, dpi, per, border });
      }}>
        <h3>인쇄</h3>
        <fieldset>
          <legend>인쇄할 페이지</legend>
          <div className="opts">
            {opt('range', range === 'all', () => setRange('all'), '전체', `${pageCount}쪽`)}
            {opt('range', range === 'current', () => setRange('current'), '지금 보는 쪽', `${current}쪽`)}
            {opt('range', range === 'selected', () => setRange('selected'), '고른 쪽', hasSel ? '왼쪽 목록에서 고른 쪽' : '목록에서 먼저 고르세요', !hasSel)}
            {opt('range', range === 'custom', () => setRange('custom'), '직접 쓰기', '예) 1-3, 7')}
          </div>
          {range === 'custom' && (
            <div className="printrange">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="1-3, 7, 10-" aria-label="인쇄할 쪽" autoFocus />
              <small className={parsed.error && text.trim() ? 'bad' : ''}>{text.trim() ? (parsed.error ?? `${custom.length}쪽 인쇄`) : '쉼표로 여러 곳을 쓸 수 있어요'}</small>
            </div>
          )}
        </fieldset>
        <fieldset>
          <legend>한 장에 몇 쪽</legend>
          <div className="opts">
            {([1, 2, 4] as const).map((n) => (
              <label key={n} className={`opt perop${per === n ? ' on' : ''}`}>
                <input type="radio" name="per" checked={per === n} onChange={() => setPer(n)} />
                <span className={`permini per${n}`} aria-hidden="true">{Array.from({ length: n }, (_, i) => <i key={i}>{i + 1}</i>)}</span>
                <span><b>{n === 1 ? '1쪽 (보통)' : `${n}쪽 모아 찍기`}</b><small>{n === 1 ? '한 장에 한 쪽' : count ? `종이 ${Math.ceil(count / n)}장` : n === 2 ? '가로로 나란히' : '2줄 2칸'}</small></span>
              </label>
            ))}
          </div>
          {per > 1 && <label className="pmcheck"><input type="checkbox" checked={border} onChange={(e) => setBorder(e.target.checked)} />쪽마다 테두리 선 긋기</label>}
        </fieldset>
        <fieldset>
          <legend>선명도</legend>
          <div className="opts">
            {opt('dpi', dpi === 200, () => setDpi(200), '보통', '빠르게')}
            {opt('dpi', dpi === 300, () => setDpi(300), '선명하게', '대부분 문서에 알맞아요')}
            {opt('dpi', dpi === 600, () => setDpi(600), '아주 선명하게', '작은 글씨·도면')}
          </div>
        </fieldset>
        <p>다음 화면에서 프린터, 매수, 양면 인쇄를 고를 수 있어요.</p>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="submit" className="btn navy" autoFocus={range !== 'custom'} disabled={bad}>다음</button>
        </div>
      </form>
    </div>
  );
}
