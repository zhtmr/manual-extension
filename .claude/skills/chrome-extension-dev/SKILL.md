---
name: chrome-extension-dev
description: "페이지 매뉴얼 크롬 확장(MV3, 사이드 패널)의 구조·코딩 규칙을 정한다. extension/ 아래 manifest, 서비스 워커, 콘텐츠 스크립트, 사이드 패널, 옵션 페이지, URL 매칭, 페이지 이동(SPA 포함) 감지, Claude API 폴백 생성 코드를 설계·구현·수정할 때 사용한다. 매뉴얼 내용 작성은 page-manual-authoring, 검증 절차는 extension-qa 스킬을 쓴다."
---

# 크롬 확장 개발 규칙

이 확장은 사용자가 페이지를 이동할 때마다 그 페이지의 역할·기능·조작 방법을 사이드 패널에 보여준다. 매뉴얼은 **사전 작성 JSON을 먼저 찾고, 없으면 Claude API로 즉석 생성**한다(하이브리드).

## 1. 고정 결정 사항

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 매니페스트 | Manifest V3 | MV2는 크롬에서 더 이상 동작하지 않는다. |
| 표시 위치 | `chrome.sidePanel` | 페이지를 가리지 않고, 페이지 이동 시 내용만 바뀐다. |
| 언어·빌드 | 순수 JS, ES 모듈, 빌드 도구 없음 | 사용자가 폴더를 그대로 "압축 해제된 확장 프로그램 로드"로 시험할 수 있다. |
| 매뉴얼 데이터 | `extension/manuals/*.json` | 매뉴얼 작성 트랙이 JSON만 바꾸면 코드 수정 없이 반영된다. 스키마는 `page-manual-authoring` 스킬의 `references/manual-schema.md`. |
| AI 폴백 | 서비스 워커에서 Claude API 직접 호출, 사용자 API 키 | 별도 서버 없이 동작한다. 키는 `chrome.storage.local`에만 저장한다. |
| 테스트 | `node --test "extension/tests/**/*.test.js"` | 순수 함수는 브라우저 없이 검증한다. |

## 2. 파일 구조

```
extension/
├── manifest.json
├── manuals/
│   ├── index.json              # [{ siteId, file }] — 불러올 매뉴얼 파일 목록
│   └── {siteId}.json
├── src/
│   ├── shared/
│   │   ├── messages.js         # MSG 상수 — 모든 메시지 타입의 단일 정의
│   │   ├── matcher.js          # URL → 매뉴얼 페이지 매칭(순수 함수)
│   │   └── manual-schema.js    # 매뉴얼 항목 검증(순수 함수)
│   ├── background/
│   │   ├── service-worker.js   # 페이지 이동 감지, 매뉴얼 결정, 패널 통지
│   │   └── ai-manual.js        # Claude API 폴백 생성 + 캐시
│   ├── content/
│   │   └── page-agent.js       # 페이지 구조 추출, 요소 하이라이트 (모듈 아님, 자체 완결)
│   ├── sidepanel/  sidepanel.html / .js / .css
│   └── options/    options.html / .js     # API 키, 모델, AI 폴백 허용 사이트
└── tests/  *.test.js
```

## 3. 페이지 이동 감지

SPA(사내 시스템에 흔하다)는 `history.pushState`로 URL만 바꾸므로 `tabs.onUpdated`만으로는 놓친다. 서비스 워커에서 다음을 모두 듣고, **같은 탭에서 정규화한 URL이 바뀐 경우에만** 처리한다.

- `chrome.tabs.onUpdated` (`changeInfo.url` 또는 `status === 'complete'`)
- `chrome.webNavigation.onHistoryStateUpdated`, `onReferenceFragmentUpdated` (해시 라우팅)
- `chrome.tabs.onActivated` (탭 전환 시 패널 갱신)

URL 정규화: 쿼리 중 매칭에 쓰지 않는 값과 해시 앞의 `/`를 정리한다. 같은 URL 이벤트가 연달아 오므로 탭별 마지막 URL을 기억하고 150ms 디바운스한다.

## 4. 매뉴얼 결정 흐름

