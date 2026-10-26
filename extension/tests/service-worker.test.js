// service-worker.js를 가짜 chrome 위에서 실행해 이동 감지·디바운스·중복 제거·상태 저장·메시지 처리를 확인한다.
// 실제 브라우저 시험(QA)을 대신하지 않는다. 로직 회귀를 빨리 잡기 위한 것이다.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MSG } from '../src/shared/messages.js';
import { resetManualCache } from '../src/background/manual-store.js';

const EXT_ID = 'testextid';
const EXT_BASE = `chrome-extension://${EXT_ID}/`;
const extRoot = new URL('../', import.meta.url);

function makeEvent() {
  const listeners = [];
  return { addListener: fn => listeners.push(fn), fire: (...a) => listeners.map(fn => fn(...a)), listeners };
}

function makeChrome({ installType = 'development', local = {} } = {}) {
  const localData = structuredClone(local);
  const session = new Map();
  const tabs = new Map();
  const sent = [];
  const chrome = {
    _session: session, _tabs: tabs, _sent: sent,
    runtime: {
      id: EXT_ID,
      getURL: p => EXT_BASE + p,
      onInstalled: makeEvent(),
      onMessage: makeEvent(),
      sendMessage: async msg => { sent.push(structuredClone(msg)); throw new Error('Could not establish connection. Receiving end does not exist.'); },
    },
    sidePanel: { setPanelBehavior: async opts => { chrome._panelBehavior = opts; } },
    management: { getSelf: async () => ({ installType }) },
    storage: {
      session: {
        get: async key => (session.has(key) ? { [key]: structuredClone(session.get(key)) } : {}),
        set: async obj => { for (const [k, v] of Object.entries(obj)) session.set(k, structuredClone(v)); },
        remove: async key => { session.delete(key); },
      },
      local: {
        _data: localData,
        get: async keys => {
          if (keys === null) return structuredClone(localData);
          const ks = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(ks.filter(k => k in localData).map(k => [k, structuredClone(localData[k])]));
        },
        set: async obj => { Object.assign(localData, structuredClone(obj)); },
        remove: async keys => { for (const k of Array.isArray(keys) ? keys : [keys]) delete localData[k]; },
      },
    },
    tabs: {
      get: async id => { if (!tabs.has(id)) throw new Error(`No tab with id: ${id}`); return { ...tabs.get(id) }; },
      onUpdated: makeEvent(), onActivated: makeEvent(), onRemoved: makeEvent(),
      // 페이지 에이전트 흉내: 주입된 탭만 응답한다.
      sendMessage: async (tabId, msg, opts) => {
        chrome._agentMsgs.push({ tabId, msg, opts });
        if (!chrome._injected.has(tabId)) throw new Error('Receiving end does not exist.');
        if (msg.type === 'HIGHLIGHT') return { found: msg.selectors.filter(s => s.startsWith('#btn')).length };
        if (msg.type === 'EXTRACT_PAGE') return chrome._structure(tabId);
        return { ok: true };
      },
    },
    permissions: { contains: async ({ origins }) => origins.every(o => o === 'http://localhost:8787/*') },
    scripting: { executeScript: async ({ target }) => { chrome._injected.add(target.tabId); return [{}]; } },
    _agentMsgs: [],
    _structure: () => ({ url: '', title: '자료실', headings: [{ level: 1, text: '자료실' }], nav: [], buttons: [{ text: '자료 찾기', selector: '#btnFileSearch' }], fields: [{ label: '파일 이름', type: 'text', placeholder: '', selector: '#fileKeyword' }], tables: [], notices: [] }),
    _injected: new Set(),
    webNavigation: { onHistoryStateUpdated: makeEvent(), onReferenceFragmentUpdated: makeEvent() },
  };
  return chrome;
}

// chrome-extension:// URL을 extension/ 아래 파일로 돌려주는 fetch
async function fakeFetch(url) {
  const u = String(url);
  if (u.startsWith('https://api.anthropic.com/') && globalThis.__apiHandler) return globalThis.__apiHandler(u, arguments[1]);
  if (!u.startsWith(EXT_BASE)) throw new Error(`외부 fetch 금지: ${u}`);
  try {
    const text = readFileSync(fileURLToPath(new URL(u.slice(EXT_BASE.length), extRoot)), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  } catch {
    throw new TypeError('Failed to fetch');
  }
}

let chrome;
let realFetch;
let loadCount = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));
const settle = () => wait(220); // 디바운스(150ms) + 비동기 처리 여유

