---
name: page-manual-orchestrator
description: "페이지 매뉴얼 크롬 확장 프로젝트의 작업을 조율한다. 확장 프로그램 개발(사이드 패널, 페이지 이동 감지, 매뉴얼 표시, AI 매뉴얼 생성, 옵션, 버그 수정, 기능 추가)과 대상 사이트 매뉴얼 작성(사이트 탐색, 페이지별 역할·기능·조작 방법 작성, 검토, extension/manuals 반영)을 요청받으면 사용한다. '확장 만들어줘', '익스텐션 개발', '매뉴얼 만들어줘', '○○ 사이트 매뉴얼 추가', '이 페이지 매뉴얼 다시', '매뉴얼 업데이트', 'QA 다시', '수정', '보완', '재실행', '이전 결과 개선' 같은 후속 요청에도 사용한다. 코드 한 줄 설명 같은 단순 질문에는 직접 답한다."
---

# 페이지 매뉴얼 확장 오케스트레이터

## 실행 모드: 혼합

| 트랙·단계 | 실행 모드 | 선택 이유 |
| --- | --- | --- |
| D1 설계 | 서브에이전트 위임 | 설계 문서 한 건을 한 번 받으면 된다. |
| D2 구현·검증 | 지속형 에이전트 협업 | 개발자와 QA가 같은 맥락을 유지하며 "지난번 지적한 그 부분"을 반복 수정한다. |
| M1 사이트 탐색·스냅샷 | 서브에이전트 위임(순차) | 브라우저가 하나라 병렬로 탐색할 수 없다. |
| M2 작성·검토 | 워크플로 조율 | 페이지 목록이 정해져 있고 검토 기준·수정 횟수를 코드로 정할 수 있다. |
| M3 병합·검증 | 리더 직접 수행 | 결정적인 파일 병합과 스크립트 실행이다. |

이 스킬을 불러오면 M2 단계의 Workflow 실행에 동의한 것으로 본다. 기본 규모는 페이지당 작성 1 + 검토 2(+수정 시 추가)다.

## 에이전트 구성

| 이름 | `subagent_type` | 모델 | 스킬 | 산출물 |
| --- | --- | --- | --- | --- |
| architect | `extension-architect` | opus | chrome-extension-dev | `_workspace/dev/01_architect_design.md` |
| dev | `extension-developer` | opus | chrome-extension-dev, claude-api | `extension/**`, `_workspace/dev/02_developer_changelog.md` |
| qa | `extension-qa` | opus | extension-qa | `_workspace/dev/03_qa_report_r{N}.md` |
| explorer | `page-explorer` | sonnet | page-manual-authoring | `_workspace/manual/00_explorer_sitemap.json`, `01_explorer_snapshots/` |
| (워크플로) | `manual-writer` | sonnet | page-manual-authoring | `_workspace/manual/02_writer_drafts/{pageId}.json` |
| (워크플로) | `manual-reviewer` | opus | page-manual-authoring | 워크플로 반환값 → `03_review_results.json` |

## 0단계: 요청 분류와 기존 작업 확인

1. 요청을 분류한다.
   - **개발 트랙(D)**: 확장 코드 신규 개발, 기능 추가, 버그 수정, QA 재실행
   - **매뉴얼 트랙(M)**: 새 사이트 매뉴얼, 페이지 추가, 특정 페이지 매뉴얼 수정
   - 둘 다면 D를 먼저 끝낸다. 단, 매뉴얼 스키마는 이미 정해져 있으므로 사용자가 원하면 M1(탐색)은 D와 동시에 시작해도 된다.
2. 기존 산출물을 확인한다.
   - `extension/`이 없으면 D1부터 처음 실행한다.
   - `extension/`이 있고 기능 추가·수정이면: 메시지 계약이나 구조가 바뀌면 D1(설계 갱신)부터, 아니면 D2부터 실행한다.
   - `_workspace/manual/`이 있고 같은 사이트 일부 페이지만 다시 하라는 요청이면 해당 `pageId`만 M2에 넣는다. 직전 실행의 `runId`가 `_workspace/manual/run_meta.json`에 있고 스냅샷이 바뀌지 않았으면 `resumeFromRunId`로 재개한다.
   - 다른 사이트를 새로 시작하면 기존 `_workspace/manual/`을 `_workspace/manual_{YYYYMMDD-HHmm}/`으로 옮긴다.
3. 판단한 경로를 사용자에게 한 줄로 알리고 진행한다.

## 개발 트랙

### D1. 설계 — **실행 모드: 서브에이전트 위임**