```
URL 변경 → matcher.findPage(manuals, url)
  ├─ 일치 → { source: "authored", page } 를 패널에 전송
  └─ 불일치 → 이 origin이 AI 폴백 허용 목록에 있는가?
        ├─ 아니오 → { source: "none" } (패널은 "매뉴얼 없음" + AI 생성 허용 안내)
        └─ 예 → 캐시(storage.local, 키 = origin + urlPattern 추정) 확인
               ├─ 있음 → { source: "ai-cache", page }
               └─ 없음 → 패널에 loading 전송 → content 스크립트로 구조 추출 → Claude API → 검증 → 캐시 → { source: "ai", page }
```

매칭 우선순위는 `exact` > `glob` > `regex`, 같은 종류끼리는 더 긴(구체적인) 패턴이 이긴다. 자세한 규칙은 `references/architecture.md`의 「URL 매칭」을 읽는다.

## 5. 서비스 워커 주의점

- 서비스 워커는 30초 정도 유휴 상태면 종료된다. 전역 변수에 상태를 두지 말고 `chrome.storage.session`(탭별 마지막 URL·현재 매뉴얼)을 쓴다. 종료 후 패널이 다시 열리면 `MSG.GET_CURRENT_MANUAL`로 복구한다.
- 이벤트 리스너는 최상위에서 동기적으로 등록한다. `await` 뒤에 등록하면 재시작 시 이벤트를 놓친다.
- `onMessage`에서 비동기 응답을 보내려면 `return true`를 해야 한다.
- 사이드 패널이 닫혀 있으면 `runtime.sendMessage`가 "Receiving end does not exist" 오류를 낸다. 잡아서 무시한다.

## 6. 보안·개인정보 (사내 시스템 대상)

- AI 폴백은 **사이트별 동의(opt-in)**다. 옵션에서 허용한 origin에서만 페이지 내용을 외부로 보낸다.
- 구조 추출 시 `input`/`textarea`/`select`의 **값은 절대 보내지 않는다**. 라벨, placeholder, 버튼 텍스트, 제목, 표 머리글만 보낸다. 표 본문 셀과 긴 본문 텍스트도 보내지 않는다.
- `password`, `hidden` 필드는 라벨도 생략한다.
- API 키는 `chrome.storage.local`에만 둔다. 로그·에러 메시지에 키를 출력하지 않는다.
- 사이드 패널에 매뉴얼을 그릴 때 `innerHTML`을 쓰지 않는다. AI 응답은 신뢰할 수 없는 문자열이므로 `textContent`와 DOM API로 그린다.
- 원격 스크립트를 불러오지 않는다(MV3 CSP).

## 7. Claude API 호출

구현 전에 `claude-api` 스킬을 불러와 최신 모델 ID, `anthropic-version`, 브라우저 직접 호출 헤더(`anthropic-dangerous-direct-browser-access`)를 확인한다. 기본 모델은 빠르고 저렴한 최신 Haiku 계열로 두고 옵션에서 바꿀 수 있게 한다. 응답은 매뉴얼 페이지 스키마 JSON만 반환하도록 요청하고, `manual-schema.js`로 검증한 뒤에만 표시·캐시한다. 프롬프트 초안은 `references/architecture.md`의 「AI 생성 프롬프트」에 있다.

## 8. 사이드 패널 UI

- 상단: 페이지 제목 + 출처 배지(`작성됨` / `AI 생성` / `없음`). AI 생성 매뉴얼은 정확하지 않을 수 있다는 한 줄 안내를 붙인다.
- 본문 순서: 역할 → 주요 기능 → 조작 방법(작업별 접이식 단계) → 팁 → 관련 페이지.
- 조작 방법 단계에 `targets`가 있으면 「화면에서 보기」 버튼으로 `MSG.HIGHLIGHT` 전송.
- 상태: loading(스켈레톤), error(재시도 버튼), none(옵션 이동 링크).
- 라이트/다크 모드 모두 `prefers-color-scheme`로 지원한다.

## 참고 문서

- `references/architecture.md` — 메시지 계약 기본안, URL 매칭 상세, 캐시 키, AI 생성 프롬프트. 설계·구현을 시작할 때 읽는다.
