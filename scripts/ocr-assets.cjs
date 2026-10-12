// 글자 읽기(OCR)에 쓰는 파일을 public/ocr/로 복사한다. 인터넷에서 받지 않고 프로그램 안에 넣어 둔다.
// onnxruntime-web(MIT) 실행 파일, PaddleOCR PP-OCRv5 글줄 찾기·한국어 인식 모델(Apache-2.0, vendor/ppocr)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public', 'ocr');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const vendor = (f) => path.join(root, 'vendor', 'ppocr', f);
const files = [
  [nm('onnxruntime-web', 'dist', 'ort-wasm-simd-threaded.mjs'), 'ort-wasm-simd-threaded.mjs'],
  [nm('onnxruntime-web', 'dist', 'ort-wasm-simd-threaded.wasm'), 'ort-wasm-simd-threaded.wasm'],
  [vendor('ppocr-det.onnx'), 'ppocr-det.onnx'],
  [vendor('ppocr-kor-rec.onnx'), 'ppocr-kor-rec.onnx'],
  [vendor('ppocr-kor-dict.txt'), 'ppocr-kor-dict.txt'],
];
fs.mkdirSync(out, { recursive: true });
// 예전 글자 읽기(tesseract) 파일은 지운다
const keep = new Set(files.map(([, to]) => to));
for (const f of fs.readdirSync(out)) if (!keep.has(f)) fs.rmSync(path.join(out, f));
for (const [from, to] of files) {
  const dest = path.join(out, to);
  const a = fs.statSync(from);
  if (fs.existsSync(dest) && fs.statSync(dest).size === a.size) continue;
  fs.copyFileSync(from, dest);
}
