---
name: page-manual-authoring
description: "대상 웹사이트의 페이지별 매뉴얼(역할, 주요 기능, 조작 방법)을 만드는 방법을 정한다. 페이지 구조 스냅샷 수집 형식, 매뉴얼 JSON 스키마, URL 패턴 작성법, 문체 규칙, 검토 기준, 스키마 검증 스크립트를 담는다. page-explorer, manual-writer, manual-reviewer가 사용하며 extension/manuals/*.json을 작성·수정·검증할 때 사용한다. 확장 코드 구현은 chrome-extension-dev를 쓴다."
---

# 페이지 매뉴얼 작성 방법

매뉴얼 한 건은 "이 화면이 무엇이고, 무엇을 할 수 있고, 어떻게 하는가"에 답한다. 확장 프로그램은 URL이 바뀔 때마다 이 JSON을 찾아 사이드 패널에 보여준다.

## 1. 흐름과 파일

```
[page-explorer] 사이트 맵 → 00_explorer_sitemap.json → (리더·사용자가 대상 확정) → 00_pages.json
               스냅샷   → 01_explorer_snapshots/{pageId}.json
[manual-writer]  초안   → 02_writer_drafts/{pageId}.json
[manual-reviewer] 판정  → 워크플로 반환값(03_review_results.json으로 저장)
[리더] 병합 → extension/manuals/{siteId}.json → validate_manuals.mjs
```
모든 중간 파일은 `_workspace/manual/` 아래에 둔다.

## 2. 스냅샷 수집 (page-explorer)

형식은 `references/snapshot-format.md`를 따른다. 핵심 규칙:
- 화면에 보이는 라벨을 그대로 적는다. 의역하지 않는다. 작성자가 라벨을 인용하기 때문이다.
- 입력값·개인 데이터는 적지 않는다.
- 상태를 바꾸는 버튼은 누르지 않는다. 팝업·모달은 여는 버튼이 "조회/열기" 성격일 때만 열어 본다.
- 버튼·필드마다 안정적인 CSS 선택자를 적는다. 우선순위: `#id` > `[name=…]` > `[data-*]` > `[aria-label=…]` > 짧은 클래스 경로. `nth-child`만으로 된 선택자는 화면이 조금만 바뀌어도 깨지므로 피한다.

## 3. URL 패턴 정하기

- 고정 경로는 `exact`.
- 숫자 ID·UUID·날짜 세그먼트가 있으면 `glob`으로 `*` 치환. 예: `/board/123/view` → `/board/*/view`.
- 같은 경로가 쿼리로 화면이 갈리면(예: `?menu=approval`) `match.query`를 쓴다.
- 해시 라우팅(`/#/orders/list`)이면 `match.hash`에 경로를 쓴다.
- `regex`는 위로 표현할 수 없을 때만 쓴다.
- 서로 다른 화면 두 개가 같은 URL을 공유하면(탭 전환만 하는 화면 등) 한 매뉴얼에 합치고 `howTo`에서 탭별로 나눈다.

## 4. 작성 규칙 (manual-writer)

스키마는 `references/manual-schema.md`. 필드별 기준:

| 필드 | 기준 |
| --- | --- |
| `title` | 화면 제목(스냅샷 `title` 또는 h1). 메뉴 경로와 다르면 화면 제목을 쓴다. |
| `role` | 1~2문장. "누가, 언제, 무엇을 하려고 오는 화면인가". 예: "제출된 결재 문서를 확인하고 승인·반려하는 화면입니다." |
| `features` | 3~7개. 화면에서 실제로 할 수 있는 일 단위. 버튼 나열이 아니라 기능 단위로 묶는다. |
| `howTo` | 사용자가 가장 자주 할 작업 2~5개. 단계는 한 단계에 한 동작, 화면 라벨을 「」로 인용, 3~7단계. |
| `tips` | 실수하기 쉬운 점, 화면의 안내 문구에서 확인되는 제약. 근거가 없으면 비운다. |
| `related` | 이 화면에서 이어서 가는 페이지의 `id`. 같은 사이트 매뉴얼에 있는 것만. |

문체: 존댓말 평서문(~합니다, ~하세요), 짧은 문장. 전문 용어는 화면 라벨을 따른다.

## 5. 검토 (manual-reviewer)

`references/review-checklist.md`를 따른다. 워크플로에서 두 관점으로 나눠 검토한다.
- **사실 정확성**: 모든 라벨·버튼·필드가 스냅샷에 있는가, 지어낸 업무 규칙은 없는가, `targets` 선택자가 스냅샷에 있는가.
- **사용성**: 처음 온 직원이 `howTo`만 보고 따라 할 수 있는가, 주요 기능이 빠지지 않았는가, `role`이 화면 목적을 맞게 설명하는가.

두 관점 모두 `approve`해야 통과한다. 수정은 최대 2회, 그래도 통과하지 못하면 `needs_human`으로 사람 검토 목록에 올린다.

## 6. 병합과 검증 (리더)

1. 승인된 초안을 `extension/manuals/{siteId}.json`의 `pages[]`에 넣는다. 같은 `id`가 있으면 교체한다. `updatedAt`은 오늘 날짜, `source`는 `"authored"`.
2. `extension/manuals/index.json`에 사이트가 없으면 추가한다.
3. 검증을 실행한다.
   ```
   node .claude/skills/page-manual-authoring/scripts/validate_manuals.mjs extension/manuals --samples _workspace/manual/00_pages.json
   ```
   `--samples`를 주면 각 페이지 URL이 정확히 의도한 매뉴얼 하나에 매칭되는지도 확인한다. 오류가 0건이어야 끝낸다.
4. 새 origin이 생겼으면 `extension/manifest.json`의 `host_permissions`도 갱신해야 하므로 리더가 개발 트랙에 알린다.

## 참고 문서

- `references/manual-schema.md` — 매뉴얼 JSON 스키마(단일 기준). 작성·병합·확장 코드 구현 시 읽는다.
- `references/snapshot-format.md` — 스냅샷 형식. 탐색 시 읽는다.
- `references/review-checklist.md` — 검토 체크리스트. 검토 시 읽는다.
- `scripts/validate_manuals.mjs` — 스키마·참조·매칭 검증. `--page <초안.json>`으로 초안 한 건만 검사할 수도 있다.