async function loadWorker(opts) {
  chrome = makeChrome(opts);
  globalThis.chrome = chrome;
  resetManualCache();
  // 쿼리로 매번 새 모듈 인스턴스를 만든다(최상위 리스너 등록과 메모리 상태 초기화).
  await import(`../src/background/service-worker.js?n=${++loadCount}`);
  return chrome;
}

function setTab(id, url, windowId = 1) {
  chrome._tabs.set(id, { id, windowId, url, status: 'complete' });
}
const updates = () => chrome._sent.filter(m => m.type === MSG.MANUAL_UPDATED);
const pageIds = () => updates().map(m => m.page?.id ?? `${m.state}:${m.reason ?? ''}`);

// 탭 이동을 흉내낸다: tabs.onUpdated(url) + status complete
function navigate(id, url) {
  setTab(id, url, chrome._tabs.get(id)?.windowId ?? 1);
  chrome.tabs.onUpdated.fire(id, { url }, chrome._tabs.get(id));
  chrome.tabs.onUpdated.fire(id, { status: 'complete' }, chrome._tabs.get(id));
}

// 확장 페이지에서 보낸 메시지처럼 onMessage를 부른다.
function ask(message, sender = { id: EXT_ID, url: `${EXT_BASE}src/sidepanel/sidepanel.html` }) {
  return new Promise(resolve => {
    let responded = false;
    const results = chrome.runtime.onMessage.fire(message, sender, r => { responded = true; resolve(r); });
    if (!results.includes(true)) setTimeout(() => { if (!responded) resolve('__no_response__'); }, 50);
  });
}

beforeEach(() => { realFetch = globalThis.fetch; globalThis.fetch = fakeFetch; });
afterEach(() => { globalThis.fetch = realFetch; delete globalThis.chrome; });

const L = 'http://localhost:8787';

test('최상위에서 리스너 7개와 setPanelBehavior가 등록된다', async () => {
  await loadWorker();
  assert.deepEqual(chrome._panelBehavior, { openPanelOnActionClick: true });
  for (const ev of [chrome.runtime.onInstalled, chrome.runtime.onMessage, chrome.tabs.onUpdated, chrome.tabs.onActivated,
    chrome.tabs.onRemoved, chrome.webNavigation.onHistoryStateUpdated, chrome.webNavigation.onReferenceFragmentUpdated]) {
    assert.equal(ev.listeners.length, 1);
  }
});

test('일반 이동: onUpdated(url)+complete가 한 번의 MANUAL_UPDATED로 합쳐지고 상태가 저장된다', async () => {
  await loadWorker();
  navigate(5, `${L}/`);
  await settle();
  assert.deepEqual(pageIds(), ['home']);
  const m = updates()[0];
  assert.equal(m.tabId, 5);
  assert.equal(m.windowId, 1);
  assert.equal(m.state, 'ready');
  assert.equal(m.source, 'authored');
  assert.equal(m.siteId, 'demo-local');
  assert.deepEqual(m.related.map(r => r.id), ['notice-view', 'spa-home', 'hash-inbox']);
  const rec = chrome._session.get('tab:5');
  assert.equal(rec.dedupeKey, `${L}/`);
  assert.equal(rec.state.page.id, 'home');

  navigate(5, `${L}/notice/101`);
  await settle();
  navigate(5, `${L}/notice/102`);
  await settle();
  assert.deepEqual(pageIds(), ['home', 'notice-view', 'notice-view'], '다른 URL이면 같은 매뉴얼이라도 다시 보낸다');
});

test('같은 URL의 재완료(complete)·새로고침은 다시 보내지 않는다', async () => {
  await loadWorker();
  navigate(5, `${L}/`);
  await settle();
  chrome.tabs.onUpdated.fire(5, { status: 'complete' }, chrome._tabs.get(5));
  await settle();
  navigate(5, `${L}/`);
  await settle();
  assert.deepEqual(pageIds(), ['home']);
});

