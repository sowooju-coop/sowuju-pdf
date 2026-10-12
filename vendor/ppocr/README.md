# PaddleOCR 모델 (글자 읽기)

소우주 PDF의 스캔 문서 글자 읽기(OCR)에 쓰는 PaddleOCR PP-OCRv5 모델입니다. 고치지 않고 그대로 넣었습니다.

| 파일 | 원본 | 리비전 | SHA-256 |
|---|---|---|---|
| `ppocr-det.onnx` | [PaddlePaddle/PP-OCRv5_mobile_det_onnx](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx) `inference.onnx` | e6f4fa85f00e168c862bc462aebca69eef9b3d3d | a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d |
| `ppocr-kor-rec.onnx` | [PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx](https://huggingface.co/PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx) `inference.onnx` | 5c6f574b8e2230adf4287b33e736d71b9fabd28e | 92f0b7785e64fc9090106a241cf4c1eb97472824558272751b88a2a4476d3a08 |
| `ppocr-kor-dict.txt` | 같은 곳 `inference.yml`의 `character_dict` (한 줄에 한 글자) | 〃 | a7872c929cd25cf615cdfea08579cf800db1943900fe683468df4dcff6f848bb |

- 저작권: PaddlePaddle Authors
- 라이선스: Apache License 2.0 (`LICENSE-Apache-2.0.txt`)
