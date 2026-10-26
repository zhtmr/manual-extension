// page-agent.js를 실제 Chromium(Playwright)에서 fixture 페이지에 주입해 구조 추출과 하이라이트를 확인한다.
// 프로젝트는 외부 패키지를 두지 않으므로 Playwright는 설치된 곳에서 찾는다:
//   1) 환경 변수 PLAYWRIGHT_MODULE(playwright 패키지 폴더 경로)  2) 로컬 import('playwright')  3) 전역 npm 루트 아래
// 찾지 못하거나 브라우저를 띄우지 못하면 테스트를 건너뛴다(skip 사유 출력).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createFixtureServer } from './fixtures/serve.mjs';
import { aiCacheKey } from '../src/shared/matcher.js';

const AGENT_SRC = readFileSync(new URL('../src/content/page-agent.js', import.meta.url), 'utf8');

async function loadPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(process.env.PLAYWRIGHT_MODULE);
  try { return await import('playwright'); } catch { /* 로컬에 없음 */ }
  const r = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true });
  const root = r.stdout?.trim();
  if (root) {
    candidates.push(join(root, 'playwright'), join(root, '@playwright', 'test'),
      join(root, '@executeautomation', 'playwright-mcp-server', 'node_modules', 'playwright'));
  }
  for (const dir of candidates) {
    if (!existsSync(join(dir, 'package.json'))) continue;
    try { return createRequire(join(dir, 'package.json'))(dir); } catch { /* 다음 후보 */ }
  }
  return null;
}

let browser = null;
let server = null;
let base = '';
let skipReason = '';

before(async () => {
  const pw = await loadPlaywright();
  if (!pw?.chromium) { skipReason = 'Playwright를 찾지 못했습니다(PLAYWRIGHT_MODULE로 지정 가능)'; return; }
  try {
    browser = await pw.chromium.launch();
  } catch (e) {
    skipReason = `Chromium을 띄우지 못했습니다: ${String(e.message).split('\n')[0]}`;
    return;
  }
  server = createFixtureServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(r => server.close(r));
});

// 가짜 chrome.runtime으로 page-agent를 주입하고, 메시지를 보내는 함수를 페이지에 만든다.
async function openWithAgent(path, { inject = 1 } = {}) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    const listeners = [];
    window.chrome = { runtime: { id: 'ext', onMessage: { addListener: fn => listeners.push(fn) } } };
    window.__agentSend = msg => new Promise(resolve => {
      let async = false;
      for (const fn of listeners) if (fn(msg, { id: 'ext' }, resolve) === true) async = true;
      if (!async && !listeners.length) resolve('__no_listener__');
    });
    window.__agentListeners = () => listeners.length;
    // 다른 발신자 id로 보낸다. 100ms 안에 응답이 없으면 '__ignored__'.
    window.__agentSendAs = (msg, id) => new Promise(resolve => {
      const results = listeners.map(fn => fn(msg, { id }, resolve));
      if (!results.includes(true)) setTimeout(() => resolve('__ignored__'), 100);
    });
  });
  await page.goto(base + path);
  for (let i = 0; i < inject; i++) await page.addScriptTag({ content: AGENT_SRC });
  const send = msg => page.evaluate(m => window.__agentSend(m), msg);
  return { page, send, errors };
}

const skipIfNeeded = t => { if (skipReason) { t.skip(skipReason); return true; } return false; };
const KEYS = ['url', 'title', 'headings', 'nav', 'buttons', 'fields', 'tables', 'notices'];
const FORBIDDEN = ['SECRET', '승인 비밀번호', 'approvalPw', 'sessionToken', 'SECRET-OPTION', 'SECRET-CELL', '시스템 점검 안내',
  '개인정보 시험용 긴 본문', '양식.xlsx', '고객 A'];

function assertLimits(s) {
  assert.deepEqual(Object.keys(s).sort(), [...KEYS].sort());
  for (const k of KEYS.slice(2)) assert.ok(Array.isArray(s[k]) && s[k].length <= 50, `${k} 개수`);
  const walk = v => {
    if (typeof v === 'string') assert.ok(v.length <= 120, `120자 초과: ${v.slice(0, 30)}…`);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const k of KEYS.slice(1)) walk(s[k]);
  for (const b of s.buttons) assert.doesNotMatch(b.selector, /^(\s*\S+:nth-child\(\d+\)\s*)+$/, 'nth-child 단독 선택자');
  for (const f of s.fields) assert.doesNotMatch(f.selector, /^(\s*\S+:nth-child\(\d+\)\s*)+$/);
}