`Agent(subagent_type: "extension-architect", prompt: …)` 한 번 호출. 프롬프트에 사용자 요구사항, 확정 결정(하이브리드 매뉴얼, 사내/업무 시스템 대상, 사이드 패널), 기존 설계 문서 경로(있으면)를 넣는다.

완료 후 리더가 설계 문서의 `⑨ 미결정 사항`을 확인한다. 사용자 결정이 필요한 항목이 있으면 AskUserQuestion으로 묻고 답을 설계 문서에 반영하게 한다(`SendMessage` 불가한 단발 호출이므로 같은 유형을 다시 호출해 갱신). 그 뒤 설계 문서를 동결한다.
```
sha256sum _workspace/dev/01_architect_design.md > _workspace/dev/freeze_design.sha
```

### D2. 구현·검증 루프 — **실행 모드: 지속형 에이전트 협업**

1. 한 메시지에서 두 에이전트를 실행한다.
   - `Agent(name: "dev", subagent_type: "extension-developer", prompt: "설계 문서 _workspace/dev/01_architect_design.md의 구현 순서 1번 모듈부터 구현하라. 모듈마다 자체 테스트 후 리더에게 보고하라. 첫 보고에 사용 가능한 도구 목록을 포함하라.")`
   - `Agent(name: "qa", subagent_type: "extension-qa", prompt: "설계 문서를 읽고 검사 기준을 준비하라. 리더가 모듈 검사를 요청하면 extension-qa 스킬 절차로 검사하라. 첫 보고에 사용 가능한 도구 목록(브라우저 MCP 포함)을 포함하라.")`
2. 설계 문서의 구현 순서에 따라 `TaskCreate`로 모듈 작업을 등록한다. 모듈 작업마다 짝이 되는 QA 작업을 `depends_on`으로 연결한다.
3. 루프(모듈마다):
   1. dev가 모듈 완료를 보고하면 `SendMessage({to: "qa"}, "모듈 {이름} 검사. 바뀐 파일: …. 라운드 r{N}")`.
   2. qa 판정이 `fail`이면 `SendMessage({to: "dev"}, "_workspace/dev/03_qa_report_r{N}.md의 critical/major를 고쳐라")`. 다시 1로.
   3. critical·major가 0이면 다음 모듈로 넘어간다.
   4. 한 모듈에서 3라운드를 넘기면 멈추고 원인(설계 문제인지)을 사용자에게 보고한다. 설계 문제면 D1을 다시 호출한다.
4. 마지막 모듈 뒤 qa에 **전체 회귀 검사**(정적 검사 + 브라우저 시나리오 전체)를 요청한다.
5. 리더가 직접 확인: `node .claude/skills/extension-qa/scripts/validate_extension.mjs extension`, `node --test "extension/tests/**/*.test.js"`, `sha256sum -c _workspace/dev/freeze_design.sha`. 설계 해시가 다르면 누가 왜 바꿨는지 확인한다.
6. 사용자에게 설치 방법(`chrome://extensions` → 개발자 모드 → 압축 해제된 확장 프로그램 로드 → `extension/`)과 QA 결과, `blocked` 항목을 보고한다.

## 매뉴얼 트랙

### M1. 탐색 — **실행 모드: 서브에이전트 위임(순차)**

1. 사용자에게 받을 것: 대상 사이트 시작 URL, siteId(영문 소문자·하이픈), 사이트 이름. 사내 시스템이면 사용자가 Chrome에서 미리 로그인해 두도록 안내한다.
2. `Agent(subagent_type: "page-explorer", prompt: "1차: 사이트 맵 수집. 시작 URL …, siteId …")` → `00_explorer_sitemap.json`.
3. 사이트 맵을 사용자에게 보여주고 매뉴얼을 만들 페이지를 확정한다(전체가 30개를 넘으면 우선순위 높은 것부터 나누어 진행할지 묻는다). `00_pages.json`에 저장한다.
4. `Agent(subagent_type: "page-explorer", prompt: "2차: 00_pages.json의 페이지 스냅샷 수집")` → `01_explorer_snapshots/`.
5. 반환된 실패 목록을 확인한다. 로그인 필요면 사용자에게 로그인을 요청한 뒤 실패 페이지만 다시 호출한다.

### M2. 작성·검토 — **실행 모드: 워크플로 조율**

