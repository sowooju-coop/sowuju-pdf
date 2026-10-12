// 서명용 인증서 읽기: 공동인증서(signCert.der + signPri.key, SEED로 잠긴 개인키), .pfx/.p12, 새로 만들기.
// 모두 이 컴퓨터 안에서만 처리하고, 암호와 개인키는 저장하지 않는다
import forge from 'node-forge';
import { KISA_SEED_CBC } from 'kisa-seed';

export interface SignCert {
  cert: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
  chain: forge.pki.Certificate[];
}
export interface CertInfo { name: string; issuer: string; until: Date; expired: boolean }

const bin = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return s; };
const u8 = (s: string) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u; };
const utf8 = (s: string) => forge.util.encodeUtf8(s);

const attr = (c: forge.pki.Certificate['subject'], ...names: string[]) => {
  for (const n of names) { const a = c.getField(n); if (a?.value) return forge.util.decodeUtf8(String(a.value)); }
  return '';
};
export function certInfo(cert: forge.pki.Certificate): CertInfo {
  const until = cert.validity.notAfter;
  const raw = attr(cert.subject, 'CN') || attr(cert.subject, 'O');
  // 공동인증서 이름은 "홍길동()0001234…" 꼴이라 괄호 앞만 보여 준다
  const name = raw.replace(/\(\).*$/, '').replace(/\(\)$/, '') || raw;
  return { name, issuer: attr(cert.issuer, 'O', 'CN'), until, expired: until.getTime() < Date.now() };
}

/** 공동인증서 개인키(signPri.key) 풀기 */
function decryptNpkiKey(der: Uint8Array, password: string): forge.pki.rsa.PrivateKey {
  const asn = forge.asn1.fromDer(bin(der));
  const [algId, enc] = asn.value as forge.asn1.Asn1[];
  const [oidNode, params] = algId.value as forge.asn1.Asn1[];
  const oid = forge.asn1.derToOid(oidNode.value as string);
  const data = u8(enc.value as string);
  let key: Uint8Array, iv: Uint8Array;
  if (oid === '1.2.410.200004.1.15') {
    // pbeWithSHA1AndSEED-CBC: DK = PBKDF1-SHA1(암호, salt, 반복), 키 = DK 앞 16바이트, IV = SHA1(DK 뒤 4바이트) 앞 16바이트
    const [saltN, iterN] = params.value as forge.asn1.Asn1[];
    const salt = saltN.value as string, iter = forge.util.createBuffer(iterN.value as string).getInt(8 * (iterN.value as string).length);
    let dk = utf8(password) + salt;
    for (let i = 0; i < iter; i++) dk = forge.md.sha1.create().update(dk).digest().getBytes();
    key = u8(dk.slice(0, 16));
    iv = u8(forge.md.sha1.create().update(dk.slice(16, 20)).digest().getBytes().slice(0, 16));
  } else if (oid === '1.2.840.113549.1.5.13') {
    // PBES2: PBKDF2 + SEED-CBC (새 공동인증서)
    const [kdf, scheme] = params.value as forge.asn1.Asn1[];
    const kdfParams = (kdf.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[];
    const salt = kdfParams[0].value as string;
    const iterRaw = kdfParams[1].value as string;
    const iter = forge.util.createBuffer(iterRaw).getInt(8 * iterRaw.length);
    let md: forge.md.MessageDigest = forge.md.sha1.create();
    const prf = kdfParams.find((n, i) => i >= 2 && n.type === forge.asn1.Type.SEQUENCE);
    if (prf) {
      const prfOid = forge.asn1.derToOid((prf.value as forge.asn1.Asn1[])[0].value as string);
      if (prfOid === '1.2.840.113549.2.9') md = forge.md.sha256.create();
      else if (prfOid === '1.2.840.113549.2.11') md = forge.md.sha512.create();
    }
    const schemeParts = scheme.value as forge.asn1.Asn1[];
    const schemeOid = forge.asn1.derToOid(schemeParts[0].value as string);
    if (schemeOid !== '1.2.410.200004.1.4') throw new Error('이 공동인증서의 암호 방식은 아직 읽지 못해요.');
    iv = u8(schemeParts[1].value as string);
    key = u8(forge.pkcs5.pbkdf2(utf8(password), salt, iter, 16, md));
  } else {
    throw new Error('이 공동인증서의 암호 방식은 아직 읽지 못해요.');
  }
  let plain: Uint8Array;
  try { plain = KISA_SEED_CBC.SEED_CBC_Decrypt(key, iv, data, 0, data.length); }
  catch { throw new Error('인증서 암호가 맞지 않아요.'); }
  try {
    const info = forge.asn1.fromDer(bin(plain));
    // PrivateKeyInfo 안의 RSAPrivateKey (공동인증서는 뒤에 따로 붙은 속성이 있어 직접 꺼낸다)
    const inner = (info.value as forge.asn1.Asn1[])[2].value as string;
    return forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(inner)) as forge.pki.rsa.PrivateKey;
  } catch { throw new Error('인증서 암호가 맞지 않아요.'); }
}