test('EXTRACT_PAGE(홈, 쿼리 포함 URL): 계약 형식, 미끼 문자열 없음, 쿼리 없음', async t => {
  if (skipIfNeeded(t)) return;
  const { page, send, errors } = await openWithAgent('/?q=SECRET-QUERY&empNo=12345#guide');
  const s = await send({ type: 'EXTRACT_PAGE' });
  const json = JSON.stringify(s);
  for (const bad of [...FORBIDDEN, 'SECRET-QUERY', 'empNo', '12345']) assert.ok(!json.includes(bad), `결과에 ${bad}가 있습니다`);
  assertLimits(s);
  assert.equal(s.url, `${base}/`);
  assert.equal(s.title, '업무 포털 홈');
  assert.deepEqual(s.headings.map(h => [h.level, h.text]), [[1, '업무 포털 홈'], [2, '통합 검색'], [2, '최근 공지'], [2, '이용 안내']]);
  assert.deepEqual(s.nav, ['홈', '공지사항', '주문 관리', '메시지함', '자료실']);
  assert.deepEqual(s.buttons, [{ text: '검색', selector: '#btnSearch' }, { text: '초기화', selector: '#btnReset' }]);
  assert.deepEqual(s.fields, [
    { label: '검색어', type: 'text', placeholder: '제목 또는 내용', selector: '#q' },
    { label: '분류', type: 'select', placeholder: '', selector: '#category' },
  ]);
  assert.deepEqual(s.tables, [{ caption: '최근 공지', headers: ['번호', '제목', '작성일'] }]);
  assert.ok(s.notices.includes('검색어는 두 글자 이상 입력하세요.'));
  assert.ok(s.notices.includes('상단 메뉴에서 업무 화면으로 이동할 수 있습니다.'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('EXTRACT_PAGE(/spa/orders/new): 라벨 있는 필드 5개, 선택자, textarea 기본값 없음', async t => {
  if (skipIfNeeded(t)) return;
  const { page, send } = await openWithAgent('/spa/orders/new');
  // 사용자가 입력한 값도 보내지 않는다.
  await page.fill('#customerName', 'SECRET-TYPED-NAME');
  await page.fill('#orderMemo', 'SECRET-TYPED-MEMO');
  const s = await send({ type: 'EXTRACT_PAGE' });
  const json = JSON.stringify(s);
  assert.ok(!json.includes('SECRET'), json);
  assertLimits(s);
  assert.deepEqual(s.fields.map(f => [f.label, f.type, f.selector]), [
    ['고객명', 'text', '#customerName'], ['상품 코드', 'text', '#productCode'], ['수량', 'number', '#quantity'],
    ['납기일', 'date', '#deliveryDate'], ['메모', 'textarea', '#orderMemo'],
  ]);
  assert.ok(s.buttons.some(b => b.text === '저장' && b.selector === '#btnSave'));
  assert.equal(s.url, `${base}/spa/orders/new`);
  await page.close();
});

test('EXTRACT_PAGE: 숫자·해시 경로 마스킹', async t => {
  if (skipIfNeeded(t)) return;
  const a = await openWithAgent('/notice/101');
  assert.equal((await a.send({ type: 'EXTRACT_PAGE' })).url, `${base}/notice/*`);
  await a.page.close();
  const b = await openWithAgent('/spa/orders/1001?tab=SECRET');
  const sb = await b.send({ type: 'EXTRACT_PAGE' });
  assert.equal(sb.url, `${base}/spa/orders/*`);
  assert.equal(sb.headings[0].text, '주문 상세 1001', '화면 제목 자체는 보이는 텍스트이므로 포함');
  await b.page.close();
  const c = await openWithAgent('/hash#/settings');
  assert.equal((await c.send({ type: 'EXTRACT_PAGE' })).url, `${base}/hash#/settings`);
  await c.page.close();
});

test('EXTRACT_PAGE: 보이는 요소만, 위험 영역 텍스트 제외, 배열 50개·문자열 120자 한도', async t => {
  if (skipIfNeeded(t)) return;
  const { page, send } = await openWithAgent('/nomanual');
  await page.evaluate(() => {
    const main = document.querySelector('main');
    for (let i = 0; i < 70; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bulk';
      b.textContent = `대량 버튼 ${i} ` + '가'.repeat(200);
      main.append(b);
    }
    const hidden = document.createElement('button');
    hidden.id = 'hiddenBtn';
    hidden.textContent = 'HIDDEN-BUTTON';
    hidden.style.display = 'none';
    main.append(hidden);
    // 텍스트 안에 select·textarea·표가 섞인 안내 영역
    const live = document.createElement('div');
    live.setAttribute('role', 'status');
    live.innerHTML = '저장 안내 <select><option>SECRET-OPT2</option></select><textarea>SECRET-TA</textarea>'
      + '<table><tr><td>SECRET-TD</td></tr></table><span contenteditable="true">SECRET-CE</span>';
    main.append(live);
    const ce = document.createElement('div');
    ce.setAttribute('contenteditable', 'true');
    ce.setAttribute('role', 'button');
    ce.textContent = 'SECRET-EDIT';
    main.append(ce);
  });
  const s = await send({ type: 'EXTRACT_PAGE' });
  const json = JSON.stringify(s);
  assert.ok(!json.includes('SECRET'), json.match(/.{0,40}SECRET.{0,20}/)?.[0]);
  assert.ok(!json.includes('HIDDEN-BUTTON'));
  assert.equal(s.buttons.length, 50);
  assert.ok(s.buttons.every(b => b.text.length <= 120));
  assert.ok(s.notices.includes('저장 안내'));
  assertLimits(s);
  await page.close();
});

test('EXTRACT_PAGE: DOM 안정 대기 — SPA 전환 직후 요청해도 새 화면 기준', async t => {
  if (skipIfNeeded(t)) return;
  const { page, send } = await openWithAgent('/spa');
  // 전환을 일으킨 뒤 100ms 동안 계속 바뀌는 DOM에서도 마지막 상태를 읽는다.
  const s = await page.evaluate(() => {
    document.getElementById('spaNavOrders').click();
    let n = 0;
    const timer = setInterval(() => {
      const p = document.createElement('p');
      p.className = 'notice';
      p.textContent = `늦게 붙는 안내 ${++n}`;
      document.getElementById('app').append(p);
      if (n >= 4) clearInterval(timer);
    }, 50);
    return window.__agentSend({ type: 'EXTRACT_PAGE' });
  });
  assert.equal(s.headings[0].text, '주문 목록');
  assert.ok(s.notices.includes('늦게 붙는 안내 4'), JSON.stringify(s.notices));
  void send;
  await page.close();
});

test('HIGHLIGHT: 오버레이 표시·스크롤, 없는/잘못된 선택자, 페이지 스타일 불변, CLEAR', async t => {
  if (skipIfNeeded(t)) return;
  const { page, send, errors } = await openWithAgent('/');
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '2000px';
    document.querySelector('main').prepend(spacer);
  });
  const styleBefore = await page.evaluate(() => [...document.querySelectorAll('#btnSearch, #q, body')].map(e => e.getAttribute('style')));
  const r = await send({ type: 'HIGHLIGHT', selectors: ['#btnSearch', '#q', '#doesNotExist', '##bad[', '', 42] });
  assert.deepEqual(r, { found: 2 });
  const info = await page.evaluate(() => {
    const host = document.querySelector('page-manual-overlay');
    const r = document.getElementById('btnSearch').getBoundingClientRect();
    return { host: !!host, last: document.documentElement.lastElementChild === host, scrolled: window.scrollY > 0,
      inView: r.top >= 0 && r.bottom <= innerHeight };
  });
  assert.deepEqual(info, { host: true, last: true, scrolled: true, inView: true });
  const styleAfter = await page.evaluate(() => [...document.querySelectorAll('#btnSearch, #q, body')].map(e => e.getAttribute('style')));
  assert.deepEqual(styleAfter, styleBefore, '페이지 요소 스타일을 바꾸지 않는다');

  assert.deepEqual(await send({ type: 'HIGHLIGHT', selectors: ['#nothing', '##bad['] }), { found: 0 });
  assert.equal(await page.evaluate(() => !!document.querySelector('page-manual-overlay')), false, '새 요청은 이전 표시를 지운다');

  await send({ type: 'HIGHLIGHT', selectors: ['#btnSearch'] });
  assert.deepEqual(await send({ type: 'CLEAR_HIGHLIGHT' }), { ok: true });
  assert.equal(await page.evaluate(() => !!document.querySelector('page-manual-overlay')), false);
  assert.deepEqual(await send({ type: 'CLEAR_HIGHLIGHT' }), { ok: true }, '지울 것이 없어도 ok');
  assert.deepEqual(errors, []);
  await page.close();
});

test('HIGHLIGHT: 5초 뒤 자동 해제', async t => {
  if (skipIfNeeded(t)) return;
  const { page, send } = await openWithAgent('/spa/orders/new');
  assert.deepEqual(await send({ type: 'HIGHLIGHT', selectors: ['#btnSave'] }), { found: 1 });
  await page.waitForTimeout(4500);
  assert.equal(await page.evaluate(() => !!document.querySelector('page-manual-overlay')), true);
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => !!document.querySelector('page-manual-overlay')), false);
  await page.close();
});

