import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePage, validateSiteFile, validateIndex } from '../src/shared/manual-schema.js';

const readJson = rel => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

const good = () => ({
  id: 'approval-inbox',
  match: { type: 'glob', pattern: '/approval/inbox', query: { tab: '*' }, hash: false },
  title: '결재함',
  role: '나에게 도착한 결재 문서를 확인하고 승인하거나 반려하는 화면입니다.',
  features: [{ name: '결재 문서 검색', description: '기간과 문서 종류로 결재 대기 문서를 찾습니다.' }],
  howTo: [{ task: '결재 문서 승인하기', steps: ['목록에서 문서 제목을 누릅니다.'], targets: ['#btnApprove'] }],
  tips: ['반려할 때는 사유를 적습니다.'],
  related: [],
  updatedAt: '2026-10-23',
  source: 'authored',
});
const site = pages => ({ schemaVersion: 1, site: { id: 'gw', name: '그룹웨어', origins: ['https://gw.example.com'] }, pages });
const n = (count, make) => Array.from({ length: count }, (_, i) => make(i));
const has = (errors, re) => errors.some(e => re.test(e));

test('정상 페이지는 오류 0건', () => {
  assert.deepEqual(validatePage(good()), []);
  const minimal = good();
  delete minimal.tips; delete minimal.related; delete minimal.match.query; delete minimal.match.hash;
  delete minimal.howTo[0].targets;
  assert.deepEqual(validatePage(minimal), []);
});

test('경계값: title 60자, role 10자/300자, features 10개, howTo 8개, steps 12개, tips 8개는 통과', () => {
  const p = good();
  p.title = '가'.repeat(60);
  p.role = '가'.repeat(10);
  p.features = n(10, i => ({ name: `f${i}`, description: 'd' }));
  p.howTo = n(8, i => ({ task: `t${i}`, steps: n(12, j => `s${j}`) }));
  p.tips = n(8, i => `tip${i}`);
  assert.deepEqual(validatePage(p), []);
  p.role = '가'.repeat(300);
  assert.deepEqual(validatePage(p), []);
});

const CASES = [
  ['title 61자', p => { p.title = '가'.repeat(61); }, /title/],
  ['title 빈 문자열', p => { p.title = '  '; }, /title/],
  ['role 9자', p => { p.role = '가'.repeat(9); }, /role/],
  ['role 301자', p => { p.role = '가'.repeat(301); }, /role/],
  ['features 0개', p => { p.features = []; }, /features/],
  ['features 11개', p => { p.features = n(11, i => ({ name: `f${i}`, description: 'd' })); }, /features/],
  ['features 항목에 description 없음', p => { p.features = [{ name: 'x' }]; }, /features\[0\]/],
  ['howTo 0개', p => { p.howTo = []; }, /howTo/],
  ['howTo 9개', p => { p.howTo = n(9, i => ({ task: `t${i}`, steps: ['s'] })); }, /howTo/],
  ['steps 13개', p => { p.howTo = [{ task: 't', steps: n(13, i => `s${i}`) }]; }, /steps/],
  ['steps 0개', p => { p.howTo = [{ task: 't', steps: [] }]; }, /steps/],
  ['task 없음', p => { p.howTo = [{ steps: ['s'] }]; }, /task/],
  ['targets가 문자열', p => { p.howTo[0].targets = '#a'; }, /targets/],
  ['tips 9개', p => { p.tips = n(9, i => `t${i}`); }, /tips/],
  ['tips에 숫자', p => { p.tips = [1]; }, /tips/],
  ['잘못된 date 형식(슬래시)', p => { p.updatedAt = '2026/10/23'; }, /updatedAt/],
  ['잘못된 date 형식(한 자리)', p => { p.updatedAt = '2026-10-2'; }, /updatedAt/],
  ['date 없음', p => { delete p.updatedAt; }, /updatedAt/],
  ['source 오류', p => { p.source = 'manual'; }, /source/],
  ['id 형식 오류', p => { p.id = 'Approval_Inbox'; }, /id/],
  ['match 없음', p => { delete p.match; }, /match/],
  ['match.type 오류', p => { p.match.type = 'prefix'; }, /match\.type/],
  ['pattern이 /로 시작하지 않음', p => { p.match.pattern = 'approval'; }, /\/로 시작/],
  ['잘못된 regex', p => { p.match = { type: 'regex', pattern: '([' }; }, /정규식/],
  ['query 값이 숫자', p => { p.match.query = { tab: 1 }; }, /query\.tab/],
  ['query가 배열', p => { p.match.query = ['tab']; }, /query/],
  ['hash가 문자열', p => { p.match.hash = 'true'; }, /hash/],
  ['related가 배열이 아님', p => { p.related = 'x'; }, /related/],
];

