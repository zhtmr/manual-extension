---
name: extension-qa
description: "페이지 매뉴얼 크롬 확장의 검증 절차를 정한다. 정적 검사 스크립트(manifest, 메시지 계약, 보안 패턴, 매뉴얼 origin 권한), node 단위 테스트, 실제 Chrome에 확장을 불러와 페이지 이동·SPA 라우팅·사이드 패널 표시·AI 폴백을 시험하는 방법과 보고서 형식을 담는다. extension-qa 에이전트가 모듈 검사나 출시 전 점검을 할 때 사용한다. 매뉴얼 내용의 사실 검토는 page-manual-authoring의 검토 체크리스트를 쓴다."
---

# 확장 검증 절차

모듈이 끝날 때마다 검사한다. 전체가 끝난 뒤 한 번만 검사하면 계약 불일치가 여러 모듈에 퍼진 뒤에 발견된다.

## 1. 정적 검사 (항상 실행)

```
node .claude/skills/extension-qa/scripts/validate_extension.mjs extension
node --test "extension/tests/**/*.test.js"
```

`validate_extension.mjs`가 확인하는 것: MV3·필수 권한·참조 파일 존재, HTML의 원격 스크립트·인라인 스크립트, `MSG.*` 사용처가 `messages.js`에 정의됐는지와 콘텐츠 스크립트 복사본이 같은지, `eval`·`innerHTML`·API 키 로그, 매뉴얼 origin의 host 권한, 매뉴얼 스키마.

스크립트가 `경고`로 남긴 항목은 직접 코드를 열어 판정한다. 예: `MSG.X가 한 파일에서만 쓰임`은 받는 쪽이 빠진 버그일 수도, 같은 파일이 보내고 받는 정상 구조일 수도 있다.

## 2. 계약 교차 검사 (스크립트가 못 보는 부분)

설계 문서의 메시지 계약 표를 기준으로, 메시지마다 **보내는 코드의 payload 필드**와 **받는 코드가 읽는 필드**를 나란히 적어 대조한다.

| 확인 | 흔한 버그 |
| --- | --- |
| 비동기 응답 핸들러가 `return true` 하는가 | 응답이 `undefined`로 도착 |
| 패널이 닫힌 상태의 `sendMessage` 오류를 잡는가 | 서비스 워커 콘솔에 Uncaught 오류 |
| 서비스 워커 상태를 `storage.session`에 두는가 | 30초 뒤 패널이 빈 화면 |
| 리스너를 최상위에서 동기 등록하는가 | 워커 재시작 후 페이지 이동 무시 |
| `PageStructure`에 입력값이 없는가 | 개인정보 외부 전송 |
| AI 응답을 스키마 검증 뒤에만 표시·캐시하는가 | 깨진 JSON이 캐시에 남음 |
| `matcher.js`와 `validate_manuals.mjs`의 매칭 결과가 같은가 | 작성한 매뉴얼이 표시 안 됨 |

마지막 항목은 `00_pages.json`의 URL들을 두 구현에 모두 넣어 결과를 비교하는 테스트를 `extension/tests/`에 두도록 제안한다.

## 3. 브라우저 동작 시험

사용할 수 있는 도구에 따라 고른다. 둘 다 없으면 이 절 전체를 `blocked`로 표시하고 사용자 수동 시험 절차를 보고서에 적는다.

- **Playwright**: `chromium.launchPersistentContext(userDataDir, { headless: false, args: ['--disable-extensions-except=<abs>/extension', '--load-extension=<abs>/extension'] })`. 서비스 워커는 `context.serviceWorkers()` 또는 `context.waitForEvent('serviceworker')`로 얻고, 확장 ID는 워커 URL에서 꺼낸다. 사이드 패널은 `chrome-extension://<id>/src/sidepanel/sidepanel.html?tabId=<id>`를 탭으로 열어 시험한다(사이드 패널 UI 자체는 자동화로 열 수 없다).
- **claude-in-chrome**: 사용자가 `chrome://extensions`에서 "압축 해제된 확장 프로그램 로드"로 이미 불러온 경우에만 쓴다. 확장 설치를 자동화하려 하지 않는다.

시험 시나리오(로컬 정적 서버로 대상 사이트를 흉내 내면 사내 시스템 없이도 시험할 수 있다. `extension/tests/fixtures/`에 SPA 한 개와 일반 페이지 두 개를 두도록 제안한다):

1. 매뉴얼이 있는 페이지 진입 → 패널에 `작성됨` 배지와 해당 매뉴얼.
2. 링크로 다른 페이지 이동 → 패널 내용 교체.
3. SPA에서 `pushState`로 이동 → 패널 교체(새로고침 없이).
4. 해시 라우팅 이동 → 패널 교체.
5. 탭 전환 → 그 탭의 매뉴얼로 교체.
6. 매뉴얼 없는 페이지, AI 폴백 미허용 → `없음` 상태와 옵션 안내.
7. AI 폴백 허용 + API 키 없음 → 키 설정 안내 오류(크래시 아님).
8. 「화면에서 보기」 → 대상 요소 하이라이트, 선택자가 없으면 "요소를 찾지 못함" 표시.
9. 서비스 워커 종료 후(`chrome://serviceworker-internals` 또는 30초 대기) 패널 다시 열기 → 현재 매뉴얼 복구.

API 키로 실제 Claude API를 부르는 시험은 사용자가 키를 제공했을 때만 하고, 그 외에는 `fetch`를 가로채 가짜 응답(정상 JSON, 깨진 JSON, 401, 429)으로 시험한다.

## 4. 보고서 형식

`_workspace/dev/03_qa_report_r{N}.md`

```markdown
# QA 보고서 r{N} — {모듈명}
판정: pass | fail | blocked   (critical 0 / major 0 / minor 0)

## 실행한 검사
| 검사 | 결과 | 비고 |

## 문제
### [major] 제목
- 재현: 1. … 2. …
- 기대 / 실제:
- 위치: extension/src/…:줄
- 제안:

## 확인하지 못한 항목
- 항목 — 이유(도구 없음 등)
```

이전 라운드 문제는 맨 위에 `재검사` 절을 두고 `해결 / 미해결`로 표시한다.
