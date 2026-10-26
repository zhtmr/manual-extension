import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFixtureServer } from './fixtures/serve.mjs';

let server;
let base;

before(async () => {
  server = createFixtureServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(r => server.close(r)));

const get = async path => {
  const res = await fetch(base + path);
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
};

const PAGES = [
  ['/', '<title>업무 포털 홈</title>'],
  ['/notice/101', '<title>공지 상세</title>'],
  ['/notice/102', '<title>공지 상세</title>'],
  ['/nomanual', '<title>자료실</title>'],
  ['/spa', 'src="/spa.js"'],
  ['/spa/orders', 'src="/spa.js"'],
  ['/spa/orders/new', 'src="/spa.js"'],
  ['/spa/orders/1001', 'src="/spa.js"'],
  ['/spa/orders/', 'src="/spa.js"'],
  ['/hash', 'src="/hash.js"'],
];

for (const [path, marker] of PAGES) {
  test(`${path} → 200 HTML`, async () => {
    const r = await get(path);
    assert.equal(r.status, 200);
    assert.match(r.type, /^text\/html/);
    assert.ok(r.body.includes(marker), `${marker}가 없습니다`);
  });
}

for (const [path, type] of [['/fixture.css', /^text\/css/], ['/spa.js', /^text\/javascript/], ['/hash.js', /^text\/javascript/]]) {
  test(`${path} → 200 자산`, async () => {
    const r = await get(path);
    assert.equal(r.status, 200);
    assert.match(r.type, type);
  });
}

for (const path of ['/unknown', '/notice', '/notice/abc', '/spa.html', '/home.html', '/../serve.mjs', '/%2e%2e/serve.mjs', '/favicon.ico']) {
  test(`${path} → 404`, async () => {
    assert.equal((await get(path)).status, 404);
  });
}

test('fixture HTML에는 인라인 스크립트와 원격 리소스가 없다', () => {
  for (const f of ['home', 'notice', 'nomanual', 'spa', 'hash']) {
    const html = readFileSync(new URL(`./fixtures/site/${f}.html`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>\s*\S/, `${f}.html 인라인 스크립트`);
    assert.doesNotMatch(html, /(src|href)=["'](https?:)?\/\//, `${f}.html 원격 리소스`);
    // 브라우저의 자동 /favicon.ico 요청(404 콘솔 오류)을 막는다(QA r1 minor).
    assert.ok(html.includes('<link rel="icon" href="data:,">'), `${f}.html favicon 링크`);
  }
});

test('home.html에 개인정보 시험용 미끼가 모두 있다', () => {
  const html = readFileSync(new URL('./fixtures/site/home.html', import.meta.url), 'utf8');
  for (const s of ['value="SECRET-VALUE-1"', 'type="password"', '승인 비밀번호', 'type="hidden" value="SECRET-HIDDEN"', 'SECRET-OPTION', 'SECRET-CELL']) {
    assert.ok(html.includes(s), `${s}가 없습니다`);
  }
  const long = html.match(/<p id="longText">([^<]*)<\/p>/);
  assert.ok(long && long[1].length > 400, '400자 넘는 본문 문단이 없습니다');
});
