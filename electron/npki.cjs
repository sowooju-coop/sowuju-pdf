// 공동인증서(NPKI) 찾기: 이 컴퓨터와 USB에 저장된 signCert.der / signPri.key 쌍을 읽는다.
// 읽기만 하고 아무것도 바꾸거나 보내지 않는다
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

function roots() {
  const home = os.homedir();
  const out = [];
  if (process.platform === 'win32') {
    out.push(path.join(home, 'AppData', 'LocalLow', 'NPKI'));
    // USB 같은 이동식 저장장치 맨 위의 NPKI 폴더
    for (const c of 'CDEFGHIJKLMNOPQRSTUVWXYZ') out.push(`${c}:\\NPKI`);
  } else if (process.platform === 'darwin') {
    out.push(path.join(home, 'Library', 'Preferences', 'NPKI'));
    out.push(path.join(home, 'NPKI'));
  } else {
    out.push(path.join(home, 'NPKI'));
  }
  return out;
}

async function listNpki() {
  const found = [];
  for (const root of roots()) {
    if (!(await exists(root))) continue;
    let cas = [];
    try { cas = await fs.readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const ca of cas) {
      if (!ca.isDirectory()) continue;
      const userDir = path.join(root, ca.name, 'USER');
      let users = [];
      try { users = await fs.readdir(userDir, { withFileTypes: true }); } catch { continue; }
      for (const u of users) {
        if (!u.isDirectory()) continue;
        const dir = path.join(userDir, u.name);
        try {
          const [cert, key] = await Promise.all([fs.readFile(path.join(dir, 'signCert.der')), fs.readFile(path.join(dir, 'signPri.key'))]);
          found.push({ path: dir, cert: new Uint8Array(cert), key: new Uint8Array(key) });
        } catch { /* 짝이 맞지 않는 폴더는 건너뛴다 */ }
        if (found.length >= 50) return found;
      }
    }
  }
  return found;
}

module.exports = { listNpki };