test('pushState SPA: onHistoryStateUpdated + onUpdated(url) 중복이 합쳐지고, exact가 glob보다 우선', async () => {
  await loadWorker();
  navigate(7, `${L}/spa`);
  await settle();
  for (const path of ['/spa/orders', '/spa/orders/new', '/spa/orders/1001']) {
    setTab(7, L + path);
    chrome.webNavigation.onHistoryStateUpdated.fire({ tabId: 7, frameId: 0, url: L + path });
    chrome.tabs.onUpdated.fire(7, { url: L + path }, chrome._tabs.get(7));
    await settle();
  }
  assert.deepEqual(pageIds(), ['spa-home', 'spa-orders', 'spa-order-new', 'spa-order-view']);
});

test('150ms 안에 연달아 이동하면 마지막 URL만 결정한다', async () => {
  await loadWorker();
  for (const path of ['/spa', '/spa/orders', '/spa/orders/new']) {
    setTab(7, L + path);
    chrome.webNavigation.onHistoryStateUpdated.fire({ tabId: 7, frameId: 0, url: L + path });
    await wait(20);
  }
  await settle();
  assert.deepEqual(pageIds(), ['spa-order-new']);
});

test('해시 라우팅: #/inbox → #/settings → #/unknown, #section 앵커는 무시', async () => {
  await loadWorker();
  navigate(9, `${L}/hash#/inbox`);
  await settle();
  for (const h of ['#/settings', '#/unknown']) {
    setTab(9, `${L}/hash${h}`);
    chrome.webNavigation.onReferenceFragmentUpdated.fire({ tabId: 9, frameId: 0, url: `${L}/hash${h}` });
    chrome.tabs.onUpdated.fire(9, { url: `${L}/hash${h}` }, chrome._tabs.get(9));
    await settle();
  }
  assert.deepEqual(pageIds(), ['hash-inbox', 'hash-settings', 'none:ai-not-allowed']);

  navigate(3, `${L}/`);
  await settle();
  const before = updates().length;
  setTab(3, `${L}/#guide`);
  chrome.webNavigation.onReferenceFragmentUpdated.fire({ tabId: 3, frameId: 0, url: `${L}/#guide` });
  chrome.tabs.onUpdated.fire(3, { url: `${L}/#guide` }, chrome._tabs.get(3));
  await settle();
  assert.equal(updates().length, before, '#guide 앵커로는 다시 보내지 않는다');
});

test('하위 프레임 이동은 무시한다', async () => {
  await loadWorker();
  setTab(4, `${L}/`);
  chrome.webNavigation.onHistoryStateUpdated.fire({ tabId: 4, frameId: 3, url: `${L}/spa` });
  await settle();
  assert.deepEqual(updates(), []);
});

test('매뉴얼 없는 페이지: none(ai-not-allowed, canEnableAi), chrome:// 페이지: none(unsupported-url)', async () => {
  await loadWorker();
  navigate(5, `${L}/nomanual`);
  navigate(6, 'chrome://extensions/');
  await settle();
  const [a, b] = [updates().find(m => m.tabId === 5), updates().find(m => m.tabId === 6)];
  assert.equal(a.state, 'none');
  assert.equal(a.reason, 'ai-not-allowed');
  assert.equal(a.canEnableAi, true);
  assert.equal(a.page, undefined);
  assert.equal(b.state, 'none');
  assert.equal(b.reason, 'unsupported-url');
  assert.equal(b.canEnableAi, false);
});

test('탭 전환: 상태가 없는 탭만 결정하고, 패널 GET과 겹쳐도 한 번만 보낸다', async () => {
  await loadWorker();
  navigate(1, `${L}/`);
  await settle();
  setTab(2, `${L}/spa/orders`, 1);
  chrome.tabs.onActivated.fire({ tabId: 2, windowId: 1 });
  const res = await ask({ type: MSG.GET_CURRENT_MANUAL, tabId: 2 });
  await settle();
  assert.equal(res.page.id, 'spa-orders');
  assert.deepEqual(pageIds(), ['home', 'spa-orders']);
  chrome.tabs.onActivated.fire({ tabId: 1, windowId: 1 });
  await settle();
  assert.deepEqual(pageIds(), ['home', 'spa-orders'], '이미 상태가 있는 탭은 다시 보내지 않는다');
});