test('같은 페이지에 세 번 주입해도 오류 없이 리스너는 하나', async t => {
  if (skipIfNeeded(t)) return;
  const { page, send, errors } = await openWithAgent('/', { inject: 3 });
  assert.equal(await page.evaluate(() => window.__agentListeners()), 1);
  assert.deepEqual(await send({ type: 'HIGHLIGHT', selectors: ['#btnSearch'] }), { found: 1 });
  assert.deepEqual(errors, []);
  await page.close();
});

test('다른 확장(sender.id 불일치) 메시지는 무시', async t => {
  if (skipIfNeeded(t)) return;
  const { page } = await openWithAgent('/');
  for (const type of ['EXTRACT_PAGE', 'HIGHLIGHT']) {
    const r = await page.evaluate(t => window.__agentSendAs({ type: t, selectors: ['#btnSearch'] }, 'other-extension'), type);
    assert.equal(r, '__ignored__', type);
  }
  assert.equal(await page.evaluate(() => !!document.querySelector('page-manual-overlay')), false);
  await page.close();
});

// ---------- QA r5 공격 케이스 회귀 ----------
// QA 공격 페이지(scratchpad scripts/qa-serve.mjs의 /qa/attack)를 그대로 옮겼다. shadow DOM은 setContent 뒤에 만든다.
const ATTACK_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>공격 페이지</title></head><body>
<nav><a href="/qa/x">메뉴1</a></nav>
<h1>공격 시험</h1>
<form id="f">
  <label for="a1">일반 입력</label><input id="a1" name="a1" value="SECRET-A1-ATTR" placeholder="예시">
  <label for="a2">메모</label><textarea id="a2" name="a2">SECRET-A2-TEXTAREA-DEFAULT</textarea>
  <textarea class="help" id="a3">SECRET-A3-TEXTAREA-AS-NOTICE</textarea>
  <select id="s1" aria-label="담당자"><option>SECRET-OPT</option><option selected>SECRET-SEL</option></select>
  <label>담당자2 <select id="s2"><option selected>SECRET-SEL2</option></select></label>
  <label>코드 <input type="hidden" value="SECRET-HID-IN-LABEL"><input id="c1" type="text" value="SECRET-C1"></label>
  <input id="a7" aria-labelledby="tdref">
  <input id="a8" aria-labelledby="taref">
  <input id="a9" aria-label="SECRET-ARIA-LABEL">
  <input id="SECRET-ID-ATTR" type="text">
  <input name="SECRET-NAME-ATTR" type="text">
  <input id="pw" type="password" value="SECRET-PW">
  <input type="button" value="버튼값">
  <button type="button" title="SECRET-TITLE-ONLY"></button>
  <button type="button" data-user="SECRET-DATA-USER" class="btnx">데이터버튼</button>
  <button type="button" data-testid="qa-save">테스트ID버튼</button>
  <div role="alert"><input value="SECRET-IN-ALERT"> 알림</div>
  <small>폼 안내 <textarea>SECRET-SMALL-TA</textarea></small>
