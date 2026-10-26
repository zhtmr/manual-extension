export const meta = {
  name: 'page-manual-pipeline',
  description: '페이지 스냅샷마다 매뉴얼 초안을 쓰고, 두 관점 적대적 검토와 수정을 최대 2회 반복한다',
  phases: [
    { title: '작성', detail: '스냅샷마다 manual-writer가 초안을 쓴다' },
    { title: '검토', detail: '사실 정확성·사용성 두 관점으로 검토하고 필요하면 수정한다' },
  ],
}

// args: { siteId, workspace: '_workspace/manual', maxRevisions: 2,
//         pages: [{ pageId, url, snapshotPath }] }
const WS = args.workspace ?? '_workspace/manual'
const MAX_REV = args.maxRevisions ?? 2
const pages = args.pages ?? []
if (!pages.length) return { error: '처리할 페이지가 없습니다.', results: [] }

const WRITE = { type: 'object', required: ['status', 'draftPath'], properties: {
  status: { type: 'string', enum: ['written', 'no_snapshot'] },
  draftPath: { type: 'string' },
  note: { type: 'string' } } }

const REVIEW = { type: 'object', required: ['status', 'issues'], properties: {
  status: { type: 'string', enum: ['approve', 'revise'] },
  issues: { type: 'array', items: { type: 'object',
    required: ['field', 'problem', 'evidence', 'severity'], properties: {
      field: { type: 'string' }, problem: { type: 'string' }, evidence: { type: 'string' },
      severity: { type: 'string', enum: ['major', 'minor'] } } } } } }

const LENSES = [
  { key: 'fact', text: '관점 A: 사실 정확성 — 체크리스트의 관점 A 항목만 검사하라.' },
  { key: 'usability', text: '관점 B: 사용성 — 체크리스트의 관점 B 항목만 검사하라.' },
]

const draftPathOf = p => `${WS}/02_writer_drafts/${p.pageId}.json`

const writePrompt = p =>
  `page-manual-authoring 스킬을 따라 매뉴얼 페이지 항목 하나를 작성하라.\n` +
  `- 사이트: ${args.siteId}\n- pageId: ${p.pageId}\n- URL: ${p.url}\n` +
  `- 스냅샷: ${p.snapshotPath}\n- 출력 파일: ${draftPathOf(p)}\n` +
  `match는 스냅샷의 urlPattern을 쓰고, updatedAt은 '${args.today ?? ''}', source는 'authored'로 둔다.\n` +
  `파일을 쓴 뒤 { status, draftPath }를 반환하라.`

const reviewPrompt = (p, lens) =>
  `매뉴얼 초안을 적대적으로 검토하라. 초안이 틀렸다고 가정하고 스냅샷에서 반박 근거를 찾아라.\n` +
  `${lens.text}\n- 초안: ${draftPathOf(p)}\n- 스냅샷: ${p.snapshotPath}\n` +
  `체크리스트: .claude/skills/page-manual-authoring/references/review-checklist.md\n` +
  `major 문제가 1건 이상이면 revise, 아니면 approve로 판정하라.`

const revisePrompt = (p, issues) =>
  `검토 의견에 따라 매뉴얼 초안 ${draftPathOf(p)}을 고쳐라. 지적된 필드만 고치고 나머지는 유지한다.\n` +
  `스냅샷: ${p.snapshotPath}\n검토 의견:\n${JSON.stringify(issues, null, 2)}\n` +
  `고친 뒤 { status: 'written', draftPath }를 반환하라.`

const results = await pipeline(
  pages,
  p => agent(writePrompt(p), {
    label: `작성:${p.pageId}`, phase: '작성', agentType: 'manual-writer', schema: WRITE,
  }).then(w => ({ page: p, write: w })),
  async ({ page: p, write: w }) => {
    if (!w || w.status !== 'written') {
      return { pageId: p.pageId, status: 'failed', reason: w ? w.status : '작성 에이전트 실패' }
    }
    let lastIssues = []
    for (let round = 0; round <= MAX_REV; round++) {
      const verdicts = (await parallel(LENSES.map(lens => () =>
        agent(reviewPrompt(p, lens), {
          label: `검토:${p.pageId}:${lens.key}:r${round}`, phase: '검토',
          agentType: 'manual-reviewer', schema: REVIEW, effort: 'high',
        }).then(v => v && { lens: lens.key, ...v })))).filter(Boolean)

      // 검토자가 실패해 판정이 빠지면 승인으로 치지 않는다
      const approved = verdicts.length === LENSES.length && verdicts.every(v => v.status === 'approve')
      lastIssues = verdicts.flatMap(v => v.issues.map(i => ({ lens: v.lens, ...i })))
      if (approved) {
        return { pageId: p.pageId, status: 'approved', draftPath: draftPathOf(p), rounds: round, minorIssues: lastIssues }
      }
      if (round === MAX_REV) break
      // 지적 없이 미승인이면 검토자 실패다. 고칠 것이 없으므로 다시 검토만 한다
      if (!lastIssues.length) continue
      const majors = lastIssues.filter(i => i.severity === 'major')
      const fixed = await agent(revisePrompt(p, majors.length ? majors : lastIssues), {
        label: `수정:${p.pageId}:r${round + 1}`, phase: '검토', agentType: 'manual-writer', schema: WRITE,
      })
      if (!fixed) return { pageId: p.pageId, status: 'needs_human', reason: '수정 에이전트 실패', issues: lastIssues }
    }
    return { pageId: p.pageId, status: 'needs_human', reason: `수정 ${MAX_REV}회 후에도 미승인`, issues: lastIssues }
  },
)

const done = results.filter(Boolean)
const missing = pages.length - done.length
if (missing) log(`${missing}개 페이지는 결과 없이 끝났습니다(에이전트 실패).`)
const count = s => done.filter(r => r.status === s).length
log(`승인 ${count('approved')} / 사람 검토 필요 ${count('needs_human')} / 실패 ${count('failed')} / 누락 ${missing}`)
return {
  siteId: args.siteId,
  results: done,
  missingPageIds: pages.map(p => p.pageId).filter(id => !done.some(r => r.pageId === id)),
}