export function loadNpki(certDer: Uint8Array, keyDer: Uint8Array, password: string): SignCert {
  const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(bin(certDer)));
  const key = decryptNpkiKey(keyDer, password);
  checkPair(cert, key);
  return { cert, key, chain: [] };
}

export function loadPfx(bytes: Uint8Array, password: string): SignCert {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try { p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(bin(bytes)), false, password); }
  catch { throw new Error('인증서 파일을 열지 못했어요. 암호를 확인해 주세요.'); }
  const keys = [...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []), ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [])];
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((b) => b.cert!).filter(Boolean);
  const key = keys[0]?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key || !certs.length) throw new Error('인증서 파일에 개인키나 인증서가 없어요.');
  const cert = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n.equals(key.n)) ?? certs[0];
  checkPair(cert, key);
  return { cert, key, chain: certs.filter((c) => c !== cert) };
}

function checkPair(cert: forge.pki.Certificate, key: forge.pki.rsa.PrivateKey) {
  const pub = cert.publicKey as forge.pki.rsa.PublicKey;
  if (!pub.n || !pub.n.equals(key.n)) throw new Error('인증서와 개인키가 서로 맞지 않아요.');
}

/** 서명용 인증서 새로 만들기 (스스로 서명, 5년). 만든 것은 .pfx로 저장해 두고 다음에 다시 쓴다 */
export function createSelfSigned(name: string, org: string, password: string): { sc: SignCert; pfx: Uint8Array } {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(15));
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 60000);
  cert.validity.notAfter = new Date(now.getFullYear() + 5, now.getMonth(), now.getDate());
  const attrs = [{ shortName: 'CN', value: utf8(name) }, ...(org ? [{ shortName: 'O', value: utf8(org) }] : []), { shortName: 'C', value: 'KR' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    { name: 'extKeyUsage', emailProtection: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des', friendlyName: name });
  return { sc: { cert, key: keys.privateKey, chain: [] }, pfx: u8(forge.asn1.toDer(p12).getBytes()) };
}

/** 공동인증서 인증서(signCert.der)만 읽어 이름·만료일 보여 주기 */
export function peekCert(certDer: Uint8Array): CertInfo | null {
  try { return certInfo(forge.pki.certificateFromAsn1(forge.asn1.fromDer(bin(certDer)))); } catch { return null; }
}

/** PDF에 넣을 서명(CMS, detached, SHA-256) */
export function cmsSign(sc: SignCert, data: Uint8Array): Uint8Array {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(bin(data));
  p7.addCertificate(sc.cert);
  for (const c of sc.chain) p7.addCertificate(c);
  p7.addSigner({
    key: sc.key,
    certificate: sc.cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  return u8(forge.asn1.toDer(p7.toAsn1()).getBytes());
}