test('GET_CURRENT_MANUAL: 저장 상태가 있으면 그대로, URL이 바뀌었으면 다시 결정', async () => {
  await loadWorker();
  navigate(5, `${L}/notice/101`);
  await settle();
  const r1 = await ask({ type: MSG.GET_CURRENT_MANUAL, tabId: 5 });
  assert.equal(r1.page.id, 'notice-view');
  assert.equal(updates().length, 1);
  setTab(5, `${L}/spa`); // 이벤트를 놓친 이동
  const r2 = await ask({ type: MSG.GET_CURRENT_MANUAL, tabId: 5 });
  assert.equal(r2.page.id, 'spa-home');
});

test('GET_CURRENT_MANUAL 실패는 null이 아니라 error ManualState: 없는 탭 → TAB_NOT_FOUND', async () => {
  await loadWorker();
  const r = await ask({ type: MSG.GET_CURRENT_MANUAL, tabId: 999 });
  assert.deepEqual(r, {
    tabId: 999, windowId: null, url: '', state: 'error',
    error: { code: 'TAB_NOT_FOUND', message: '대상 탭을 찾을 수 없습니다.' },
  });
  await settle();
  assert.deepEqual(updates(), [], '없는 탭의 상태는 저장·전송하지 않는다');
  assert.equal(chrome._session.has('tab:999'), false);
});

test('결정 중 예외 → INTERNAL_ERROR 상태를 응답·저장·전송하고, 다음 이동에서 다시 결정한다', async () => {
  await loadWorker();
  const realGet = chrome.tabs.get;
  // tab.id를 읽는 순간 예외가 나는 탭(결정 흐름 안의 예상하지 못한 예외를 흉내낸다)
  chrome.tabs.get = async id => {
    if (id !== 5) return realGet(id);
    const t = { windowId: 2, url: `${L}/` };
    Object.defineProperty(t, 'id', { get() { throw new Error('boom'); }, enumerable: true });
    return t;
  };
  const warn = console.warn;
  console.warn = () => {};
  let r;
  try {
    r = await ask({ type: MSG.GET_CURRENT_MANUAL, tabId: 5 });
  } finally {
    console.warn = warn;
  }
  assert.equal(r.state, 'error');
  assert.equal(r.error.code, 'INTERNAL_ERROR');
  assert.equal(r.tabId, 5);
  assert.equal(r.windowId, 2);
  assert.equal(r.url, `${L}/`);
  await settle();
  assert.deepEqual(updates().map(m => m.state), ['error']);
  assert.equal(chrome._session.get('tab:5').state.state, 'error');

  // 복구: 같은 URL이어도 저장 상태가 error면 다음 이동 이벤트에서 다시 결정한다.
  chrome.tabs.get = realGet;
  navigate(5, `${L}/`);
  await settle();
  assert.deepEqual(pageIds(), ['error:', 'home']);
});

test('GET_CURRENT_MANUAL 처리 중 storage 예외 → INTERNAL_ERROR 상태 응답', async () => {
  await loadWorker();
  setTab(5, `${L}/`);
  chrome.storage.session.get = async () => { throw new Error('storage down'); };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const r = await ask({ type: MSG.GET_CURRENT_MANUAL, tabId: 5 });
    assert.equal(r.state, 'error');
    assert.equal(r.tabId, 5);
    assert.equal(r.error.code, 'INTERNAL_ERROR');
    assert.equal(typeof r.error.message, 'string');
  } finally {
    console.warn = warn;
  }
});

test('워커 재시작 후 GET_CURRENT_MANUAL이 storage.session의 같은 상태를 돌려준다', async () => {
  await loadWorker();
  navigate(5, `${L}/spa/orders/new`);
  await settle();
  const saved = structuredClone(chrome._session.get('tab:5').state);
  const tabsBefore = chrome._tabs;
  const sessionBefore = chrome._session;
  // 새 워커 인스턴스(메모리 초기화). session과 탭은 그대로 둔다.
  await loadWorker();
  for (const [k, v] of sessionBefore) chrome._session.set(k, v);
  for (const [k, v] of tabsBefore) chrome._tabs.set(k, v);
  const r = await ask({ type: MSG.GET_CURRENT_MANUAL, tabId: 5 });
  assert.deepEqual(r, saved);
  assert.deepEqual(updates(), [], '저장 상태를 돌려줄 때는 다시 보내지 않는다');
});

