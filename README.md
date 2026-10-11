# 소우주 PDF

누구나 무료로 쓰고 고칠 수 있는 한글 PDF 편집기입니다.
광고 없이, 파일을 외부 서버로 보내지 않고, 내 컴퓨터 안에서만 PDF를 열고 고치고 인쇄합니다.

소우주사회적협동조합이 "기술로부터 소외된 이웃이 없는 사회"를 위해 만들고 소스를 공개합니다.

## 지금 할 수 있는 일

- **티 안 나는 글자 수정**: 줄을 누르거나 글자 위를 끌어 고르고 고치면, 바뀐 글자만 파일에서 진짜로 지우고 같은 자리에 새로 씁니다. 원래 글꼴에 맞춰 고딕·명조, 굵기, 크기, 자간, 색을 자동으로 맞추고, 표 선이나 배경은 그대로 둡니다.
- 실행 취소·다시 실행
- PDF 열기 (암호가 걸린 PDF 포함), 끌어다 놓아 열기
- 페이지 미리보기, 확대·축소·폭 맞춤
- 페이지 회전, 삭제, 순서 바꾸기
- 저장
- 인쇄: 전체 / 지금 보는 쪽 / 고른 쪽, 품질(200·300·600dpi) 선택 후 운영체제 인쇄 창에서 프린터·매수·양면 선택

앞으로 할 일은 [docs/ROADMAP.md](docs/ROADMAP.md)에 있습니다.

## 설치

[Releases](https://github.com/sowooju-coop/sowuju-pdf/releases)에서 `SowujuPDF-Setup-버전.exe`를 내려받아 실행하세요.

> 아직 코드 서명 인증서가 없어 처음 실행할 때 Windows에서 "알 수 없는 게시자" 경고가 나올 수 있습니다. "추가 정보 → 실행"을 누르면 설치됩니다.

## 개발

Node.js 20 이상이 필요합니다.

```bash
npm install
npm run dev        # 브라우저에서 화면만 띄우기 (http://localhost:5173)
npm run dev:app    # 설치형(Electron) 창으로 띄우기
npm run typecheck  # 타입 검사
npm run dist:win   # Windows 설치 파일 만들기 (release/ 폴더)
```

### 구조

| 경로 | 역할 |
|---|---|
| `electron/main.cjs` | 설치형 창, 파일 열기·저장 대화상자, 인쇄 |
| `electron/preload.cjs` | 화면에 열어 주는 기능 목록 |
| `src/worker/mupdf.worker.ts` | MuPDF로 PDF를 읽고 그리고 고치는 작업 스레드 |
| `src/worker/textEdit.ts` | 글자 단위로 읽기, 원래 글자 지우기(redaction), 새 글자 쓰기 |
| `src/lib/textDiff.ts` | 고친 글자와 원래 글자를 비교해 바뀐 부분만 다시 쓰는 규칙 |
| `src/components/EditLayer.tsx` | 글자 수정 화면 |
| `src/lib/pdfClient.ts` | 작업 스레드와 주고받는 창구 |
| `src/lib/host.ts` | 설치형과 브라우저의 차이(열기·저장·인쇄)를 감춤 |
| `src/App.tsx` | 화면 |

## 라이선스

이 프로그램은 [GNU AGPL v3 이상](LICENSE)으로 공개됩니다. 누구나 무료로 쓰고, 고치고, 다시 배포할 수 있습니다.
고친 프로그램을 배포하거나 서비스로 제공할 때는 그 소스도 같은 라이선스로 공개해야 합니다.

함께 쓰는 부품의 라이선스는 [NOTICE.md](NOTICE.md)를 보세요.
