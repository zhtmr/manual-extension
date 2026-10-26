# 아키텍처 상세

## 1. 메시지 계약 기본안

`src/shared/messages.js`에 아래 상수를 정의하고 모든 송수신 코드는 이 상수만 쓴다. 문자열 리터럴로 직접 타입을 쓰지 않는다. QA 스크립트가 정의·사용·처리 지점을 대조한다.

```js
export const MSG = Object.freeze({
  MANUAL_UPDATED: 'MANUAL_UPDATED',         // SW → panel
  GET_CURRENT_MANUAL: 'GET_CURRENT_MANUAL', // panel → SW (패널 열림/복구)
  REGENERATE_MANUAL: 'REGENERATE_MANUAL',   // panel → SW (AI 매뉴얼 다시 생성)
  EXTRACT_PAGE: 'EXTRACT_PAGE',             // SW → content (구조 추출)
  HIGHLIGHT: 'HIGHLIGHT',                   // panel → SW → content
  CLEAR_HIGHLIGHT: 'CLEAR_HIGHLIGHT',       // panel → SW → content
});
```

콘텐츠 스크립트는 모듈이 아니므로 `messages.js`를 import할 수 없다. `page-agent.js` 맨 위에 같은 값의 상수를 복사해 두고 `// sync: src/shared/messages.js` 주석을 단다. QA 스크립트가 두 정의가 같은지 확인한다.

| 타입 | 보내는 쪽 → 받는 쪽 | payload | 응답 |
| --- | --- | --- | --- |
| MANUAL_UPDATED | SW → panel | `{ tabId, url, state: "loading"\|"ready"\|"none"\|"error", source?, page?, error? }` | 없음 |
| GET_CURRENT_MANUAL | panel → SW | `{ tabId }` | MANUAL_UPDATED payload와 같은 형태 |
| REGENERATE_MANUAL | panel → SW | `{ tabId }` | `{ ok }` |
| EXTRACT_PAGE | SW → content | `{}` | `PageStructure` (아래) |
| HIGHLIGHT | panel → SW → content | `{ tabId, selectors: string[] }` | `{ found: number }` |
| CLEAR_HIGHLIGHT | panel → SW → content | `{ tabId }` | `{ ok }` |

`PageStructure`(외부 전송 대상, 값 없음):
```json
{ "url": "", "title": "", "headings": [{"level":1,"text":""}],
  "nav": [""], "buttons": [{"text":"","selector":""}],
  "fields": [{"label":"","type":"","placeholder":"","selector":""}],
  "tables": [{"caption":"","headers":[""]}], "notices": [""] }
```
각 배열은 최대 50개, 문자열은 최대 120자로 자른다(토큰 비용과 유출 범위를 함께 줄인다).

## 2. URL 매칭

`matcher.findPage(manualFiles, url)` → `{ siteId, page } | null`

1. `site.origins`에 URL의 origin이 있는 매뉴얼 파일만 후보로 삼는다.
2. 각 `page.match`를 평가한다.
   - `exact`: 정규화된 pathname이 같다.
   - `glob`: `*`는 `/`를 제외한 한 세그먼트, `**`는 여러 세그먼트.
   - `regex`: pathname에 대한 정규식. 잘못된 정규식은 무시하고 콘솔 경고.
   - `match.query`(선택): 지정한 쿼리 키가 모두 같은 값이어야 한다. 값이 `"*"`면 키만 있으면 된다.
   - `match.hash`(선택): 해시 라우팅 SPA용. pathname 대신 해시 경로(`#/a/b` → `/a/b`)에 패턴을 적용한다.
3. 여러 개가 맞으면 종류 우선순위(exact 3, glob 2, regex 1) → 패턴 길이 → 쿼리 조건 수 순서로 고른다.

정규화: 끝의 `/` 제거(루트 제외), 소문자 비교는 하지 않는다(서버가 대소문자를 구분할 수 있다).

## 3. AI 캐시 키

`ai:{origin}{정규화 경로에서 숫자·UUID 세그먼트를 *로 바꾼 값}` — `/board/123`과 `/board/456`이 같은 캐시를 쓰게 한다. 캐시 항목에 `createdAt`을 두고 7일이 지나면 다시 생성한다. 사용자가 「다시 생성」을 누르면 무시하고 새로 만든다.

## 4. AI 생성 프롬프트 초안

시스템 프롬프트:
```
너는 업무용 웹 시스템의 사용자 매뉴얼 작가다. 주어진 페이지 구조(JSON)만 근거로,
처음 이 화면을 본 직원을 위한 매뉴얼을 한국어로 작성한다.
- 구조에 없는 버튼·기능은 쓰지 않는다. 업무 규칙을 지어내지 않는다.
- 조작 단계에는 화면 라벨을 「」로 인용한다.
- 아래 JSON 스키마의 객체 하나만 출력한다. 다른 텍스트를 출력하지 않는다.
{ "title", "role", "features":[{"name","description"}],
  "howTo":[{"task","steps":[],"targets":[]}], "tips":[] }
```
사용자 메시지: `PageStructure` JSON. `targets`에는 구조에 있던 `selector`만 쓰게 한다. 응답을 파싱한 뒤 `targets`에 구조에 없던 선택자가 있으면 제거한다.

## 5. 권한 기본안

| 권한 | 이유 |
| --- | --- |
| `sidePanel` | 사이드 패널 표시 |
| `tabs` | 탭 URL 읽기 |
| `webNavigation` | SPA history 변경 감지 |
| `storage` | 설정, 캐시, 탭 상태 |
| `scripting` | 필요 시 content 스크립트 주입 |
| `host_permissions`: 대상 사이트 origin들 + `https://api.anthropic.com/*` | 구조 추출, API 호출 |

모든 사이트 대상이 아니므로 `<all_urls>` 대신 `manuals/index.json`의 origin을 manifest에 나열한다. AI 폴백 대상 사이트를 늘리려면 `optional_host_permissions`와 `chrome.permissions.request`를 쓴다.
