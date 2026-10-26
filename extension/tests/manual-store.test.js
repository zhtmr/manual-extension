import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadManualDir, resolveAuthored } from '../src/background/manual-store.js';

const readJson = rel => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

// 경로 → JSON 사전으로 가짜 fetchJson을 만든다. 없는 경로는 throw.
const fakeFetch = files => async path => {
  if (!(path in files)) throw new Error(`없음: ${path}`);
  const v = files[path];
  if (v instanceof Error) throw v;
  return structuredClone(v);
};

// console.warn을 모아 본다.
async function captureWarn(fn) {
  const orig = console.warn;
  const msgs = [];
  console.warn = (...a) => msgs.push(a.join(' '));
  try { return { result: await fn(), msgs }; } finally { console.warn = orig; }
}

const page = (id, extra = {}) => ({
  id,
  match: { type: 'exact', pattern: `/${id}` },
  title: `${id} 화면`,
  role: '시험용 페이지 역할 설명입니다.',
  features: [{ name: '기능', description: '설명' }],
  howTo: [{ task: '작업', steps: ['단계'] }],
  updatedAt: '2026-10-23',
  source: 'authored',
  ...extra,
});
const siteFile = (id, pages, origins = ['https://gw.example.com']) => ({ schemaVersion: 1, site: { id, name: id, origins }, pages });

test('실제 manuals-dev 폴더: demo-local 8페이지가 그대로 로드된다', async () => {
  const fetchJson = fakeFetch({
    'manuals-dev/index.json': readJson('../manuals-dev/index.json'),
    'manuals-dev/demo-local.json': readJson('../manuals-dev/demo-local.json'),
  });
  const { result, msgs } = await captureWarn(() => loadManualDir('manuals-dev', fetchJson));
  assert.equal(result.length, 1);
  assert.equal(result[0].site.id, 'demo-local');
  assert.equal(result[0].pages.length, 8);
  assert.deepEqual(msgs, []);
});

test('실제 manuals 폴더(sites: [])는 빈 목록', async () => {
  const fetchJson = fakeFetch({ 'manuals/index.json': readJson('../manuals/index.json') });
  assert.deepEqual(await loadManualDir('manuals', fetchJson), []);
});

test('index가 없으면 빈 목록. optional이면 경고하지 않는다', async () => {
  const a = await captureWarn(() => loadManualDir('manuals', fakeFetch({})));
  assert.deepEqual(a.result, []);
  assert.equal(a.msgs.length, 1);
  const b = await captureWarn(() => loadManualDir('manuals-dev', fakeFetch({}), { optional: true }));
  assert.deepEqual(b.result, []);
  assert.deepEqual(b.msgs, []);
});

test('index 자체가 깨지면 폴더 전체를 건너뛴다', async () => {
  for (const index of [{ schemaVersion: 2, sites: [] }, { schemaVersion: 1 }, null, []]) {
    const { result, msgs } = await captureWarn(() => loadManualDir('m', fakeFetch({ 'm/index.json': index })));
    assert.deepEqual(result, [], JSON.stringify(index));
    assert.equal(msgs.length, 1);
  }
});

test('index 항목 오류·파일 없음·JSON 오류·사이트 수준 오류는 그 사이트만 건너뛴다', async () => {
  const files = {
    'm/index.json': {
      schemaVersion: 1,
      sites: [
        { siteId: 'ok', file: 'ok.json' },
        { siteId: 'bad-entry', file: '../x.json' },           // 경로 구분자
        { siteId: 'mismatch', file: 'other.json' },           // file ≠ siteId.json
        { siteId: 'missing', file: 'missing.json' },          // 파일 없음
        { siteId: 'broken', file: 'broken.json' },            // JSON 오류
        { siteId: 'idcheck', file: 'idcheck.json' },          // index siteId ≠ site.id(파일 이름과도 다름)
        { siteId: 'origins', file: 'origins.json' },          // origins 오류
        { siteId: 'version', file: 'version.json' },          // schemaVersion 오류
        { siteId: 'nopages', file: 'nopages.json' },          // pages 없음
      ],
    },
    'm/ok.json': siteFile('ok', [page('a')]),
    'm/broken.json': new SyntaxError('Unexpected token'),
    'm/idcheck.json': siteFile('someone-else', [page('a')]),
    'm/origins.json': siteFile('origins', [page('a')], ['https://gw.example.com/']),
    'm/version.json': { ...siteFile('version', [page('a')]), schemaVersion: 2 },
    'm/nopages.json': { schemaVersion: 1, site: { id: 'nopages', origins: ['https://x.example.com'] } },
  };
  const { result, msgs } = await captureWarn(() => loadManualDir('m', fakeFetch(files)));
  assert.deepEqual(result.map(f => f.site.id), ['ok']);
  assert.equal(msgs.length, 8);
});

