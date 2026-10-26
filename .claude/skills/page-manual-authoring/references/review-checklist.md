# 매뉴얼 검토 체크리스트

판정 원칙: 사용자가 **잘못 조작하거나 오해할 수 있는** 문제만 `revise` 사유가 된다. 문체 취향은 `minor`로 적되 단독으로는 `revise` 사유가 아니다. `major`가 1건 이상이면 `revise`.

## 관점 A: 사실 정확성

| 확인 | 근거 위치 | 위반 시 |
| --- | --- | --- |
| 「」로 인용한 라벨이 모두 스냅샷의 buttons/fields/tabs/headings/links에 있다 | 스냅샷 | major |
| `features`의 각 기능을 수행할 요소가 스냅샷에 있다 | 스냅샷 | major |
| 스냅샷에 근거가 없는 업무 규칙(기한, 권한, 금액 기준 등)을 단정하지 않는다 | notices | major |
| `targets` 선택자가 스냅샷에 그대로 있다 | buttons/fields.selector | major |
| `mutating` 버튼을 누른 결과를 단정적으로 설명하지 않는다(누르지 않았으므로 결과를 모른다) | buttons.kind | major |
| `unexplored` 요소를 확인된 기능처럼 쓰지 않는다 | unexplored | major |
| `title`이 화면 제목과 맞다 | title/headings | minor |

## 관점 B: 사용성

| 확인 | 위반 시 |
| --- | --- |
| `role`만 읽고 이 화면에 온 목적이 맞는지 알 수 있다 | major |
| 화면의 주요 작업(표 제목, 주요 버튼으로 드러나는 일)이 `howTo`에 하나 이상 있다 | major |
| 각 단계가 한 동작이며, 단계 순서대로 하면 작업이 끝난다 | major |
| 단계에 "적절히", "필요한 항목" 같은 모호한 지시가 없다 | minor (핵심 단계면 major) |
| 탭이 여러 개인 화면이면 탭별 차이를 안내한다 | minor |
| 문장이 짧고 존댓말 평서문으로 통일됐다 | minor |

## 반환 형식

```json
{ "status": "revise",
  "issues": [ { "field": "howTo[0].steps[2]", "problem": "「일괄 승인」 버튼이 스냅샷에 없음",
                "evidence": "snapshot.buttons에 '승인'만 있고 '일괄 승인'은 unexplored", "severity": "major" } ] }
```