test('REFRESH_MANUAL: { ok: true } 응답 후 중복 제거를 무시하고 다시 보낸다', async () => {
  await loadWorker();
  navigate(5, `${L}/`);
  await settle();
  const r = await ask({ type: MSG.REFRESH_MANUAL, tabId: 5 });
  assert.deepEqual(r, { ok: true });
  await settle();
  assert.deepEqual(pageIds(), ['home', 'home']);
});

test('콘텐츠 스크립트·다른 확장에서 온 메시지는 거부한다', async () => {
  await loadWorker();
  setTab(5, `${L}/`);
  const fromContent = { id: EXT_ID, tab: { id: 5 }, url: `${L}/`, frameId: 0 };
  assert.equal(await ask({ type: MSG.GET_CURRENT_MANUAL, tabId: 5 }, fromContent), '__no_response__');
  assert.equal(await ask({ type: MSG.REFRESH_MANUAL, tabId: 5 }, fromContent), '__no_response__');
  assert.equal(await ask({ type: MSG.GET_CURRENT_MANUAL, tabId: 5 }, { id: 'otherext', url: 'chrome-extension://otherext/x.html' }), '__no_response__');
  await settle();
  assert.deepEqual(updates(), []);
  // 탭으로 연 sidepanel.html?tabId=… (QA 자동화 경로)는 허용
  const fromExtTab = { id: EXT_ID, tab: { id: 8 }, url: `${EXT_BASE}src/sidepanel/sidepanel.html?tabId=5` };
  assert.equal((await ask({ type: MSG.GET_CURRENT_MANUAL, tabId: 5 }, fromExtTab)).page.id, 'home');
});

test('잘못된 tabId·알 수 없는 타입은 응답하지 않는다', async () => {
  await loadWorker();
  for (const m of [{ type: MSG.GET_CURRENT_MANUAL }, { type: MSG.GET_CURRENT_MANUAL, tabId: '5' }, { type: 'UNKNOWN' }, null]) {
    assert.equal(await ask(m), '__no_response__', JSON.stringify(m));
  }
});

test('탭이 닫히면 저장 상태를 지운다', async () => {
  await loadWorker();
  navigate(5, `${L}/`);
  await settle();
  assert.ok(chrome._session.has('tab:5'));
  chrome._tabs.delete(5);
  chrome.tabs.onRemoved.fire(5, { windowId: 1, isWindowClosing: false });
  await wait(10);
  assert.equal(chrome._session.has('tab:5'), false);
});

test('배포 설치(normal)에서는 데모 매뉴얼을 읽지 않는다', async () => {
  await loadWorker({ installType: 'normal' });
  navigate(5, `${L}/`);
  await settle();
  assert.deepEqual(pageIds(), ['none:ai-not-allowed']);
});

test('패널이 닫혀 sendMessage가 거부돼도 처리되지 않은 거부가 없다', async () => {
  const seen = [];
  const onRej = e => seen.push(e);
  process.on('unhandledRejection', onRej);
  try {
    await loadWorker();
    navigate(5, `${L}/`);
    await settle();
    assert.equal(updates().length, 1);
  } finally {
    process.off('unhandledRejection', onRej);
  }
  assert.deepEqual(seen, []);
});

