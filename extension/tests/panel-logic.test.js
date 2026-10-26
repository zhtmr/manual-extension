import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parsePinnedTabId, acceptsUpdate, isRenderableState, badgeFor, isAiSource,
  errorGuide, noneGuide, formatDate, displayUrl, highlightGuide, webOrigin, aiConsentText,
} from '../src/sidepanel/panel-logic.js';
import { ERROR_CODE } from '../src/shared/constants.js';

test('parsePinnedTabId', () => {
  assert.equal(parsePinnedTabId('?tabId=12'), 12);
  assert.equal(parsePinnedTabId('?x=1&tabId=0'), 0);
  for (const s of ['', '?tabId=', '?tabId=-1', '?tabId=1.5', '?tabId=abc', '?tabId=99999999999999999999', undefined]) {
    assert.equal(parsePinnedTabId(s), null, String(s));
  }
});

test('acceptsUpdate: 최상위 tabId·windowId로 판단', () => {
  const t = { tabId: 5, windowId: 1, pinned: false };
  assert.equal(acceptsUpdate({ type: 'MANUAL_UPDATED', tabId: 5, windowId: 1, state: 'ready' }, t), true);
  assert.equal(acceptsUpdate({ tabId: 6, windowId: 1 }, t), false, '다른 탭');
  assert.equal(acceptsUpdate({ tabId: 5, windowId: 2 }, t), false, '다른 창의 패널');
  assert.equal(acceptsUpdate({ tabId: 5, windowId: null }, t), true, 'windowId를 모르면 tabId로');
  assert.equal(acceptsUpdate({ state: { tabId: 5, windowId: 1 } }, t), false, '중첩으로 읽지 않는다');
  assert.equal(acceptsUpdate({ tabId: 5, windowId: 9 }, { tabId: 5, windowId: null, pinned: true }), true, '고정 모드는 windowId 무시');
  assert.equal(acceptsUpdate({ tabId: 5 }, { tabId: null }), false);
  assert.equal(acceptsUpdate(null, t), false);
});

test('isRenderableState: GET 응답은 tabId와 state만 본다(windowId 무시)', () => {
  assert.equal(isRenderableState({ tabId: 5, windowId: 99, state: 'ready' }, 5), true);
  assert.equal(isRenderableState({ tabId: 5, state: 'error', error: { code: 'X' } }, 5), true);
  assert.equal(isRenderableState({ tabId: 6, state: 'ready' }, 5), false);
  assert.equal(isRenderableState({ tabId: 5, state: 'weird' }, 5), false);
  assert.equal(isRenderableState(null, 5), false);
  assert.equal(isRenderableState(undefined, 5), false);
  assert.equal(isRenderableState('__no_response__', 5), false);
});

test('badgeFor / isAiSource', () => {
  assert.deepEqual(badgeFor({ state: 'ready', source: 'authored' }), { label: '작성됨', kind: 'authored' });
  assert.deepEqual(badgeFor({ state: 'ready', source: 'ai' }), { label: 'AI 생성', kind: 'ai' });
  assert.deepEqual(badgeFor({ state: 'ready', source: 'ai-cache' }), { label: 'AI 생성', kind: 'ai' });
  assert.deepEqual(badgeFor({ state: 'none' }), { label: '없음', kind: 'none' });
  assert.equal(badgeFor({ state: 'loading' }), null);
  assert.equal(badgeFor({ state: 'error' }), null);
  assert.equal(badgeFor(null), null);
  assert.equal(isAiSource({ source: 'ai-cache' }), true);
  assert.equal(isAiSource({ source: 'authored' }), false);
});

test('errorGuide: 코드별 안내와 동작', () => {
  assert.equal(errorGuide({ code: 'NO_API_KEY' }).action, 'options');
  assert.equal(errorGuide({ code: 'API_UNAUTHORIZED' }).title, 'API 키를 확인하세요');
  assert.equal(errorGuide({ code: 'API_UNAUTHORIZED' }).action, 'options');
  assert.equal(errorGuide({ code: 'API_RATE_LIMITED' }).title, '잠시 후 다시 시도하세요');
  assert.equal(errorGuide({ code: 'TAB_NOT_FOUND' }).action, 'reselect');
  assert.equal(errorGuide({ code: 'SOMETHING_NEW' }).action, 'retry');
  assert.equal(errorGuide(undefined).action, 'retry');
  for (const code of Object.values(ERROR_CODE)) {
    const g = errorGuide({ code });
    assert.ok(g.title && g.detail && ['options', 'retry', 'reselect'].includes(g.action), code);
  }
});

