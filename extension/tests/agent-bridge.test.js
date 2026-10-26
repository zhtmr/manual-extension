import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  webOrigin, sanitizeSelectors, highlightInTab, clearHighlightInTab, extractPageStructure, AgentError,
} from '../src/background/agent-bridge.js';

let calls;
function fakeChrome({ tabs = {}, granted = [], injectFails = false, agent = null } = {}) {
  calls = { contains: [], inject: [], send: [] };
  globalThis.chrome = {
    tabs: {
      get: async id => { if (!(id in tabs)) throw new Error('No tab'); return { id, url: tabs[id] }; },
      sendMessage: async (tabId, msg, opts) => {
        calls.send.push({ tabId, msg, opts });
        if (!agent) throw new Error('Could not establish connection. Receiving end does not exist.');
        return agent(msg);
      },
    },
    permissions: {
      contains: async ({ origins }) => { calls.contains.push(origins); return origins.every(o => granted.includes(o)); },
    },
    scripting: {
      executeScript: async arg => { calls.inject.push(arg); if (injectFails) throw new Error('Cannot access contents'); return [{}]; },
    },
  };
}
beforeEach(() => fakeChrome());
afterEach(() => { delete globalThis.chrome; });

test('webOrigin / sanitizeSelectors', () => {
  assert.equal(webOrigin('http://localhost:8787/a?b#c'), 'http://localhost:8787');
  assert.equal(webOrigin('chrome://extensions/'), null);
  assert.equal(webOrigin('nope'), null);
  assert.deepEqual(sanitizeSelectors(['#a', '', '  ', 3, null, 'x'.repeat(501), '##bad[']), ['#a', '##bad[']);
  assert.equal(sanitizeSelectors(Array.from({ length: 30 }, (_, i) => `#s${i}`)).length, 20);
  assert.deepEqual(sanitizeSelectors('nope'), []);
});

test('HIGHLIGHT: 권한 확인 → 최상위 프레임에 주입 → 메시지 → { found }', async () => {
  fakeChrome({ tabs: { 5: 'http://localhost:8787/spa/orders/new' }, granted: ['http://localhost:8787/*'], agent: () => ({ found: 2 }) });
  assert.deepEqual(await highlightInTab(5, ['#btnSave', '#nope']), { found: 2 });
  assert.deepEqual(calls.contains, [['http://localhost:8787/*']]);
  assert.deepEqual(calls.inject, [{ target: { tabId: 5, frameIds: [0] }, files: ['src/content/page-agent.js'] }]);
  assert.deepEqual(calls.send, [{ tabId: 5, msg: { type: 'HIGHLIGHT', selectors: ['#btnSave', '#nope'] }, opts: { frameId: 0 } }]);
});

test('HIGHLIGHT: host 권한이 없으면 주입하지 않고 NO_HOST_PERMISSION', async () => {
  fakeChrome({ tabs: { 5: 'https://example.com/' }, granted: [] });
  const r = await highlightInTab(5, ['#a']);
  assert.equal(r.found, 0);
  assert.equal(r.error.code, 'NO_HOST_PERMISSION');
  assert.deepEqual(calls.inject, []);
  assert.deepEqual(calls.send, []);
});

test('HIGHLIGHT: 웹 페이지가 아니거나 주입·응답 실패면 INJECT_FAILED, 탭 없으면 TAB_NOT_FOUND', async () => {
  fakeChrome({ tabs: { 6: 'chrome://extensions/' } });
  assert.equal((await highlightInTab(6, ['#a'])).error.code, 'INJECT_FAILED');
  assert.deepEqual(calls.contains, []);

  fakeChrome({ tabs: { 5: 'http://localhost:8787/' }, granted: ['http://localhost:8787/*'], injectFails: true });
  assert.equal((await highlightInTab(5, ['#a'])).error.code, 'INJECT_FAILED');

  fakeChrome({ tabs: { 5: 'http://localhost:8787/' }, granted: ['http://localhost:8787/*'], agent: null });
  assert.equal((await highlightInTab(5, ['#a'])).error.code, 'INJECT_FAILED');

  fakeChrome({});
  assert.equal((await highlightInTab(99, ['#a'])).error.code, 'TAB_NOT_FOUND');
});

test('HIGHLIGHT: 에이전트 응답이 이상하면 found 0', async () => {
  fakeChrome({ tabs: { 5: 'http://localhost:8787/' }, granted: ['http://localhost:8787/*'], agent: () => ({ found: 'many' }) });
  assert.deepEqual(await highlightInTab(5, ['#a']), { found: 0 });
});

test('CLEAR_HIGHLIGHT: 주입·권한 확인 없이 기존 에이전트에만 보내고, 없어도 { ok: true }', async () => {
  fakeChrome({ tabs: { 5: 'https://example.com/' } });
  assert.deepEqual(await clearHighlightInTab(5), { ok: true });
  assert.deepEqual(calls.inject, []);
  assert.deepEqual(calls.contains, []);
  assert.equal(calls.send[0].msg.type, 'CLEAR_HIGHLIGHT');
  assert.deepEqual(calls.send[0].opts, { frameId: 0 });
  assert.deepEqual(await clearHighlightInTab(999), { ok: true });
});

test('extractPageStructure: 정상 응답, 실패 응답 → EXTRACT_FAILED, 권한 없음 → NO_HOST_PERMISSION', async () => {
  const structure = { url: 'http://localhost:8787/', title: 't', headings: [], nav: [], buttons: [], fields: [], tables: [], notices: [] };
  fakeChrome({ tabs: { 5: 'http://localhost:8787/' }, granted: ['http://localhost:8787/*'], agent: () => structure });
  assert.deepEqual(await extractPageStructure(5), structure);
  assert.equal(calls.send[0].msg.type, 'EXTRACT_PAGE');

  for (const bad of [{ ok: false, error: { code: 'EXTRACT_FAILED' } }, null, { title: 'no url' }]) {
    fakeChrome({ tabs: { 5: 'http://localhost:8787/' }, granted: ['http://localhost:8787/*'], agent: () => bad });
    await assert.rejects(extractPageStructure(5), e => e instanceof AgentError && e.code === 'EXTRACT_FAILED');
  }
  fakeChrome({ tabs: { 5: 'https://example.com/' } });
  await assert.rejects(extractPageStructure(5), e => e.code === 'NO_HOST_PERMISSION');
});