</form>
<textarea id="taref">SECRET-TAREF-LABELLEDBY</textarea>
<div contenteditable="true"><h2>SECRET-H2-IN-CE</h2></div>
<h2 contenteditable="plaintext-only">SECRET-H2-PLAINTEXT-ONLY</h2>
<h3 contenteditable>SECRET-H3-CE-SELF</h3>
<div contenteditable="true" class="notice">SECRET-CE-AS-NOTICE</div>
<div role="textbox" contenteditable="true" aria-live="polite">SECRET-CE-LIVE</div>
<table id="t1"><caption>목록</caption><thead><tr><th>이름</th><th>상태</th></tr></thead><tbody>
  <tr><td id="tdref">SECRET-TD-LABELLEDBY</td><td class="notice">SECRET-TD-NOTICE</td><td role="status">SECRET-TD-STATUS</td>
  <td><button type="button">SECRET-ROW-BUTTON 수정</button></td><td><h3>SECRET-H3-IN-TD</h3></td>
  <td><a role="button" href="/u/1">SECRET-ROW-ROLEBUTTON</a></td></tr></tbody></table>
<table id="t2"><tbody><tr><th scope="row">SECRET-ROW-HEADER</th><td>값</td></tr></tbody></table>
<iframe srcdoc="<h1>SECRET-IFRAME-H1</h1><input value='SECRET-IFRAME-IN'><button>SECRET-IFRAME-BTN</button>"></iframe>
<div id="sh"></div>
<p id="long">${'본문문단SECRET-PARA '.repeat(30)}</p>
</body></html>`;

// 설계 ⑦이 허용하는 출처라서 남는 SECRET 표식(개인정보 패턴이 아님). 나머지 SECRET은 하나도 없어야 한다.
const DESIGN_ALLOWED = ['SECRET-ARIA-LABEL', 'SECRET-ID-ATTR', 'SECRET-NAME-ATTR', 'SECRET-TITLE-ONLY'];

async function openAttack(path, html, { setup } = {}) {
  const ctx = await openWithAgent(path, { inject: 0 });
  await ctx.page.setContent(html);
  if (setup) await ctx.page.evaluate(setup);
  await ctx.page.addScriptTag({ content: AGENT_SRC });
  return ctx;
}

const secretsIn = json => [...new Set(json.match(/SECRET-[A-Z0-9-]+/g) ?? [])].sort();

test('QA r5 공격 페이지: 편집 영역·표 본문·textarea·select·iframe·shadow·문단의 글자가 하나도 없다', async t => {
  if (skipIfNeeded(t)) return;
  const { page, send, errors } = await openAttack('/nomanual', ATTACK_HTML, {
    setup: () => {
      const r = document.getElementById('sh').attachShadow({ mode: 'open' });
      const h = document.createElement('h2');
      h.textContent = 'SECRET-SHADOW-H2';
      const b = document.createElement('button');
      b.textContent = 'SECRET-SHADOW-BTN';
      r.append(h, b);
    },
  });
  // 사용자가 편집 영역 제목에 직접 입력한다(critical 1 재현).
  await page.click('h3[contenteditable]');
  await page.keyboard.type('SECRET-TYPED-CE');
  const s = await send({ type: 'EXTRACT_PAGE' });
  const json = JSON.stringify(s);
  assert.deepEqual(secretsIn(json), DESIGN_ALLOWED, json);
  assertLimits(s);

  assert.deepEqual(s.headings.map(h => h.text), ['공격 시험'], '편집 영역 안·자신·plaintext-only·표 셀 안 제목 제외');
  assert.deepEqual(s.notices, ['알림', '폼 안내'], 'textarea.help, 편집 영역 notice, role=textbox, td.notice, td[role=status] 제외');
  assert.deepEqual(s.buttons.map(b => b.text), ['버튼값', 'SECRET-TITLE-ONLY', '데이터버튼', '테스트ID버튼'], '표 본문 행 안 버튼·role=button 링크 제외');
  assert.ok(s.buttons.some(b => b.selector === 'button[data-testid="qa-save"]'));
  assert.ok(!json.includes('data-user'), '시험용이 아닌 data 속성은 선택자에 쓰지 않는다');
  const bySel = Object.fromEntries(s.fields.map(f => [f.selector, f]));
  assert.equal(bySel['#a7'].label, '', 'aria-labelledby가 표 셀을 가리키면 라벨을 버린다');
  assert.equal(bySel['#a8'].label, '', 'aria-labelledby가 textarea를 가리키면 라벨을 버린다');
  assert.equal(bySel['#a2'].label, '메모');
  assert.equal(bySel['#s2'].label, '담당자2', '감싼 label에서 select 옵션 글자 제외');
  assert.equal(bySel['#c1'].label, '코드');
  assert.ok(!s.fields.some(f => f.type === 'password' || f.type === 'hidden'));
  assert.deepEqual(s.tables, [{ caption: '목록', headers: ['이름', '상태'] }], 'thead 없는 표의 scope=row 머리글은 넣지 않는다');
  assert.deepEqual(errors, []);
  await page.close();
});

test('thead 없는 표: 첫 행이 모두 th(scope=row 아님)면 머리글, 본문 행·tfoot 글자는 제외', async t => {
  if (skipIfNeeded(t)) return;
  const html = `<!doctype html><title>표</title><h1>표 시험</h1>
    <table id="a"><tr><th>사번</th><th>성명</th></tr><tr><td>SECRET-CELL-A</td><td><a href="#" role="button">SECRET-LINK</a></td></tr></table>
    <table id="b"><tr><th>구분</th><td>SECRET-MIXED-ROW</td></tr></table>
    <table id="c"><thead><tr><th scope="col">열1</th></tr></thead><tfoot><tr><th>SECRET-FOOT-TH</th></tr></tfoot><tbody><tr><td class="help">SECRET-TBODY-HELP</td></tr></tbody></table>`;
  const { page, send } = await openAttack('/nomanual', html);
  const s = await send({ type: 'EXTRACT_PAGE' });
  const json = JSON.stringify(s);
  assert.deepEqual(secretsIn(json), [], json);
  assert.deepEqual(s.tables, [{ caption: '', headers: ['사번', '성명'] }, { caption: '', headers: ['열1'] }]);
  await page.close();
});

test('개인정보 마스킹: 이메일·전화번호·주민번호형·6자리 이상 숫자(글자, 속성, URL 경로, 선택자)', async t => {
  if (skipIfNeeded(t)) return;
  const path = '/spa/users/hong.gildong@corp.com/010-1234-5678/emp1234567/orders/2026-10-23?x=1';
  const html = `<!doctype html><title>담당 hong@corp.com 결재</title>
    <nav><a href="#">kim.cs@example.co.kr 메일함</a></nav>
    <h1>사원 1234567 정보</h1>
    <h2>연락처 010-1234-5678 / 02-345-6789 / +82-10-9876-5432</h2>
    <h3>주민 900101-1234567 확인</h3>
    <button id="emp-7654321" type="button" aria-label="x">호출 01098765432</button>
    <button type="button" class="btn-1234567" title="담당자 010 2222 3333"></button>
    <form><label for="mail">메일</label><input id="mail" placeholder="예: user@corp.com">
    <input id="ok-2026" aria-label="문의 lee@corp.com"></form>
    <p class="notice">문의: 사번 20231234, 날짜 2026-10-23, 수량 12345</p>`;
  const { page, send } = await openAttack(path, html);
  const s = await send({ type: 'EXTRACT_PAGE' });
  const json = JSON.stringify(s);
  for (const bad of ['hong', 'corp.com', 'example.co.kr', '1234567', '1234-5678', '345-6789', '9876-5432', '900101',
    '01098765432', '2222', '20231234', 'gildong', 'emp-7654321']) {
    assert.ok(!json.includes(bad), `${bad}가 남아 있습니다: ${json}`);
  }
  assert.equal(s.title, '담당 *** 결재');
  assert.deepEqual(s.nav, ['*** 메일함']);
  assert.equal(s.headings[0].text, '사원 *** 정보');
  assert.equal(s.headings[1].text, '연락처 *** / *** / ***');
  assert.equal(s.headings[2].text, '주민 *** 확인');
  assert.ok(s.notices[0].includes('날짜 2026-10-23') && s.notices[0].includes('수량 12345'), '날짜·5자리 이하 숫자는 그대로');
  const call = s.buttons.find(b => b.text === '호출 ***');
  assert.ok(call, JSON.stringify(s.buttons));
  assert.equal(call.selector, 'button[aria-label="x"]', '개인정보가 든 id는 건너뛰고 다음 후보');
  const titled = s.buttons.find(b => b.text === '담당자 ***');
  assert.ok(titled, JSON.stringify(s.buttons));
  assert.doesNotMatch(titled.selector, /\d{6}/);
  assert.equal(s.fields.find(f => f.selector === '#mail').placeholder, '예: ***');
  assert.equal(s.fields.find(f => f.selector === '#ok-2026').label, '문의 ***');
  // URL 경로 마스킹은 matcher.aiCacheKey와 같다(page-agent 복사본 동기화 확인).
  assert.equal(s.url, aiCacheKey(base + path));
  assert.equal(s.url, `${base}/spa/users/*/*/*/orders/*`);
  await page.close();
});

test('하이라이트 오버레이는 적대적 페이지 CSS의 영향을 받지 않는다', async t => {
  if (skipIfNeeded(t)) return;
  const html = `<!doctype html><title>스타일</title><style>
    div:not(.sp){display:none!important;border:9px solid red!important} *{outline:1px solid lime}
    page-manual-overlay{display:none!important;opacity:0!important;visibility:hidden!important;transform:scale(0)!important;filter:blur(9px)!important;border:9px solid red!important}
    </style><div class="sp" style="height:1500px">위 여백</div><button id="far" type="button">멀리 있는 버튼</button><div class="sp" style="height:1500px"></div>`;
  const { page, send, errors } = await openAttack('/nomanual', html);
  assert.deepEqual(await send({ type: 'HIGHLIGHT', selectors: ['#far'] }), { found: 1 });
  const cs = await page.evaluate(() => {
    const host = document.querySelector('page-manual-overlay');
    const c = getComputedStyle(host);
    return { last: document.documentElement.lastElementChild === host, display: c.display, opacity: c.opacity,
      visibility: c.visibility, transform: c.transform, filter: c.filter, border: c.borderTopWidth, outline: c.outlineStyle,
      position: c.position, pe: c.pointerEvents, farStyle: document.getElementById('far').getAttribute('style') };
  });
  assert.deepEqual(cs, { last: true, display: 'block', opacity: '1', visibility: 'visible', transform: 'none', filter: 'none',
    border: '0px', outline: 'none', position: 'fixed', pe: 'none', farStyle: null });
  assert.deepEqual(errors, []);
  await page.close();
});

test('QA r6: 숨긴 자손(display·visibility·hidden·aria-hidden) 글자 제외, 변형 개인정보 마스킹(브라우저 복사본)', async t => {
  if (skipIfNeeded(t)) return;
  const html = `<!doctype html><title>숨김 시험</title>
    <h1>전화 010<i style="display:none">a</i>1234<i style="display:none">a</i>5678 안내</h1>
    <h2>담당 <span hidden>SECRET-HIDDEN-ATTR</span><span aria-hidden="true">SECRET-ARIA-HIDDEN</span><span style="visibility:hidden">SECRET-VIS-HIDDEN</span>홍보팀</h2>
    <p class="notice">문의 (02) 123-4567 / ０１０－１２３４－５６７８ / hong[at]corp.com / 900101.1234567 / ٩٠٠١٠١-١٢٣٤٥٦٧ / 010​1234​5678 · 최대 100000건 · 기준일 20261023</p>
    <button type="button">카드 1234-5678-9012-3456 등록</button>
    <h3 aria-hidden="true">SECRET-H3-ARIA-HIDDEN</h3>`;
  const { page, send, errors } = await openAttack('/nomanual', html);
  const s = await send({ type: 'EXTRACT_PAGE' });
  const json = JSON.stringify(s);
  assert.deepEqual(secretsIn(json), [], json);
  for (const bad of ['1234', '5678', '123-4567', 'hong', '900101', '٩٠٠١٠١', '9012']) assert.ok(!json.includes(bad), `${bad}: ${json}`);
  assert.equal(s.headings[0].text, '전화 *** 안내', '숨긴 a가 빠져 번호가 이어지고 마스킹된다');
  assert.equal(s.headings[1].text, '담당 홍보팀');
  assert.equal(s.headings.length, 2, 'aria-hidden 제목 자체도 제외');
  assert.ok(s.notices[0].includes('최대 100000건') && s.notices[0].includes('기준일 20261023'), s.notices[0]);
  assert.equal(s.buttons[0].text, '카드 *** 등록');
  assert.deepEqual(errors, []);
  await page.close();
});

// QA r7 m7b.cjs의 /qa/attack3(분할·숨김 12종)과 font-size:0 레이아웃 보존
const ATTACK3_HTML = `<!doctype html><title>분할</title>
<h2>S01 분할 <span>010</span><span>1234</span><span>5678</span></h2>
<h2>S02 숨김 010<i style="display:none">a</i>1234<i style="display:none">a</i>5678</h2>
<h2>S03 visibility 010<i style="visibility:hidden">a</i>1234<i style="visibility:hidden">a</i>5678</h2>
<h2>S04 줄바꿈 010<br>1234<br>5678</h2>
<h2>S05 이메일 분할 hong<span>@</span><b>corp</b>.com</h2>
<h2>S06 aria-hidden 사번 <span aria-hidden="true">SECRET-ARIAHIDDEN</span>표시</h2>
<h2>S07 hidden 속성 <span hidden>SECRET-HIDDENATTR</span>표시</h2>
<h2>S08 sr-only 이름 <span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">홍길동 010-9999-8888</span>표시</h2>
<h2>S09 폰트0 <span style="font-size:0">SECRET-FONT0</span>표시</h2>
<h2>S10 opacity0 <span style="opacity:0">SECRET-OPACITY0</span>표시</h2>
<h2>S11 주석 <!-- SECRET-COMMENT -->표시</h2>
<h2>S12 이미지 alt <img alt="SECRET-ALT 010-1111-2222" src="data:,">표시</h2>
<nav><ul style="font-size:0"><li style="display:inline-block;font-size:14px"><a href="#">공지사항</a></li> <li style="display:inline-block;font-size:14px"><a href="#">결재함</a></li></ul></nav>
<h3 style="font-size:0">SECRET-H3-FONT0<span style="font-size:16px">보이는 제목</span></h3>`;

test('QA r7 attack3: 분할·숨김(font-size 0, opacity 0 포함)·주석·alt 글자 처리', async t => {
  if (skipIfNeeded(t)) return;
  const { page, send, errors } = await openAttack('/nomanual', ATTACK3_HTML);
  const s = await send({ type: 'EXTRACT_PAGE' });
  const json = JSON.stringify(s);
  assert.deepEqual(secretsIn(json), [], json);
  for (const bad of ['1234', '5678', '9999', '1111', 'hong', 'corp']) assert.ok(!json.includes(bad), `${bad}: ${json}`);
  assert.deepEqual(s.headings.map(h => h.text), [
    'S01 분할 ***',
    'S02 숨김 ***',
    'S03 visibility ***',
    'S04 줄바꿈 ***',
    'S05 이메일 분할 ***',
    'S06 aria-hidden 사번 표시',
    'S07 hidden 속성 표시',
    'S08 sr-only 이름 홍길동 ***표시', // 화면 낭독기가 읽는 글자는 수집 대상(설계 ⑦, 리더 열린 항목). 번호만 가린다.
    'S09 폰트0 표시',
    'S10 opacity0 표시',
    'S11 주석 표시',
    'S12 이미지 alt 표시',
    '보이는 제목',
  ]);
  assert.deepEqual(s.nav, ['공지사항', '결재함'], '부모 font-size:0 + 자식 글자 크기 복원 레이아웃의 메뉴는 남는다');
  assert.deepEqual(errors, []);
  await page.close();
});
