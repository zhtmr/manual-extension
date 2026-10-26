# 매뉴얼 JSON 스키마 (schemaVersion 1)

이 문서가 매뉴얼 데이터의 단일 기준이다. 확장 코드(`src/shared/manual-schema.js`)와 `scripts/validate_manuals.mjs`가 같은 규칙을 구현한다. 바꾸면 세 곳을 함께 고친다.

## 사이트 파일: `extension/manuals/{siteId}.json`

```json
{
  "schemaVersion": 1,
  "site": {
    "id": "groupware",
    "name": "사내 그룹웨어",
    "origins": ["https://gw.example.com"]
  },
  "pages": [ /* Page */ ]
}
```

## Page

```json
{
  "id": "approval-inbox",
  "match": { "type": "glob", "pattern": "/approval/inbox", "query": { "tab": "*" }, "hash": false },
  "title": "결재함",
  "role": "나에게 도착한 결재 문서를 확인하고 승인하거나 반려하는 화면입니다.",
  "features": [
    { "name": "결재 문서 검색", "description": "기간과 문서 종류로 결재 대기 문서를 찾습니다." }
  ],
  "howTo": [
    {
      "task": "결재 문서 승인하기",
      "steps": ["목록에서 문서 제목을 누릅니다.", "내용을 확인한 뒤 「승인」 버튼을 누릅니다."],
      "targets": ["#btnApprove"]
    }
  ],
  "tips": ["반려할 때는 「의견」 칸에 사유를 적어야 합니다."],
  "related": ["approval-sent"],
  "updatedAt": "2026-10-23",
  "source": "authored"
}
```

## 필드 규칙

| 필드 | 타입 | 필수 | 규칙 |
| --- | --- | --- | --- |
| `schemaVersion` | number | ✓ | `1` |
| `site.id` | string | ✓ | `^[a-z0-9-]+$`, 파일 이름과 같다 |
| `site.origins` | string[] | ✓ | 1개 이상, `https?://host[:port]` 형식, 끝에 `/` 없음 |
| `pages[].id` | string | ✓ | `^[a-z0-9-]+$`, 파일 안에서 유일 |
| `match.type` | `"exact"`\|`"glob"`\|`"regex"` | ✓ | |
| `match.pattern` | string | ✓ | `/`로 시작(regex 제외), regex는 유효해야 함 |
| `match.query` | object | | 값은 문자열, `"*"`는 키 존재만 확인 |
| `match.hash` | boolean | | true면 해시 경로에 패턴 적용 |
| `title` | string | ✓ | 1~60자 |
| `role` | string | ✓ | 10~300자 |
| `features` | {name, description}[] | ✓ | 1~10개 |
| `howTo` | {task, steps[], targets?[]}[] | ✓ | 1~8개, steps 1~12개 |
| `tips` | string[] | | 0~8개 |
| `related` | string[] | | 같은 파일의 `pages[].id`만 |
| `updatedAt` | string | ✓ | `YYYY-MM-DD` |
| `source` | `"authored"`\|`"ai"` | ✓ | 파일에 저장된 것은 `authored` |

## index.json

```json
{ "schemaVersion": 1, "sites": [ { "siteId": "groupware", "file": "groupware.json" } ] }
```

`file`은 `manuals/` 바로 아래 파일 이름만 쓴다. `/`, `\`, `..`가 들어가면 확장이 그 사이트를 불러오지 않는다(런타임 fetch 경로 보호).

## AI 생성 결과

AI 폴백이 만든 매뉴얼도 Page 형태를 따르되 `id`, `match`, `related`, `updatedAt`은 확장 코드가 채운다(`id`는 캐시 키, `source`는 `"ai"`). 따라서 AI 응답 검증은 `title`, `role`, `features`, `howTo`, `tips` 규칙만 적용한다.