test('noneGuide: 이유별 안내', () => {
  const u = noneGuide({ state: 'none', reason: 'unsupported-url', canEnableAi: false });
  assert.equal(u.showEnableAi, false);
  assert.match(u.title, /볼 수 없습니다/);
  const a = noneGuide({ state: 'none', reason: 'ai-not-allowed', canEnableAi: true });
  assert.equal(a.showEnableAi, true);
  assert.match(a.title, /작성된 매뉴얼이 없습니다/);
  assert.equal(noneGuide({ state: 'none', reason: 'ai-not-allowed', canEnableAi: false }).showEnableAi, false);
});

test('formatDate / displayUrl', () => {
  assert.equal(formatDate(new Date(2026, 9, 3, 12).getTime()), '2026-10-03');
  assert.equal(formatDate(undefined), '');
  assert.equal(formatDate(NaN), '');
  assert.equal(displayUrl('http://localhost:8787/notice/101?q=SECRET#guide'), 'localhost:8787/notice/101');
  assert.equal(displayUrl('http://localhost:8787/hash#/inbox'), 'localhost:8787/hash#/inbox');
  assert.equal(displayUrl('chrome://extensions/'), 'chrome://extensions/');
  assert.equal(displayUrl('not a url'), 'not a url');
});

test('사이드 패널 소스: innerHTML·outerHTML·insertAdjacentHTML 없음, 원격 리소스·인라인 스크립트 없음', () => {
  const read = p => readFileSync(new URL(`../src/sidepanel/${p}`, import.meta.url), 'utf8');
  for (const f of ['sidepanel.js', 'panel-logic.js']) {
    assert.doesNotMatch(read(f), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, f);
  }
  const html = read('sidepanel.html');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>\s*\S/);
  assert.doesNotMatch(html, /(src|href)=["'](https?:)?\/\//);
  const css = read('sidepanel.css');
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.doesNotMatch(css, /@import|url\(\s*["']?https?:/);
});

test('highlightGuide: HIGHLIGHT 응답별 안내', () => {
  assert.deepEqual(highlightGuide({ found: 2 }), { kind: 'ok', text: '화면에 2곳을 표시했습니다.' });
  assert.deepEqual(highlightGuide({ found: 0 }), { kind: 'notFound', text: '화면에서 요소를 찾지 못했습니다.' });
  assert.equal(highlightGuide({ found: 0, error: { code: 'NO_HOST_PERMISSION' } }).kind, 'needPermission');
  assert.equal(highlightGuide({ found: 0, error: { code: 'INJECT_FAILED' } }).kind, 'unavailable');
  assert.equal(highlightGuide({ found: 0, error: { code: 'TAB_NOT_FOUND' } }).text, '대상 탭을 찾을 수 없습니다.');
  for (const bad of [null, undefined, '__no_response__', {}, { found: 'x' }]) assert.equal(highlightGuide(bad).kind, 'unavailable');
});

test('webOrigin: http(s)만 권한 요청 대상', () => {
  assert.equal(webOrigin('http://localhost:8787/spa?x=1#/a'), 'http://localhost:8787');
  assert.equal(webOrigin('https://gw.example.com/a'), 'https://gw.example.com');
  assert.equal(webOrigin('chrome://extensions/'), null);
  assert.equal(webOrigin(undefined), null);
});

test('aiConsentText: origin, 보내는 것·보내지 않는 것, 본인 키·권한 요청 안내', () => {
  const t = aiConsentText('https://gw.example.com').join(' ');
  for (const w of ['https://gw.example.com', 'Claude API', '보내는 것', '보내지 않는 것', '입력한 값', '비밀번호', '표 내용', '검색어', 'API 키', '권한']) {
    assert.ok(t.includes(w), w);
  }
});