test('HIGHLIGHT 중계: 패널 → SW → 에이전트(주입 후), 권한 없는 사이트는 NO_HOST_PERMISSION', async () => {
  await loadWorker();
  setTab(5, `${L}/spa/orders/new`);
  const r = await ask({ type: MSG.HIGHLIGHT, tabId: 5, selectors: ['#btnSave', '#customerName', 42] });
  assert.deepEqual(r, { found: 1 });
  assert.ok(chrome._injected.has(5));
  const sent = chrome._agentMsgs.find(m => m.msg.type === 'HIGHLIGHT');
  assert.deepEqual(sent.msg, { type: 'HIGHLIGHT', selectors: ['#btnSave', '#customerName'] });
  assert.deepEqual(sent.opts, { frameId: 0 });

  setTab(6, 'https://example.com/');
  const denied = await ask({ type: MSG.HIGHLIGHT, tabId: 6, selectors: ['#a'] });
  assert.equal(denied.found, 0);
  assert.equal(denied.error.code, 'NO_HOST_PERMISSION');
  assert.equal(chrome._injected.has(6), false);
});

test('CLEAR_HIGHLIGHT 중계: 에이전트가 없어도 { ok: true }, 주입하지 않는다', async () => {
  await loadWorker();
  setTab(6, 'https://example.com/');
  assert.deepEqual(await ask({ type: MSG.CLEAR_HIGHLIGHT, tabId: 6 }), { ok: true });
  assert.equal(chrome._injected.has(6), false);
  setTab(5, `${L}/`);
  await ask({ type: MSG.HIGHLIGHT, tabId: 5, selectors: ['#btnSearch'] });
  assert.deepEqual(await ask({ type: MSG.CLEAR_HIGHLIGHT, tabId: 5 }), { ok: true });
  assert.equal(chrome._agentMsgs.at(-1).msg.type, 'CLEAR_HIGHLIGHT');
});

test('HIGHLIGHT·CLEAR_HIGHLIGHT도 콘텐츠 스크립트에서 오면 거부한다', async () => {
  await loadWorker();
  setTab(5, `${L}/`);
  const fromContent = { id: EXT_ID, tab: { id: 5 }, url: `${L}/`, frameId: 0 };
  assert.equal(await ask({ type: MSG.HIGHLIGHT, tabId: 5, selectors: ['#btnSearch'] }, fromContent), '__no_response__');
  assert.equal(await ask({ type: MSG.CLEAR_HIGHLIGHT, tabId: 5 }, fromContent), '__no_response__');
  assert.deepEqual(chrome._agentMsgs, []);
});

// ---------- 모듈 6: AI 분기 (가짜 API 응답, 실제 호출 없음) ----------
const API_KEY = 'sk-ant-SW-TEST-KEY-9876';
const aiManualJson = (title = '자료실') => JSON.stringify({
  title, role: '업무 자료 파일을 찾고 올리는 화면입니다.',
  features: [{ name: '자료 검색', description: '파일 이름으로 찾습니다.' }],
  howTo: [{ task: '자료 찾기', steps: ['「자료 찾기」를 누릅니다.'], targets: ['#btnFileSearch', '#made-up'] }],
  tips: [],
});
function apiReturning(make) {
  const calls = [];
  globalThis.__apiHandler = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return make(calls.length);
  };
  return calls;
}
const apiOk = text => ({ ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }) });
const allowLocal = (extra = {}) => ({
  installType: 'normal', // 데모 매뉴얼 없이 AI 경로를 시험
  local: { settings: { model: 'claude-haiku-5-5', aiAllowedOrigins: ['http://localhost:8787'] }, apiKey: API_KEY, ...extra },
});
const states = () => updates().map(m => `${m.state}${m.source ? `:${m.source}` : ''}${m.error ? `:${m.error.code}` : ''}`);

test('AI 미허용(설정에 origin 없음) → none(ai-not-allowed), API 호출 없음', async () => {
  const calls = apiReturning(() => apiOk(aiManualJson()));
  await loadWorker({ installType: 'normal', local: { apiKey: API_KEY } });
  navigate(5, `${L}/nomanual`);
  await settle();
  assert.deepEqual(states(), ['none']);
  assert.equal(updates()[0].canEnableAi, true);
  assert.equal(calls.length, 0);
  delete globalThis.__apiHandler;
});

test('AI 허용 origin이어도 host 권한이 없으면 none(ai-not-allowed)', async () => {
  const calls = apiReturning(() => apiOk(aiManualJson()));
  await loadWorker(allowLocal({ settings: { model: 'm', aiAllowedOrigins: ['https://example.com'] } }));
  navigate(5, 'https://example.com/a');
  await settle();
  assert.deepEqual(states(), ['none']);
  assert.equal(calls.length, 0);
  delete globalThis.__apiHandler;
});