for (const [name, mutate, re] of CASES) {
  test(`위반 검출: ${name}`, () => {
    const p = good();
    mutate(p);
    const errors = validatePage(p);
    assert.ok(has(errors, re), `${re} 오류가 없습니다: ${JSON.stringify(errors)}`);
  });
}

test('regex 패턴은 /로 시작하지 않아도 된다', () => {
  const p = good();
  p.match = { type: 'regex', pattern: '^/item/\\d+$' };
  assert.deepEqual(validatePage(p), []);
});

test('페이지가 객체가 아니면 오류', () => {
  for (const v of [null, undefined, 'x', 1, []]) assert.equal(validatePage(v).length, 1);
});

test('full: false는 내용 필드만 검사한다(AI 생성 결과)', () => {
  const ai = { title: 'AI 제목', role: '구조만 보고 만든 화면 설명입니다.', features: [{ name: 'a', description: 'b' }],
    howTo: [{ task: 't', steps: ['s'], targets: ['#x'] }], tips: [] };
  assert.deepEqual(validatePage(ai, { full: false }), []);
  assert.ok(validatePage(ai).length >= 3, 'full이면 id/match/updatedAt/source 오류');
  const bad = { ...ai, title: '가'.repeat(61), id: 'BAD ID', source: 'x' };
  const errors = validatePage(bad, { full: false });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /title/);
  assert.ok(has(validatePage({ ...ai, howTo: [] }, { full: false }), /howTo/));
});

test('사이트 파일: 정상이면 오류 0건, 파일 이름 확인', () => {
  const f = site([good()]);
  assert.deepEqual(validateSiteFile(f), []);
  assert.deepEqual(validateSiteFile(f, 'gw.json'), []);
  assert.deepEqual(validateSiteFile(f, 'manuals/gw.json'), []);
  assert.ok(has(validateSiteFile(f, 'groupware.json'), /파일 이름/));
});

test('사이트 파일: 중복 id, 없는 related, 페이지 오류 위치 표시', () => {
  const a = good();
  const b = { ...good(), related: ['approval-inbox', 'missing-page'] };
  const c = { ...good(), id: 'other', title: '' };
  const errors = validateSiteFile(site([a, b, c]));
  assert.ok(has(errors, /^pages\[1\]\(approval-inbox\): id가 중복됩니다/), JSON.stringify(errors));
  assert.ok(has(errors, /related의 'missing-page'가 이 파일에 없습니다/));
  assert.ok(!has(errors, /related의 'approval-inbox'/));
  assert.ok(has(errors, /^pages\[2\]\(other\): title/));
});

test('사이트 파일: schemaVersion, site.id, origins 규칙', () => {
  const f = site([good()]);
  assert.ok(has(validateSiteFile({ ...f, schemaVersion: 2 }), /schemaVersion/));
  assert.ok(has(validateSiteFile({ ...f, site: { ...f.site, id: 'GW' } }), /site\.id/));
  for (const origins of [[], ['https://gw.example.com/'], ['gw.example.com'], ['https://gw.example.com/path'], 'https://gw.example.com']) {
    assert.ok(has(validateSiteFile({ ...f, site: { ...f.site, origins } }), /origins/), JSON.stringify(origins));
  }
  assert.deepEqual(validateSiteFile({ ...f, site: { ...f.site, origins: ['http://localhost:8787', 'https://a.b'] } }), []);
  assert.ok(has(validateSiteFile({ ...f, pages: {} }), /pages/));
  assert.equal(validateSiteFile(null).length, 1);
});

test('index: 규칙', () => {
  assert.deepEqual(validateIndex({ schemaVersion: 1, sites: [] }), []);
  assert.deepEqual(validateIndex({ schemaVersion: 1, sites: [{ siteId: 'gw', file: 'gw.json' }] }), []);
  assert.ok(has(validateIndex({ schemaVersion: 2, sites: [] }), /schemaVersion/));
  assert.ok(has(validateIndex({ schemaVersion: 1 }), /sites/));
  assert.ok(has(validateIndex({ schemaVersion: 1, sites: [{ siteId: 'gw', file: 'other.json' }] }), /siteId와 다릅니다/));
  assert.ok(has(validateIndex({ schemaVersion: 1, sites: [{ siteId: 'gw', file: '../gw.json' }] }), /file/));
  assert.ok(has(validateIndex({ schemaVersion: 1, sites: [{ siteId: 'G W', file: 'gw.json' }] }), /siteId/));
  assert.equal(validateIndex(null).length, 1);
});

test('실제 파일: manuals/index.json, manuals-dev/index.json, demo-local.json은 오류 0건', () => {
  assert.deepEqual(validateIndex(readJson('../manuals/index.json')), []);
  assert.deepEqual(validateIndex(readJson('../manuals-dev/index.json')), []);
  assert.deepEqual(validateSiteFile(readJson('../manuals-dev/demo-local.json'), 'demo-local.json'), []);
});