스냅샷이 있는 페이지만 `args.pages`에 넣는다.
```
Workflow(
  scriptPath: ".claude/skills/page-manual-orchestrator/scripts/manual-pipeline.js",
  args: { siteId, today: "YYYY-MM-DD", workspace: "_workspace/manual", maxRevisions: 2,
          pages: [{ pageId, url, snapshotPath: "_workspace/manual/01_explorer_snapshots/{pageId}.json" }] })
```
`scriptPath`가 거부되면 파일 내용을 읽어 `script`로 넘긴다. 반환된 `runId`를 `_workspace/manual/run_meta.json`에 기록하고, 완료 알림을 받으면 반환값을 `_workspace/manual/03_review_results.json`에 저장한다.

### M3. 병합·검증 — **리더 직접 수행**

1. `status: "approved"`인 초안만 `page-manual-authoring` 스킬 6절 절차로 `extension/manuals/{siteId}.json`에 병합한다.
2. `validate_manuals.mjs … --samples _workspace/manual/00_pages.json`을 실행한다. 매칭 오류는 해당 초안의 `match`를 고쳐 다시 검증한다(내용 수정이 아니므로 리더가 직접 고쳐도 된다).
3. 새 origin이 추가됐으면 개발 트랙의 dev에 `manifest.json` `host_permissions` 갱신을 맡기고 qa 정적 검사를 돌린다. dev가 없는 세션이면 `extension-developer`를 단발 호출한다.
4. 보고: 승인 n건, `needs_human` 목록과 남은 지적, 실패·누락 페이지.

## 데이터 전달 요약

| 경계 | 전달 방법 |
| --- | --- |
| D1 → D2 | 파일 `_workspace/dev/01_architect_design.md`(동결 해시) |
| dev ↔ qa | 리더 중계 `SendMessage` + `03_qa_report_r{N}.md` |
| M1 → M2 | `00_pages.json`, `01_explorer_snapshots/*.json` 경로를 `args.pages`로 |
| M2 → M3 | 워크플로 반환값 → `03_review_results.json`, 초안 파일 |
| M3 → D | origin 추가 시 manifest 갱신 요청 메시지 |

## 오류 처리

| 상황 | 대응 |
| --- | --- |
| 단발 에이전트 실패 | 한 번 다시 호출한다. 또 실패하면 누락을 보고서에 적고 진행한다. |
| dev/qa 무응답 | `SendMessage`로 상태를 묻고 다시 지시한다. 그래도 실패하면 같은 유형을 `dev2`/`qa2`로 실행하고 설계 문서·최신 보고서·changelog 경로를 넘긴다. |
| qa가 브라우저 도구 없음 | 정적 검사만 진행, 브라우저 시나리오를 `blocked`로 보고하고 사용자 수동 시험 절차를 안내한다. |
| 탐색 중 로그인 화면 | 탐색을 멈추고 사용자에게 로그인 요청. 자격 증명을 대신 입력하지 않는다. |
| 워크플로의 `agent()` 실패 | 스크립트가 `failed`/`missingPageIds`로 표시한다. 해당 페이지만 다시 넣어 재실행한다. |
| 사용량 한도·인증 만료·권한 거부 | 다시 시도하지 않는다. 부분 산출물을 열어 실제 진행 범위를 확인하고 `_workspace/` 아래 `incomplete.md`에 기록한 뒤 보고한다. 한도면 풀리는 시각도 알린다. 에이전트의 판단을 추측해 채우지 않는다. |
| 매뉴얼과 화면이 다르다는 사용자 제보 | 해당 페이지만 M1 2차(스냅샷) → M2 → M3로 다시 실행한다. |

## 테스트 시나리오

### 정상 흐름 (개발)
1. "사이드 패널로 매뉴얼 보여주는 확장 만들어줘" → `extension/` 없음 → D1 설계 → 미결정 사항 확인 → 동결.
2. D2: dev·qa 실행, 모듈 5~7개 등록. 모듈마다 r1 fail → r2 pass 정도로 진행.
3. 전체 회귀 검사 pass, 리더 검증 스크립트 오류 0건 → 설치 방법과 결과 보고.

### 정상 흐름 (매뉴얼)
1. "그룹웨어(https://gw.example.com) 매뉴얼 만들어줘" → M1 사이트 맵 24페이지 → 사용자가 10페이지 확정.
2. M2 워크플로: 승인 9, needs_human 1.
3. M3: groupware.json 병합, `--samples` 검증 오류 0 → manifest에 origin 추가 요청 → qa 정적 검사 pass → 보고.

### 오류 흐름
1. M1 2차 탐색 중 세션 만료로 3페이지가 "로그인 필요"로 실패.
2. 사용자에게 재로그인 요청 → 실패한 3페이지만 다시 탐색.
3. M2 중 리뷰어 1명이 null 반환 → 해당 라운드는 승인으로 치지 않고 수정·재검토 → 최대 회수 초과 시 `needs_human`으로 보고.