test('AI 허용 + 키 없음 → error(NO_API_KEY), 크래시·호출 없음', async () => {
  const calls = apiReturning(() => apiOk(aiManualJson()));
  await loadWorker({ installType: 'normal', local: { settings: { aiAllowedOrigins: ['http://localhost:8787'] } } });
  navigate(5, `${L}/nomanual`);
  await settle();
  assert.deepEqual(states(), ['error:NO_API_KEY']);
  assert.equal(calls.length, 0);
  delete globalThis.__apiHandler;
});

test('AI 생성: loading → ready(ai), 캐시 저장, 요청 본문에 키·쿼리 없음, 대상 선택자 정리', async () => {
  const calls = apiReturning(() => apiOk('```json\n' + aiManualJson() + '\n```'));
  await loadWorker(allowLocal());
  navigate(5, `${L}/nomanual?q=SECRET-QUERY`);
  await settle();
  await wait(100);
  assert.deepEqual(states(), ['loading:ai', 'ready:ai']);
  const ready = updates()[1];
  assert.equal(ready.page.source, 'ai');
  assert.deepEqual(ready.page.howTo[0].targets, ['#btnFileSearch']);
  assert.ok(Number.isFinite(ready.generatedAt));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers['x-api-key'], API_KEY);
  assert.ok(!calls[0].init.body.includes(API_KEY));
  assert.ok(!calls[0].init.body.includes('SECRET-QUERY'));
  assert.equal(JSON.parse(calls[0].body.messages[0].content).url, `${L}/nomanual`);
  assert.ok(chrome.storage.local._data[`ai:${L}/nomanual`]);
  assert.equal(chrome._session.get('tab:5').state.state, 'ready');
  // GET은 저장된 ready를 돌려준다
  assert.equal((await ask({ type: MSG.GET_CURRENT_MANUAL, tabId: 5 })).source, 'ai');
  delete globalThis.__apiHandler;
});

test('캐시 공유: /notice/101 생성 후 /notice/102는 ai-cache, API 1회', async () => {
  const calls = apiReturning(() => apiOk(aiManualJson('공지 상세')));
  await loadWorker(allowLocal());
  navigate(5, `${L}/notice/101`);
  await settle();
  await wait(100);
  navigate(5, `${L}/notice/102`);
  await settle();
  assert.deepEqual(states(), ['loading:ai', 'ready:ai', 'ready:ai-cache']);
  assert.equal(calls.length, 1);
  delete globalThis.__apiHandler;
});

test('생성 중 다른 페이지로 이동하면 늦은 결과가 현재 상태를 덮지 않고 캐시만 남는다', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const calls = apiReturning(async () => { await gate; return apiOk(aiManualJson()); });
  await loadWorker(allowLocal());
  // 생성 중에 다른 페이지(chrome://)로 이동한다.
  navigate(5, `${L}/nomanual`);
  await settle();
  navigate(5, 'chrome://extensions/');
  await settle();
  release();
  await wait(100);
  assert.deepEqual(states(), ['loading:ai', 'none']);
  assert.equal(chrome._session.get('tab:5').state.reason, 'unsupported-url');
  assert.ok(chrome.storage.local._data[`ai:${L}/nomanual`], '결과는 캐시에 남는다');
  assert.equal(calls.length, 1);
  delete globalThis.__apiHandler;
});

