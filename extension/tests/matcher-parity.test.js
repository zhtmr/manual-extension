// matcher.findPage와 validate_manuals.mjs(--samples)의 매칭 결과가 같은지 대조한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findPage } from '../src/shared/matcher.js';

const here = p => fileURLToPath(new URL(p, import.meta.url));
const VALIDATOR = here('../../.claude/skills/page-manual-authoring/scripts/validate_manuals.mjs');
const DEMO_DIR = here('../manuals-dev');
const SAMPLES = here('./fixtures/demo-pages.json');

const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const loadSites = dir => readJson(join(dir, 'index.json')).sites.map(s => readJson(join(dir, s.file)));

function runValidator(manualsDir, samplesPath) {
  const r = spawnSync(process.execPath, [VALIDATOR, manualsDir, '--samples', samplesPath], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

// 임시 폴더에 samples 파일을 쓰고 검증기를 돌린다.
function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-parity-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const demoSites = loadSites(DEMO_DIR);
const samples = readJson(SAMPLES);

test('demo-pages.json의 각 URL이 기대한 pageId로 매칭된다(matcher)', () => {
  assert.ok(samples.pages.length >= 9);
  for (const s of samples.pages) {
    const hit = findPage(demoSites, s.url);
    assert.equal(hit?.page.id ?? null, s.pageId, s.url);
    assert.equal(hit.siteId, 'demo-local');
  }
});

test('noManual URL은 matcher가 null을 돌려준다', () => {
  assert.deepEqual(samples.noManual, [
    'http://localhost:8787/nomanual',
    'http://localhost:8787/hash#/unknown',
    'http://localhost:8787/hash',
  ]);
  for (const url of samples.noManual) assert.equal(findPage(demoSites, url), null, url);
});

test('같은 samples로 validate_manuals.mjs --samples가 종료 코드 0, 동률 경고 0', () => {
  const r = runValidator(DEMO_DIR, SAMPLES);
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /같은 우선순위/);
});

test('noManual URL은 검증기에서도 "맞는 매뉴얼이 없습니다"', () => {
  withTemp(dir => {
    const p = join(dir, 'samples.json');
    writeFileSync(p, JSON.stringify({ pages: samples.noManual.map(url => ({ pageId: '__none__', url })) }));
    const r = runValidator(DEMO_DIR, p);
    assert.equal(r.status, 1);
    for (const url of samples.noManual) assert.ok(r.out.includes(`${url}에 맞는 매뉴얼이 없습니다`), `${url}\n${r.out}`);
    assert.doesNotMatch(r.out, /다른 매뉴얼/);
  });
});

// matcher 결과를 기대값으로 삼아 검증기와 대조한다. null은 "맞는 매뉴얼 없음" 오류로 확인한다.
function assertParity(manualsDir, sites, urls) {
  const expected = urls.map(url => ({ url, id: findPage(sites, url)?.page.id ?? null }));
  withTemp(dir => {
    const hits = expected.filter(e => e.id);
    const misses = expected.filter(e => !e.id);
    if (hits.length) {
      const p = join(dir, 'hits.json');
      writeFileSync(p, JSON.stringify({ pages: hits.map(e => ({ pageId: e.id, url: e.url })) }));
      const r = runValidator(manualsDir, p);
      assert.equal(r.status, 0, `matcher와 검증기 결과가 다릅니다\n${JSON.stringify(hits, null, 1)}\n${r.out}`);
    }
    if (misses.length) {
      const p = join(dir, 'misses.json');
      writeFileSync(p, JSON.stringify({ pages: misses.map(e => ({ pageId: '__none__', url: e.url })) }));
      const r = runValidator(manualsDir, p);
      for (const e of misses) assert.ok(r.out.includes(`${e.url}에 맞는 매뉴얼이 없습니다`), `검증기는 ${e.url}을 매칭합니다\n${r.out}`);
    }
  });
  return expected;
}

test('demo 매뉴얼: 경계 URL에서도 matcher와 검증기가 같다', () => {
  const urls = [
    'http://localhost:8787/spa/orders/',
    'http://localhost:8787/spa/',
    'http://localhost:8787/notice/101/',
    'http://localhost:8787/notice/101#guide',
    'http://localhost:8787/?q=1',
    'http://localhost:8787/#guide',
    'http://localhost:8787/hash#/inbox/',
    'http://localhost:8787/hash#/settings?x=1',
    'http://localhost:8787/hash#!/inbox',
    'http://localhost:8787/notice/101#/inbox',
    'http://localhost:8787/spa/orders/1001/items',
    'http://localhost:8787/notice',
    'http://127.0.0.1:8787/',
    'https://localhost:8787/',
  ];
  const r = assertParity(DEMO_DIR, demoSites, urls);
  const got = Object.fromEntries(r.map(e => [e.url, e.id]));
  assert.equal(got['http://localhost:8787/notice/101#/inbox'], 'hash-inbox', 'hash 페이지는 pathname을 보지 않는다(⑤-5)');
  assert.equal(got['http://localhost:8787/hash#!/inbox'], null, '해시뱅은 매칭하지 않는다(⑤-2)');
});

test('합성 매뉴얼(regex, query, **, 잘못된 regex 없음)에서 matcher와 검증기가 같다', () => {
  withTemp(dir => {
    const base = { title: '시험 페이지', role: '대조 시험용 페이지 설명입니다.', features: [{ name: '기능', description: '설명' }],
      howTo: [{ task: '작업', steps: ['단계'] }], updatedAt: '2026-10-23', source: 'authored' };
    const pages = [
      { id: 'root', match: { type: 'exact', pattern: '/' } },
      { id: 'list', match: { type: 'exact', pattern: '/list' } },
      { id: 'list-done', match: { type: 'exact', pattern: '/list', query: { tab: 'done' } } },
      { id: 'list-any', match: { type: 'exact', pattern: '/list', query: { tab: '*' } } },
      { id: 'list-two', match: { type: 'exact', pattern: '/list', query: { tab: '*', page: '*' } } },
      { id: 'board-one', match: { type: 'glob', pattern: '/board/*' } },
      { id: 'board-deep', match: { type: 'glob', pattern: '/board/**' } },
      { id: 'board-edit', match: { type: 'glob', pattern: '/board/*/edit' } },
      { id: 'item-rx', match: { type: 'regex', pattern: '^/item/\\d+$' } },
      { id: 'any-rx', match: { type: 'regex', pattern: '^/item/' } },
      { id: 'board-rx', match: { type: 'regex', pattern: '^/board/' } },
      { id: 'zone-rx', match: { type: 'regex', pattern: '^/zone/[a-z]+/.*$' } },
      { id: 'zone-glob', match: { type: 'glob', pattern: '/zone/**' } },
      { id: 'h-mail', match: { type: 'glob', pattern: '/mail/*', hash: true } },
      { id: 'dot', match: { type: 'glob', pattern: '/a.do' } },
    ].map(p => ({ ...base, ...p }));
    const file = { schemaVersion: 1, site: { id: 'syn', name: '합성', origins: ['https://syn.example.com', 'http://syn.local:9000'] }, pages };
    writeFileSync(join(dir, 'index.json'), JSON.stringify({ schemaVersion: 1, sites: [{ siteId: 'syn', file: 'syn.json' }] }));
    writeFileSync(join(dir, 'syn.json'), JSON.stringify(file));
    const O = 'https://syn.example.com';
    const urls = [
      `${O}/`, `${O}/list`, `${O}/list?tab=done`, `${O}/list?tab=todo`, `${O}/list?tab=done&page=2`, `${O}/list?page=2`,
      `${O}/board/1`, `${O}/board/1/edit`, `${O}/board/1/2/3`, `${O}/board/1/2/x`, `${O}/board`, `${O}/board/`,
      `${O}/zone/abc/1`, `${O}/zone/1`,
      `${O}/item/12`, `${O}/item/x`, `${O}/item/12/`, `${O}/x#/mail/5`, `${O}/x#/mail`, `${O}/a.do`, `${O}/aXdo`,
      'http://syn.local:9000/list', 'http://syn.local/list', 'https://other.example.com/',
    ];
    const r = assertParity(dir, [file], urls);
    const got = Object.fromEntries(r.map(e => [e.url, e.id]));
    assert.equal(got[`${O}/list?tab=done`], 'list-done');
    assert.equal(got[`${O}/list?tab=done&page=2`], 'list-two');
    assert.equal(got[`${O}/board/1/edit`], 'board-edit');
    assert.equal(got[`${O}/item/12`], 'item-rx');
    assert.equal(got[`${O}/aXdo`], null);
    // glob과 regex가 같은 URL에 함께 맞을 때 glob이 이긴다(종류 우선순위를 검증기와 대조).
    // /board/1: board-one(glob), board-deep(glob, 더 긴 패턴), board-rx(regex)가 함께 맞는다.
    assert.equal(got[`${O}/board/1`], 'board-deep');
    assert.equal(got[`${O}/board/1/2/x`], 'board-deep');
    // regex 패턴이 더 길어도 종류 우선순위가 먼저다.
    assert.equal(got[`${O}/zone/abc/1`], 'zone-glob');
    assert.equal(got[`${O}/zone/1`], 'zone-glob');
  });
});
