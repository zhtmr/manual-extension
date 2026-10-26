# 페이지 구조 스냅샷 형식

파일: `_workspace/manual/01_explorer_snapshots/{pageId}.json`

```json
{
  "pageId": "approval-inbox",
  "url": "https://gw.example.com/approval/inbox?tab=wait",
  "urlPattern": { "type": "glob", "pattern": "/approval/inbox", "query": { "tab": "*" } },
  "menuPath": ["전자결재", "결재함"],
  "title": "결재함",
  "headings": [{ "level": 1, "text": "결재함" }, { "level": 2, "text": "결재 대기 문서" }],
  "tabs": ["결재 대기", "결재 완료", "반려"],
  "buttons": [
    { "text": "검색", "selector": "#btnSearch", "kind": "query" },
    { "text": "승인", "selector": "#btnApprove", "kind": "mutating" }
  ],
  "fields": [
    { "label": "기간", "type": "date-range", "placeholder": "", "selector": "[name=period]", "required": false }
  ],
  "tables": [{ "caption": "결재 대기 문서", "headers": ["문서번호", "제목", "기안자", "기안일"] }],
  "notices": ["반려 시 의견 입력은 필수입니다."],
  "links": [{ "text": "보낸 결재", "href": "/approval/sent" }],
  "modals": [{ "openedBy": "상세 검색", "fields": ["문서 종류", "기안 부서"] }],
  "unexplored": [{ "element": "일괄 승인", "reason": "상태 변경 버튼" }],
  "capturedAt": "2026-10-23",
  "screenshot": "approval-inbox.png"
}
```

## 규칙

- `buttons[].kind`: `query`(조회·검색·열기), `mutating`(저장·제출·삭제·승인 등 상태 변경), `navigation`. `mutating`은 **누르지 않고** 기록만 한다.
- `fields`에는 값을 쓰지 않는다. `password`·`hidden` 필드는 생략한다.
- `tables`에는 머리글만, 본문 셀은 쓰지 않는다.
- `notices`: 화면에 고정으로 표시된 안내·경고 문구. 개인 데이터가 섞인 문구는 생략한다.
- 각 배열은 화면에 보이는 순서(위→아래, 왼쪽→오른쪽)를 따른다.
- 확인하지 못한 영역은 `unexplored`에 이유와 함께 남긴다. 빠뜨린 것을 감추면 작성자가 "없는 기능"으로 오해한다.

## 사이트 맵 형식

파일: `_workspace/manual/00_explorer_sitemap.json`

```json
{ "siteId": "groupware", "startUrl": "https://gw.example.com/",
  "pages": [ { "pageId": "approval-inbox", "url": "...", "urlPattern": {...}, "menuPath": ["전자결재","결재함"], "note": "" } ] }
```

리더가 사용자와 대상 페이지를 확정하면 같은 형식으로 `00_pages.json`에 저장한다.
