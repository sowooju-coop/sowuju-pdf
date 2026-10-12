// 설치 파일이 서명 등으로 바뀐 뒤, 자동 업데이트가 쓰는 latest.yml 과 차등 다운로드용 blockmap 을 다시 만든다.
// 사용: node scripts/finalize-release.cjs <release 폴더> <버전>
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { appBuilderPath } = require('app-builder-bin');

const [dir, version] = process.argv.slice(2);
if (!dir || !version) { console.error('사용: node scripts/finalize-release.cjs <폴더> <버전>'); process.exit(1); }
const name = `SowujuPDF-Setup-${version}.exe`;
const exe = path.join(dir, name);
if (!fs.existsSync(exe)) { console.error(`설치 파일이 없어요: ${exe}`); process.exit(1); }

// app-builder 가 blockmap 을 만들고 크기와 sha512 를 돌려준다 (electron-builder 와 같은 방식)
const out = execFileSync(appBuilderPath, ['blockmap', '--input', exe, '--output', `${exe}.blockmap`]).toString();
const { size, sha512 } = JSON.parse(out);

const ymlPath = path.join(dir, 'latest.yml');
const old = fs.existsSync(ymlPath) ? fs.readFileSync(ymlPath, 'utf8') : '';
const releaseDate = /releaseDate:\s*'([^']+)'/.exec(old)?.[1] ?? new Date().toISOString();
fs.writeFileSync(ymlPath, [
  `version: ${version}`,
  'files:',
  `  - url: ${name}`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  `path: ${name}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  '',
].join('\n'));
console.log(`latest.yml: ${name} ${size} bytes`);
