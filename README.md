# 소우주 PDF

누구나 무료로 쓰고 고칠 수 있는 한글 PDF 편집기입니다.
광고 없이, 파일을 외부 서버로 보내지 않고, 내 컴퓨터 안에서만 PDF를 열고 고치고 인쇄합니다.

소우주사회적협동조합이 "기술로부터 소외된 이웃이 없는 사회"를 위해 만들고 소스를 공개합니다.

## 지금 할 수 있는 일

- **티 안 나는 글자 수정**: 줄을 누르거나 글자 위를 끌어 고르고 고치면, 바뀐 글자만 파일에서 진짜로 지우고 같은 자리에 새로 씁니다. 한글(HWP)·워드에서 만든 PDF는 문서에 들어 있는 원래 글꼴을 그대로 써서, 문서에 없던 글자만 비슷한 글꼴로 채웁니다. 원래 글꼴에 맞춰 고딕·명조, 굵기, 크기, 자간, 색을 자동으로 맞추고, 표 선이나 배경은 그대로 둡니다.
- **글자 추가·날짜**: 빈칸을 누르고 바로 쓰면 돼요(단축키 T). 고딕·명조, 크기, 굵게, 검정·파랑·빨강을 고를 수 있고 여러 줄도 돼요. 날짜는 2026. 10. 12. / 2026년 10월 12일 같은 서류용 모양 중에서 골라 넣어요. 넣은 글자는 진짜 글자라 검색·복사가 되고, 나중에 글자 고치기로 다시 고칠 수 있어요.
- **형광펜·펜·도형·체크**: 형광펜(노랑·연두·분홍, 아래 글자가 그대로 보여요), 자유롭게 그리는 펜, 체크 표시(✓), 네모, 동그라미, 선, 화살표. 색과 굵기를 고를 수 있고, 적용하면 문서 내용으로 들어가서 어느 프로그램에서 열어도, 인쇄해도 똑같이 나와요.
- **보호**: 주민번호(뒷자리만 가리기 가능)·전화번호·이메일·계좌번호를 찾아 파일에서 완전히 지우고, 원하는 글자를 더 찾거나 네모를 그려 직접 가릴 수 있어요. 작성자 같은 문서 정보도 지워요. 암호 걸기(인쇄만 허락 가능)·풀기, 사진·스캔을 줄여 용량 줄이기.
- **여러 문서 탭**: 여러 PDF를 탭으로 열어 오가며 볼 수 있어요(Ctrl+T 새 탭, Ctrl+W 닫기, Ctrl+Tab 다음 탭). 탭마다 따로 처리해서 서로 영향이 없어요.
- **양식 칸 채우기**: 신청서 PDF에 들어 있는 입력칸·체크칸·라디오·고르는 칸에 바로 써요. 한글은 글꼴을 함께 넣어 다른 프로그램에서 열어도 깨지지 않아요.
- **그림·메모**: 사진·그림 파일을 쪽 위에 놓고, 노란 쪽지 메모를 붙여요(인쇄에도 나와요).
- **자동 업데이트**: 새 버전이 나오면 뒤에서 받아 두고, 다시 시작하거나 끌 때 바뀌어요.
- **서명·직인**: 서명을 그리거나, 이름을 입력해 손글씨체로 만들거나, 사진·투명 PNG에서 가져와요. 직인은 법인 원형 인감(테두리 기관명·가운데 직함), 채움형 인감, 네모 직인, 개인 도장 중에서 가운데 직함(한글·한자, 협동조합은 이사장)과 글씨체(명조·붓 명조·굵은 고딕·인장체)를 골라 만들거나 직인 사진에서 빨간 인주만 남겨 넣어요. 모든 쪽의 같은 자리에 한 번에 넣을 수 있고, 만든 것은 보관함에 저장돼요.
- 실행 취소·다시 실행
- PDF 열기 (암호가 걸린 PDF 포함), 끌어다 놓아 열기
- 페이지 미리보기, 확대·축소·폭 맞춤
- 페이지 관리: 빈 쪽 넣기, 다른 PDF·사진에서 쪽 넣기, 합치기, 복제, 돌리기, 지우기, 끌어서 순서 바꾸기, 고른 쪽만 새 PDF로 저장
- 저장
- 인쇄: 전체 / 지금 보는 쪽 / 고른 쪽, 품질(200·300·600dpi) 선택 후 운영체제 인쇄 창에서 프린터·매수·양면 선택

앞으로 할 일은 [docs/ROADMAP.md](docs/ROADMAP.md)에 있습니다.

## 설치

[Releases](https://github.com/sowooju-coop/sowuju-pdf/releases)에서 `SowujuPDF-Setup-버전.exe`를 내려받아 실행하세요.

> 아직 코드 서명 인증서가 없어 처음 실행할 때 Windows에서 "알 수 없는 게시자" 경고가 나올 수 있습니다. "추가 정보 → 실행"을 누르면 설치됩니다.

한 번 설치하면 새 버전은 프로그램이 알아서 받습니다(시작 화면 아래 '자동 확인'으로 끌 수 있어요).

## Code signing policy (코드 서명 정책)

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org)

- 서명 대상, 승인 절차, 역할: [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md)
- 작성자·검토자 (Committers and reviewers): [sowooju-coop 구성원](https://github.com/orgs/sowooju-coop/people)
- 승인자 (Approvers): [sowooju-coop 소유자](https://github.com/orgs/sowooju-coop/people?query=role%3Aowner)

## 개인정보 (Privacy policy)

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. 단, 새 버전 확인을 위해 GitHub에 접속하며 끌 수 있습니다. 자세히: [PRIVACY.md](PRIVACY.md)

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
