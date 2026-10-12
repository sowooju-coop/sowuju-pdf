// 한글·워드·엑셀·파워포인트 파일을 PDF로 바꾼다.
// Windows: 컴퓨터에 설치된 한글/오피스를 화면에 띄우지 않고 불러 'PDF로 저장'을 시킨다(COM).
// 없거나 Windows가 아니면 LibreOffice가 있으면 그것으로. 파일은 이 컴퓨터 밖으로 나가지 않는다.
const { execFile } = require('child_process');
const fs = require('fs/promises');
const fss = require('fs');
const os = require('os');
const path = require('path');

const KINDS = {
  hwp: ['hwp', 'hwpx'],
  word: ['doc', 'docx', 'rtf', 'odt', 'txt'],
  excel: ['xls', 'xlsx', 'csv', 'ods'],
  powerpoint: ['ppt', 'pptx', 'odp'],
};
const OFFICE_EXT = Object.values(KINDS).flat();
const kindOf = (p) => Object.keys(KINDS).find((k) => KINDS[k].includes(path.extname(p).slice(1).toLowerCase())) || null;
const isOffice = (p) => !!kindOf(p);

const LABEL = { hwp: '한글(한컴오피스)', word: '워드(MS Word)', excel: '엑셀(MS Excel)', powerpoint: '파워포인트(MS PowerPoint)' };

// 이미 켜져 있던 프로그램은 끄지 않는다 (사용자가 쓰던 문서가 닫히지 않게)
// 다 바꾼 뒤 그 프로그램에 다른 문서가 열려 있으면(사용자가 쓰던 것) 끄지 않는다
const PS = {
  word: `
$app = New-Object -ComObject Word.Application
$app.DisplayAlerts = 0
try {
  $doc = $app.Documents.Open($src, $false, $true, $false)
  $doc.ExportAsFixedFormat($out, 17)
  $doc.Close(0)
} finally { if ($app.Documents.Count -eq 0) { $app.Quit() } }`,
  excel: `
$app = New-Object -ComObject Excel.Application
$app.DisplayAlerts = $false
try {
  $wb = $app.Workbooks.Open($src, 0, $true)
  $wb.ExportAsFixedFormat(0, $out)
  $wb.Close($false)
} finally { if ($app.Workbooks.Count -eq 0) { $app.Quit() } }`,
  powerpoint: `
$app = New-Object -ComObject PowerPoint.Application
try {
  $p = $app.Presentations.Open($src, -1, 0, 0)
  $p.SaveAs($out, 32)
  $p.Close()
} finally { if ($app.Presentations.Count -eq 0) { $app.Quit() } }`,
  hwp: `
$app = New-Object -ComObject HWPFrame.HwpObject
try { $app.XHwpWindows.Item(0).Visible = $false } catch {}
try { [void]$app.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule') } catch {}
try {
  $fmt = if ($src -match '\\.hwpx$') { 'HWPX' } else { 'HWP' }
  if (-not $app.Open($src, $fmt, 'forceopen:true;versionwarning:false;suspendpassword:true')) { throw 'open' }
  if (-not $app.SaveAs($out, 'PDF', '')) { throw 'save' }
  [void]$app.Clear(1)
} finally { $app.Quit() }`,
};

function run(cmd, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr: String(stderr || '') }));
      else resolve(String(stdout || ''));
    });
  });
}

async function viaCom(kind, src, out, dir) {
  const ps1 = path.join(dir, `${kind}.ps1`);
  const body = `param([string]$src, [string]$out)\n$ErrorActionPreference = 'Stop'\n${PS[kind]}\n`;
  // Windows PowerShell 5는 BOM이 있어야 UTF-8로 읽는다
  await fs.writeFile(ps1, '﻿' + body, 'utf8');
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-src', src, '-out', out], 180000);
}

function findSoffice() {
  const c = process.platform === 'win32'
    ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map((p) => path.join(p, 'LibreOffice', 'program', 'soffice.exe'))
    : process.platform === 'darwin' ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice']
      : ['/usr/bin/soffice', '/usr/local/bin/soffice', '/usr/bin/libreoffice', '/snap/bin/libreoffice'];
  return c.find((p) => fss.existsSync(p)) || null;
}

async function viaLibre(soffice, src, dir) {
  const profile = path.join(dir, 'lo-profile');
  await run(soffice, [`-env:UserInstallation=${require('url').pathToFileURL(profile).href}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, src], 180000);
  return path.join(dir, path.basename(src, path.extname(src)) + '.pdf');
}

/** 바꾼 PDF 바이트. 바꿀 수 없으면 쉬운 말로 된 오류 */
async function convertToPdf(src) {
  const kind = kindOf(src);
  if (!kind) throw new Error('PDF로 바꿀 수 없는 파일이에요.');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sowuju-conv-'));
  const out = path.join(dir, 'out.pdf');
  const tried = [];
  try {
    if (process.platform === 'win32') {
      try {
        await viaCom(kind, src, out, dir);
        if (fss.existsSync(out)) return new Uint8Array(await fs.readFile(out));
      } catch (e) { tried.push(e); }
    }
    const soffice = findSoffice();
    // LibreOffice는 한글 2002 이후(.hwp 5.0)·.hwpx를 읽지 못한다
    if (soffice && kind !== 'hwp') {
      try {
        const p = await viaLibre(soffice, src, dir);
        if (fss.existsSync(p)) return new Uint8Array(await fs.readFile(p));
      } catch (e) { tried.push(e); }
    }
    const lock = tried.some((e) => /password|암호|locked/i.test(String(e.stderr || e.message)));
    if (lock) throw new Error('암호가 걸린 문서라 바꾸지 못했어요. 원래 프로그램에서 암호를 풀고 다시 열어 주세요.');
    throw new Error(kind === 'hwp'
      ? '한글 파일을 PDF로 바꾸려면 이 컴퓨터에 한글(한컴오피스)이 설치되어 있어야 해요. 한글에서 "PDF로 저장"한 뒤 열어도 돼요.'
      : `이 파일을 PDF로 바꾸려면 ${LABEL[kind]}나 LibreOffice(무료)가 설치되어 있어야 해요.`);
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { convertToPdf, isOffice, OFFICE_EXT };
