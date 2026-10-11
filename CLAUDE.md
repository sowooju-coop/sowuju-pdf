# 소우주 PDF 개발 안내

- 사용자에게 보이는 문구는 한국어, 쉬운 말로 쓴다. "고령자" 대신 "노인".
- PDF 처리는 모두 `src/worker/mupdf.worker.ts`에서 한다. 화면 쪽에서 MuPDF를 직접 부르지 않는다.
- 설치형 전용 기능은 `electron/preload.cjs`로 열고 `src/lib/host.ts`에서 브라우저 대체 동작을 함께 둔다.
- 바꾼 뒤에는 `npm run typecheck`와 `npm run build`가 통과해야 한다.
- 라이선스는 AGPL-3.0-or-later. 새 부품을 넣을 때는 AGPL과 함께 쓸 수 있는지 확인하고 NOTICE.md에 적는다.