test('페이지 오류는 그 페이지만 빼고, 중복 id는 뒤의 것을 빼고, related는 남은 id만', async () => {
  const pages = [
    page('a', { related: ['b', 'bad', 'dup', 'nowhere'] }),
    page('b'),
    page('bad', { title: '가'.repeat(61) }),
    page('dup'),
    page('dup', { title: '두 번째 dup' }),
    page('c', { source: 'ai' }), // 저장 매뉴얼의 ai는 검증기에서 경고일 뿐 허용
    null,
  ];
  const { result, msgs } = await captureWarn(() => loadManualDir('m', fakeFetch({
    'm/index.json': { schemaVersion: 1, sites: [{ siteId: 'gw', file: 'gw.json' }] },
    'm/gw.json': siteFile('gw', pages),
  })));
  assert.equal(result.length, 1);
  const got = result[0].pages;
  assert.deepEqual(got.map(p => p.id), ['a', 'b', 'dup', 'c']);
  assert.equal(got[2].title, 'dup 화면');
  assert.deepEqual(got[0].related, ['b', 'dup']);
  assert.equal(msgs.length, 3); // bad, 두 번째 dup, null
});

test('resolveAuthored: 매칭 페이지와 같은 사이트의 related 제목', () => {
  const files = [
    siteFile('gw', [page('a', { related: ['b', 'a', 'gone'] }), page('b')]),
    siteFile('other', [page('b', { title: '다른 사이트 b' })], ['https://other.example.com']),
  ];
  const r = resolveAuthored(files, 'https://gw.example.com/a');
  assert.equal(r.siteId, 'gw');
  assert.equal(r.page.id, 'a');
  assert.deepEqual(r.related, [{ id: 'b', title: 'b 화면' }]);
  assert.equal(resolveAuthored(files, 'https://gw.example.com/zzz'), null);
  assert.deepEqual(resolveAuthored(files, 'https://gw.example.com/b').related, []);
});

test('resolveAuthored: demo-local의 related', () => {
  const demo = readJson('../manuals-dev/demo-local.json');
  const r = resolveAuthored([demo], 'http://localhost:8787/spa/orders/new');
  assert.equal(r.page.id, 'spa-order-new');
  assert.deepEqual(r.related, [{ id: 'spa-orders', title: '주문 목록' }]);
});

test('shouldLoadDevManuals: 개발 원본 빌드이고 개발 설치일 때만 true(배포물은 설치 방식과 관계없이 false)', async () => {
  const { shouldLoadDevManuals } = await import('../src/background/manual-store.js');
  let asked = 0;
  const dev = async () => { asked++; return true; };
  const normal = async () => false;
  assert.equal(await shouldLoadDevManuals({ buildInfo: { includesDevManuals: true }, isDevInstall: dev }), true);
  assert.equal(await shouldLoadDevManuals({ buildInfo: { includesDevManuals: true }, isDevInstall: normal }), false);
  asked = 0;
  assert.equal(await shouldLoadDevManuals({ buildInfo: { includesDevManuals: false }, isDevInstall: dev }), false);
  assert.equal(asked, 0, '배포물은 설치 방식을 묻지도 않는다');
  assert.equal(await shouldLoadDevManuals({ buildInfo: null, isDevInstall: dev }), false);
});