test('API 오류(401·429·깨진 JSON·스키마 위반·네트워크) → error 상태, 캐시 없음, 다음 이동에서 재시도', async () => {
  const cases = [
    [() => ({ ok: false, status: 401, json: async () => ({ error: { type: 'authentication_error' } }) }), 'API_UNAUTHORIZED'],
    [() => ({ ok: false, status: 429, json: async () => ({ error: { type: 'rate_limit_error' } }) }), 'API_RATE_LIMITED'],
    [() => apiOk('{"title": '), 'INVALID_RESPONSE'],
    [() => apiOk(JSON.stringify({ title: '', role: 'x', features: [], howTo: [] })), 'INVALID_RESPONSE'],
    [() => { throw new TypeError('Failed to fetch'); }, 'NETWORK'],
  ];
  for (const [make, code] of cases) {
    apiReturning(make);
    await loadWorker(allowLocal());
    navigate(5, `${L}/nomanual`);
    await settle();
    await wait(80);
    assert.deepEqual(states(), ['loading:ai', `error:${code}`], code);
    const err = updates()[1].error;
    assert.ok(!err.message.includes(API_KEY), err.message);
    assert.equal(chrome.storage.local._data[`ai:${L}/nomanual`], undefined);
  }
  // error 상태는 같은 URL 이벤트에서도 다시 결정된다(복구)
  apiReturning(() => apiOk(aiManualJson()));
  chrome.tabs.onUpdated.fire(5, { status: 'complete' }, chrome._tabs.get(5));
  await settle();
  await wait(80);
  assert.deepEqual(states().slice(-2), ['loading:ai', 'ready:ai']);
  delete globalThis.__apiHandler;
});

test('REGENERATE_MANUAL: 작성 매뉴얼·미허용 페이지는 NOT_AI_ELIGIBLE, AI 페이지는 캐시 무시하고 다시 호출', async () => {
  const calls = apiReturning(n => apiOk(aiManualJson(`자료실 ${n}`)));
  await loadWorker(allowLocal());
  navigate(5, `${L}/nomanual`);
  await settle();
  await wait(80);
  assert.equal(calls.length, 1);
  const r = await ask({ type: MSG.REGENERATE_MANUAL, tabId: 5 });
  assert.deepEqual(r, { ok: true });
  await wait(150);
  assert.equal(calls.length, 2, '캐시가 있어도 다시 부른다');
  assert.deepEqual(states().slice(-2), ['loading:ai', 'ready:ai']);
  assert.equal(updates().at(-1).page.title, '자료실 2');
  assert.equal(chrome.storage.local._data[`ai:${L}/nomanual`].page.title, '자료실 2');

  setTab(6, 'https://example.com/');
  assert.equal((await ask({ type: MSG.REGENERATE_MANUAL, tabId: 6 })).error.code, 'NOT_AI_ELIGIBLE');
  setTab(7, 'chrome://extensions/');
  assert.equal((await ask({ type: MSG.REGENERATE_MANUAL, tabId: 7 })).error.code, 'NOT_AI_ELIGIBLE');
  assert.equal((await ask({ type: MSG.REGENERATE_MANUAL, tabId: 999 })).error.code, 'NOT_AI_ELIGIBLE');
  delete globalThis.__apiHandler;

  await loadWorker(); // 개발 설치: 데모 매뉴얼 있음
  setTab(8, `${L}/`);
  assert.equal((await ask({ type: MSG.REGENERATE_MANUAL, tabId: 8 })).error.code, 'NOT_AI_ELIGIBLE', '작성 매뉴얼 페이지');
});

test('워커 재시작으로 남은 loading 상태는 GET에서 다시 결정한다', async () => {
  const calls = apiReturning(() => apiOk(aiManualJson()));
  await loadWorker(allowLocal());
  setTab(5, `${L}/nomanual`);
  chrome._session.set('tab:5', { dedupeKey: `${L}/nomanual`, state: { tabId: 5, windowId: 1, url: `${L}/nomanual`, state: 'loading', source: 'ai' }, updatedAt: 1 });
  const r = await ask({ type: MSG.GET_CURRENT_MANUAL, tabId: 5 });
  assert.equal(r.state, 'loading');
  await wait(100);
  assert.equal(calls.length, 1);
  assert.equal(chrome._session.get('tab:5').state.state, 'ready');
  delete globalThis.__apiHandler;
});

test('작성 매뉴얼이 있으면 AI 허용 사이트여도 AI를 부르지 않는다', async () => {
  const calls = apiReturning(() => apiOk(aiManualJson()));
  await loadWorker({ local: { settings: { aiAllowedOrigins: ['http://localhost:8787'] }, apiKey: API_KEY } });
  navigate(5, `${L}/`);
  await settle();
  assert.deepEqual(states(), ['ready:authored']);
  assert.equal(calls.length, 0);
  delete globalThis.__apiHandler;
});
