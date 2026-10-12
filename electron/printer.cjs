// "소우주 PDF" 프린터 (Windows): 다른 프로그램의 인쇄 창에서 "소우주 PDF"를 고르면 소우주 PDF로 열린다.
// Windows에 들어 있는 'Microsoft Print To PDF'를 빌려 프린터를 하나 더 만들고, 출력 위치(포트)를 정해 둔 파일로 한다.
// 프로그램이 켜져 있으면 그 파일이 생기는 즉시 열고, 꺼져 있으면 다음에 켤 때 연다.
const { app } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const fss = require('fs');
const os = require('os');
const path = require('path');

const NAME = '소우주 PDF';
const DRIVER = 'Microsoft Print To PDF';
// 출력 위치는 영어로만 된 경로가 안전하다 (프린터 포트 이름으로 쓰인다)
const inbox = () => path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'SowujuPDF', 'PrintInbox');
const portFile = () => path.join(inbox(), 'print.pdf');

function ps(script, { elevated = false, timeout = 60000 } = {}) {
  return new Promise(async (resolve, reject) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sowuju-prn-'));
    const file = path.join(dir, 'p.ps1');
    // Windows PowerShell 5는 BOM이 있어야 UTF-8(한글 프린터 이름)로 읽는다
    await fs.writeFile(file, '﻿' + `$ErrorActionPreference = 'Stop'\n` + script, 'utf8');
    const args = elevated
      ? ['-NoProfile', '-NonInteractive', '-Command', `$p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${file}"'; exit $p.ExitCode`]
      : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file];
    execFile('powershell.exe', args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      if (err) reject(Object.assign(err, { stdout: String(stdout || ''), stderr: String(stderr || '') }));
      else resolve(String(stdout || '').trim());
    });
  });
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function status() {
  if (process.platform !== 'win32') return { supported: false, installed: false };
  try {
    const out = await ps(`$p = Get-Printer -Name ${q(NAME)} -ErrorAction SilentlyContinue
$d = Get-PrinterDriver -Name ${q(DRIVER)} -ErrorAction SilentlyContinue
"$([bool]$p)|$([bool]$d)|$($p.PortName)"`);
    const [installed, driver, port] = out.split('|');
    return { supported: true, installed: installed === 'True', driver: driver === 'True', portOk: port === portFile() };
  } catch (e) { return { supported: true, installed: false, error: String(e.message || e) }; }
}

async function install() {
  await fs.mkdir(inbox(), { recursive: true });
  try {
    await ps(`$port = ${q(portFile())}
if (-not (Get-PrinterDriver -Name ${q(DRIVER)} -ErrorAction SilentlyContinue)) { exit 3 }
if (Get-Printer -Name ${q(NAME)} -ErrorAction SilentlyContinue) { Remove-Printer -Name ${q(NAME)} }
if (-not (Get-PrinterPort -Name $port -ErrorAction SilentlyContinue)) { Add-PrinterPort -Name $port }
Add-Printer -Name ${q(NAME)} -DriverName ${q(DRIVER)} -PortName $port
exit 0`, { elevated: true, timeout: 120000 });
  } catch (e) {
    if (e.code === 3) throw new Error('이 컴퓨터에 "Microsoft Print to PDF"가 꺼져 있어요. Windows 기능 켜기/끄기에서 켠 뒤 다시 해 주세요.');
    throw new Error('프린터를 추가하지 못했어요. 허용 창에서 "예"를 눌렀는지 확인해 주세요.');
  }
  return status();
}

async function remove() {
  try {
    await ps(`if (Get-Printer -Name ${q(NAME)} -ErrorAction SilentlyContinue) { Remove-Printer -Name ${q(NAME)} }
$port = ${q(portFile())}
if (Get-PrinterPort -Name $port -ErrorAction SilentlyContinue) { Remove-PrinterPort -Name $port }
exit 0`, { elevated: true, timeout: 120000 });
  } catch { throw new Error('프린터를 빼지 못했어요. 허용 창에서 "예"를 눌렀는지 확인해 주세요.'); }
  return status();
}

/**
 * 인쇄된 파일 지켜보기. 다 써진 파일(크기가 멈추고 옮길 수 있을 때)을 이름을 붙여 옮긴 뒤 onFile로 알린다.
 * 켤 때 이미 있으면(꺼져 있는 동안 인쇄한 것) 바로 알린다
 */
function watch(onFile) {
  if (process.platform !== 'win32') return;
  const dir = inbox();
  fss.mkdirSync(dir, { recursive: true });
  let timer = null, lastSize = -1;
  const check = async () => {
    timer = null;
    const src = portFile();
    let st;
    try { st = await fs.stat(src); } catch { lastSize = -1; return; }
    if (st.size === 0 || st.size !== lastSize) { lastSize = st.size; timer = setTimeout(check, 700); return; }
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const dest = path.join(dir, `인쇄 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.pdf`);
    try { await fs.rename(src, dest); }
    catch { timer = setTimeout(check, 700); return; } // 아직 쓰는 중
    lastSize = -1;
    onFile(dest);
  };
  const poke = () => { if (!timer) timer = setTimeout(check, 400); };
  try { fss.watch(dir, poke); } catch { /* 지켜보지 못하면 아래 주기 확인만 */ }
  setInterval(poke, 5000);
  poke();
  // 30일 지난 인쇄 파일은 정리
  fs.readdir(dir).then((names) => names.forEach(async (n) => {
    if (!/^인쇄 .*\.pdf$/.test(n)) return;
    const f = path.join(dir, n);
    try { if (Date.now() - (await fs.stat(f)).mtimeMs > 30 * 864e5) await fs.rm(f); } catch { /* 괜찮음 */ }
  })).catch(() => {});
}

module.exports = { printerStatus: status, printerInstall: install, printerRemove: remove, watchPrinted: watch };
