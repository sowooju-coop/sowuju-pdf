# 코드 서명(SignPath) 신청과 설정 안내

Windows 설치 파일에 무료 코드 서명을 받기 위한 절차입니다. 저장소 쪽 준비(정책 문서, 개인정보 안내, 빌드 연결)는 끝나 있고, 아래 **사람이 해야 하는 일**만 남았습니다.

## 1. 신청 전에 확인

- [ ] 저장소 소유자·구성원 모두 GitHub **2단계 인증(MFA)** 켜기 (조직 설정 → Authentication security에서 필수로 지정 가능)
- [ ] README에 'Code signing policy'와 SignPath 문구, 역할, 개인정보 안내가 있음 (완료)
- [ ] 이미 배포한 버전이 있음 (v0.1.0~ 완료)

## 2. 신청하기

https://signpath.org/apply 에서 신청합니다. 아래 답변을 그대로 붙여 넣어도 됩니다.

| 항목 | 답변 |
|---|---|
| Project name | Sowuju PDF (소우주 PDF) |
| Repository | https://github.com/sowooju-coop/sowuju-pdf |
| Homepage / download page | https://github.com/sowooju-coop/sowuju-pdf (Releases: https://github.com/sowooju-coop/sowuju-pdf/releases) |
| License | AGPL-3.0-or-later |
| Build system | GitHub Actions (`.github/workflows/release.yml`), GitHub-hosted Windows runner |
| What is signed | The NSIS Windows installer `SowujuPDF-Setup-<version>.exe` built from this repository |
| Code signing policy | https://github.com/sowooju-coop/sowuju-pdf/blob/main/CODE_SIGNING_POLICY.md |
| Privacy policy | https://github.com/sowooju-coop/sowuju-pdf/blob/main/PRIVACY.md |

**프로젝트 소개 (Description)**

> Sowuju PDF is a free, ad-free Korean PDF editor for Windows made by Sowuju Social Cooperative, a non-profit social cooperative working on digital inclusion for older adults and children in Korea. It edits text in place (keeping the original embedded fonts), fills PDF forms, adds signatures and seals, redacts personal information, manages pages and prints — entirely offline on the user's computer. It is built with Electron, React and MuPDF.js, and released under AGPL-3.0-or-later.

**확인 요청 (Note)**

> The PDF engine we depend on, MuPDF.js, is published under AGPL-3.0 by Artifex, who also sell commercial licenses for it. Our own project is AGPL-only with no commercial dual licensing. Please let us know if the MuPDF dependency is a problem for the "no commercial dual-licensing" condition.

## 3. 승인 뒤 SignPath에서 할 일

1. Organization 설정에서 Trusted Build System **GitHub.com** 추가
2. Project 만들기: slug `sowuju-pdf`, Repository URL 위 주소, Trusted build system GitHub.com 연결
3. Artifact configuration: `.signpath/artifact-configuration.xml` 내용을 붙여 넣기
4. Signing policy: slug `release-signing`, 승인자(Approver)에 소유자 지정
5. 서명 요청을 보낼 사용자(CI용)의 API token 만들기

## 4. 승인 뒤 GitHub 저장소에서 할 일

Settings → Secrets and variables → Actions

- Secrets: `SIGNPATH_API_TOKEN` = SignPath API token
- Variables: `SIGNPATH_ORGANIZATION_ID` = SignPath 조직 ID
- (slug를 다르게 만들었으면) Variables: `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_POLICY_SLUG`

이것만 넣으면 다음 릴리스부터 자동으로 서명 요청이 갑니다. **SignPath 화면에서 승인자가 승인(1시간 안)** 해야 빌드가 이어지고, 서명된 파일과 자동 업데이트 정보(latest.yml)가 올라갑니다. 설정을 넣기 전까지는 지금처럼 서명 없이 올라갑니다.
