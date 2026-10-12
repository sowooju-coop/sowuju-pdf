import { useCallback, useEffect, useRef, useState } from 'react';
import { setUiZoom, type OpenedFile } from './lib/host';
import { newId } from './lib/library';
import type { QuickAction } from './components/StartScreen';
import { UpdateBar } from './components/UpdateBar';
import { HelpDialog, Welcome } from './components/Help';
import { Workspace, type TabInfo, type WorkspaceHandle } from './Workspace';

const readPref = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const writePref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 동작에는 지장 없음 */ } };

interface Tab extends TabInfo { file?: OpenedFile; then?: QuickAction }
const emptyTab = (): Tab => ({ id: newId(), name: null, dirty: false, unsaved: false });

/**
 * 여러 문서를 탭으로 연다. 탭마다 따로 PDF 엔진(작업 스레드)을 두어 서로 영향을 주지 않는다.
 * 보이지 않는 탭은 화면에서만 숨기고 상태는 그대로 둔다.
 */
export default function App() {
  const [tabs, setTabs] = useState<Tab[]>(() => [emptyTab()]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const handles = useRef(new Map<string, WorkspaceHandle>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  // 글씨 크게(쉬운 모드)는 모든 탭이 함께 쓴다
  const [easy, setEasy] = useState(() => readPref('easy', '0') === '1');
  const [easyScale, setEasyScale] = useState(() => Number(readPref('easyScale', '1.15')) || 1.15);
  useEffect(() => {
    writePref('easy', easy ? '1' : '0');
    writePref('easyScale', String(easyScale));
    setUiZoom(easy ? easyScale : 1);
  }, [easy, easyScale]);

  // 도움말 (topic: 처음 보여 줄 항목), 처음 켰을 때 안내
  const [help, setHelp] = useState<{ topic?: string } | null>(null);
  const [welcome, setWelcome] = useState(() => readPref('sowuju.welcome', '0') !== '1');
  const openHelp = useCallback((topic?: string) => setHelp({ topic }), []);
  const closeWelcome = useCallback(() => { setWelcome(false); writePref('sowuju.welcome', '1'); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'F1') { e.preventDefault(); setHelp({}); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const register = useCallback((id: string, h: WorkspaceHandle | null) => {
    if (h) handles.current.set(id, h); else handles.current.delete(id);
  }, []);
  const onInfo = useCallback((id: string, info: Omit<TabInfo, 'id'>) => {
    setTabs((ts) => ts.map((t) => (t.id === id && (t.name !== info.name || t.dirty !== info.dirty || t.unsaved !== info.unsaved) ? { ...t, ...info } : t)));
  }, []);

  const openInNewTab = useCallback((file: OpenedFile, then?: QuickAction) => {
    const t: Tab = { ...emptyTab(), name: file.name, file, then };
    setTabs((ts) => [...ts, t]);
    setActiveId(t.id);
  }, []);
  const newTab = useCallback(() => {
    const t = emptyTab();
    setTabs((ts) => [...ts, t]);
    setActiveId(t.id);
  }, []);
  /** 탭을 없앤다 (확인은 이미 끝난 뒤). 마지막 탭이면 빈 탭 하나를 남긴다 */
  const removeTab = useCallback((id: string) => {
    const ts = tabsRef.current;
    const i = ts.findIndex((t) => t.id === id);
    if (i < 0) return;
    const rest = ts.filter((t) => t.id !== id);
    if (!rest.length) rest.push(emptyTab());
    setTabs(rest);
    if (activeRef.current === id) setActiveId(rest[Math.min(i, rest.length - 1)].id);
  }, []);
  /** 탭 닫기 요청: 저장 안 한 내용이 있으면 그 탭으로 가서 물어본다 */
  const closeTab = useCallback((id: string) => {
    const t = tabsRef.current.find((x) => x.id === id);
    if (!t) return;
    if (t.unsaved) { setActiveId(id); handles.current.get(id)?.requestClose(); }
    else removeTab(id);
  }, [removeTab]);

  // 탐색기에서 PDF를 두 번 눌러 열거나, 이미 켜진 창에 파일을 보낼 때: 지금 탭이 비어 있으면 거기에, 아니면 새 탭에
  useEffect(() => {
    const host = window.sowuju;
    if (!host) return;
    const open = (f: OpenedFile) => {
      const cur = tabsRef.current.find((t) => t.id === activeRef.current);
      if (cur && !cur.name) handles.current.get(cur.id)?.load(f);
      else openInNewTab(f);
    };
    const off = host.onOpenPath(open);
    host.takePending().then((f) => { if (f) open(f); });
    return off;
  }, [openInNewTab]);

  // 창을 닫을 때: 저장 안 한 탭이 있으면 운영체제 창으로 묻고, '저장'이면 탭마다 저장한다
  const unsavedNames = tabs.filter((t) => t.unsaved).map((t) => t.name ?? '새 탭');
  useEffect(() => {
    const host = window.sowuju;
    if (host) { host.setUnsaved(unsavedNames.length ? unsavedNames.join('", "') : null); return; }
    if (!unsavedNames.length) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsavedNames.join('\n')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => window.sowuju?.onSaveBeforeClose(async () => {
    for (const t of tabsRef.current.filter((x) => x.unsaved)) {
      setActiveId(t.id);
      const ok = await handles.current.get(t.id)?.save();
      if (!ok) return; // 저장 창을 취소하면 닫지 않는다
    }
    window.sowuju?.closeNow();
  }), []);

  // 탭 단축키: Ctrl+T 새 탭, Ctrl+W 탭 닫기, Ctrl+Tab 다음 탭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || document.querySelector('.modal')) return;
      const k = e.key.toLowerCase();
      if (k === 't') { e.preventDefault(); newTab(); }
      else if (k === 'w') { e.preventDefault(); closeTab(activeRef.current); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        const ts = tabsRef.current, i = ts.findIndex((t) => t.id === activeRef.current);
        setActiveId(ts[(i + (e.shiftKey ? ts.length - 1 : 1)) % ts.length].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newTab, closeTab]);

  const info = tabs.map(({ id, name, dirty, unsaved }) => ({ id, name, dirty, unsaved }));
  return (
    <>
      {tabs.map((t) => (
        <div key={t.id} className="tabpane" hidden={t.id !== activeId}>
          <Workspace
            tabId={t.id}
            active={t.id === activeId}
            tabs={info}
            initialFile={t.file}
            initialAction={t.then}
            onInfo={onInfo}
            onSelectTab={setActiveId}
            onCloseTab={closeTab}
            onNewTab={newTab}
            onRemoveTab={removeTab}
            openInNewTab={openInNewTab}
            register={register}
            easy={easy}
            easyScale={easyScale}
            setEasy={setEasy}
            setEasyScale={setEasyScale}
            onHelp={openHelp}
          />
        </div>
      ))}
      <UpdateBar />
      {welcome && !help && <Welcome onClose={closeWelcome} onHelp={() => { closeWelcome(); setHelp({}); }} />}
      {help && <HelpDialog topic={help.topic} onClose={() => setHelp(null)} />}
    </>
  );
}
