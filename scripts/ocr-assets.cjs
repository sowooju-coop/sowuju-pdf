// 글자 읽기(OCR)에 쓰는 파일을 public/ocr/로 복사한다. 인터넷에서 받지 않고 프로그램 안에 넣어 둔다.
// tesseract.js·tesseract.js-core(Apache-2.0), 한국어·영어 학습 자료(tessdata, Apache-2.0)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public', 'ocr');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const files = [
  [nm('tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js'],
  ...['lstm', 'simd-lstm', 'relaxedsimd-lstm'].map((v) => [nm('tesseract.js-core', `tesseract-core-${v}.wasm.js`), `tesseract-core-${v}.wasm.js`]),
  // 한국어는 표준 자료(4.0.0)가 best_int보다 정확했다 (틀린 글자 11.7% → 9.9%)
  [nm('@tesseract.js-data', 'kor', '4.0.0', 'kor.traineddata.gz'), 'kor.traineddata.gz'],
  [nm('@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
];
fs.mkdirSync(out, { recursive: true });
for (const [from, to] of files) {
  const dest = path.join(out, to);
  const a = fs.statSync(from);
  if (fs.existsSync(dest) && fs.statSync(dest).size === a.size) continue;
  fs.copyFileSync(from, dest);
}
