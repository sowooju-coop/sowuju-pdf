# Code signing policy (코드 서명 정책)

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org)

## 무엇에 서명하나요 (What is signed)

- 이 저장소의 소스 코드로 GitHub Actions(`.github/workflows/release.yml`)에서 자동으로 만든 Windows 설치 파일(`SowujuPDF-Setup-<버전>.exe`)만 서명합니다.
- 다른 사람이 만든 실행 파일이나, 이 저장소에서 빌드하지 않은 파일에는 서명하지 않습니다.
- 서명 요청은 매번 아래 승인자가 SignPath에서 직접 확인하고 승인해야 처리됩니다.

Only the Windows installer built by GitHub Actions from the source code in this repository is signed.
Every signing request is manually approved by an approver listed below.

## 역할 (Team roles)

| 역할 Role | 누구 Who |
|---|---|
| 작성자·검토자 Committers and reviewers | [sowooju-coop 구성원 (Members)](https://github.com/orgs/sowooju-coop/people) |
| 승인자 Approvers | [sowooju-coop 소유자 (Owners)](https://github.com/orgs/sowooju-coop/people?query=role%3Aowner) |

모든 구성원은 GitHub 2단계 인증(MFA)을 사용합니다. All team members use multi-factor authentication.

## 개인정보 (Privacy policy)

[PRIVACY.md](PRIVACY.md)를 보세요. See [PRIVACY.md](PRIVACY.md).
