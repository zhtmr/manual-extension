// ai-manual.js: 가짜 fetch·storage·now로 Claude API 호출, 검증, 캐시를 확인한다. 실제 API는 부르지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AiError, SYSTEM_PROMPT, sanitizeStructure, buildRequestBody, callClaude, parseManualJson, buildAiPage,
  readCache, writeCache, clearAiCache, listCacheKeys, generateAiManual, structureUrl,
} from '../src/background/ai-manual.js';
import { DEFAULT_MODEL, AI_CACHE_TTL_MS, AI_CACHE_MAX } from '../src/shared/constants.js';
import { validatePage } from '../src/shared/manual-schema.js';

const KEY = 'sk-ant-TEST-SECRET-KEY-1234';
const URL_ = 'http://localhost:8787/nomanual?q=SECRET-QUERY#guide';

const structure = () => ({
  url: 'http://localhost:8787/nomanual',
  title: '자료실',
  headings: [{ level: 1, text: '자료실' }],
  nav: ['홈', '공지사항'],
  buttons: [{ text: '자료 찾기', selector: '#btnFileSearch' }, { text: '자료 올리기', selector: '#btnUpload' }],
  fields: [{ label: '파일 이름', type: 'text', placeholder: '파일 이름 일부', selector: '#fileKeyword' }],
  tables: [{ caption: '자료 목록', headers: ['파일', '올린 날짜'] }],
  notices: ['이 페이지에는 작성된 매뉴얼이 없습니다.'],
});

const goodManual = () => ({
  title: '자료실',
  role: '업무 자료 파일을 찾고 새 자료를 올리는 화면입니다.',
  features: [{ name: '자료 검색', description: '파일 이름 일부로 자료를 찾습니다.' }],
  howTo: [
    { task: '자료 찾기', steps: ['「파일 이름」에 일부를 입력합니다.', '「자료 찾기」를 누릅니다.'], targets: ['#fileKeyword', '#btnFileSearch', '#invented', 'body > div:nth-child(3)'] },
    { task: '자료 올리기', steps: ['「자료 올리기」를 누릅니다.'] },
  ],
  tips: ['파일 이름 일부만 입력해도 됩니다.'],
});

// 가짜 fetch: 호출 기록 + 지정 응답
function fakeFetch(respond) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return respond(url, init, calls.length);
  };
  fn.calls = calls;
  return fn;
}
const jsonRes = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const okText = text => jsonRes(200, {
  id: 'msg_1', type: 'message', role: 'assistant', stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }],
});

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      if (keys === null) return { ...data };
      const ks = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(ks.filter(k => k in data).map(k => [k, structuredClone(data[k])]));
    },
    async set(obj) { Object.assign(data, structuredClone(obj)); },
    async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; },
  };
}

const NOW = new Date(2026, 9, 23, 10).getTime();
const deps = (fetchImpl, extra = {}) => ({
  storage: fakeStorage(), fetchImpl, now: () => NOW, extract: async () => structure(), timeoutMs: 200, ...extra,
});
const codeOf = async p => { try { await p; return 'resolved'; } catch (e) { return e instanceof AiError ? e.code : `other:${e?.message}`; } };

test('요청: 헤더 4종, anthropic-version 2026-10-21, 모델·시스템 프롬프트, 샘플링 파라미터 없음', async () => {
  const f = fakeFetch(() => okText(JSON.stringify(goodManual())));
  await callClaude({ apiKey: KEY, model: DEFAULT_MODEL, structure: structure(), fetchImpl: f });
  const { url, init, body } = f.calls[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.method, 'POST');
  assert.deepEqual(init.headers, {
    'content-type': 'application/json',
    'x-api-key': KEY,
    'anthropic-version': '2026-10-21',
    'anthropic-dangerous-direct-browser-access': 'true',
  });
  assert.equal(DEFAULT_MODEL, 'claude-haiku-5-5');
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.equal(body.system, SYSTEM_PROMPT);
  assert.equal(body.max_tokens, 16000);
  assert.deepEqual(body.output_config, { effort: 'low' });
  for (const k of ['temperature', 'top_p', 'top_k', 'thinking']) assert.ok(!(k in body), k);
  assert.deepEqual(JSON.parse(body.messages[0].content), structure());
  assert.ok(init.signal instanceof AbortSignal);
});

test('effort를 받지 않는 구형 모델에는 output_config를 보내지 않는다', () => {
  assert.ok(!('output_config' in buildRequestBody({ model: 'claude-haiku-4-5', structure: {} })));
  assert.ok('output_config' in buildRequestBody({ model: 'claude-sonnet-5-5', structure: {} }));
});

test('전송 구조 정리: 쿼리·SECRET·개인정보 제거, 계약 키만, 한도', () => {
  const dirty = {
    ...structure(),
    url: 'http://localhost:8787/x?q=SECRET-QUERY',
    title: '담당 hong@corp.com',
    extra: 'SECRET-EXTRA-KEY',
    nav: Array.from({ length: 80 }, (_, i) => `메뉴 ${i} ${'가'.repeat(200)}`),
    buttons: [{ text: '호출 010-1234-5678', selector: '#emp-1234567', value: 'SECRET-VALUE' }],
    fields: [{ label: '메일', type: 'text', placeholder: '', selector: 'input[name="a@b.com"]', value: 'SECRET-VALUE' }],
  };
  const s = sanitizeStructure(dirty, URL_);
  const json = JSON.stringify(s);
  assert.deepEqual(Object.keys(s), ['url', 'title', 'headings', 'nav', 'buttons', 'fields', 'tables', 'notices']);
  assert.equal(s.url, 'http://localhost:8787/nomanual', '탭 URL 기준, 쿼리·앵커 없음');
  for (const bad of ['SECRET', 'hong', '1234-5678', '1234567', 'a@b']) assert.ok(!json.includes(bad), bad);
  assert.equal(s.nav.length, 50);
  assert.ok(s.nav.every(n => n.length <= 120));
  assert.equal(s.buttons[0].selector, '', '개인정보가 든 선택자는 비운다');
  assert.equal(structureUrl('http://h/users/kim@corp.com/1#!/mail/77?x=1'), 'http://h/users/*/*#/mail/*');
});

test('정상 응답 → 검증·대상 정리·채움(source ai), thinking 블록 무시', async () => {
  const text = await callClaude({ apiKey: KEY, model: DEFAULT_MODEL, structure: structure(), fetchImpl: fakeFetch(() => okText(JSON.stringify(goodManual()))) });
  const page = buildAiPage(parseManualJson(text), structure(), URL_, NOW);
  assert.deepEqual(page.howTo[0].targets, ['#fileKeyword', '#btnFileSearch'], '구조에 없던 선택자 제거');
  assert.ok(!('targets' in page.howTo[1]));
  assert.equal(page.id, 'http://localhost:8787/nomanual');
  assert.deepEqual(page.match, { type: 'glob', pattern: '/nomanual' });
  assert.deepEqual(page.related, []);
  assert.equal(page.updatedAt, '2026-10-23');
  assert.equal(page.source, 'ai');
  assert.deepEqual(validatePage(page, { full: false }), []);
  const hashPage = buildAiPage(goodManual(), structure(), 'http://h/app#/mail/123', NOW);
  assert.deepEqual(hashPage.match, { type: 'glob', pattern: '/mail/*', hash: true });
  assert.equal(buildAiPage(goodManual(), structure(), 'http://h/notice/101/', NOW).match.pattern, '/notice/*');
});

test('코드펜스·앞뒤 설명이 있어도 JSON을 꺼낸다', () => {
  const m = goodManual();
  assert.deepEqual(parseManualJson('```json\n' + JSON.stringify(m) + '\n```'), m);
  assert.deepEqual(parseManualJson('다음은 매뉴얼입니다.\n```\n' + JSON.stringify(m) + '\n```\n끝'), m);
  assert.deepEqual(parseManualJson('설명 ' + JSON.stringify(m) + ' 끝'), m);
});

test('깨진 JSON·스키마 위반 → INVALID_RESPONSE이고 캐시하지 않는다', async () => {
  for (const text of ['{"title": "자료실", "role": ', '매뉴얼을 만들 수 없습니다.', '[1,2,3]',
    JSON.stringify({ ...goodManual(), title: '가'.repeat(61) }),
    JSON.stringify({ ...goodManual(), howTo: [] }),
    JSON.stringify({ ...goodManual(), features: 'x' })]) {
    const d = deps(fakeFetch(() => okText(text)));
    assert.equal(await codeOf(generateAiManual({ url: URL_, tabId: 1, apiKey: KEY, model: DEFAULT_MODEL, deps: d })), 'INVALID_RESPONSE', text.slice(0, 30));
    assert.deepEqual(await listCacheKeys(d.storage), []);
  }
});

test('HTTP 오류 매핑: 401·403 → API_UNAUTHORIZED, 429·529 → API_RATE_LIMITED, 기타 → API_ERROR', async () => {
  const cases = [[401, 'API_UNAUTHORIZED'], [403, 'API_UNAUTHORIZED'], [429, 'API_RATE_LIMITED'], [529, 'API_RATE_LIMITED'], [500, 'API_ERROR'], [400, 'API_ERROR']];
  for (const [status, code] of cases) {
    const f = fakeFetch(() => jsonRes(status, { type: 'error', error: { type: 'some_error', message: `echo ${KEY} SECRET body` } }));
    let err;
    try { await callClaude({ apiKey: KEY, model: DEFAULT_MODEL, structure: structure(), fetchImpl: f }); } catch (e) { err = e; }
    assert.equal(err.code, code, String(status));
    assert.ok(err.message.includes(`HTTP ${status}`));
    assert.ok(!err.message.includes(KEY) && !err.message.includes('SECRET') && !err.message.includes('echo'), err.message);
  }
});

test('네트워크 오류 → NETWORK, 타임아웃 → TIMEOUT, 거절·잘림·빈 응답', async () => {
  const net = fakeFetch(async () => { throw new TypeError(`Failed to fetch ${KEY}`); });
  assert.equal(await codeOf(callClaude({ apiKey: KEY, model: 'm', structure: {}, fetchImpl: net })), 'NETWORK');
  const hang = async (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
  const t0 = Date.now();
  assert.equal(await codeOf(callClaude({ apiKey: KEY, model: 'm', structure: {}, fetchImpl: hang, timeoutMs: 80 })), 'TIMEOUT');
  assert.ok(Date.now() - t0 < 2000);
  const refusal = fakeFetch(() => jsonRes(200, { stop_reason: 'refusal', content: [] }));
  assert.equal(await codeOf(callClaude({ apiKey: KEY, model: 'm', structure: {}, fetchImpl: refusal })), 'API_ERROR');
  const cut = fakeFetch(() => jsonRes(200, { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{' }] }));
  assert.equal(await codeOf(callClaude({ apiKey: KEY, model: 'm', structure: {}, fetchImpl: cut })), 'INVALID_RESPONSE');
  const empty = fakeFetch(() => jsonRes(200, { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }] }));
  assert.equal(await codeOf(callClaude({ apiKey: KEY, model: 'm', structure: {}, fetchImpl: empty })), 'INVALID_RESPONSE');
  const notJson = fakeFetch(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }));
  assert.equal(await codeOf(callClaude({ apiKey: KEY, model: 'm', structure: {}, fetchImpl: notJson })), 'INVALID_RESPONSE');
});

test('generateAiManual: 정상 → 캐시 저장, 요청 본문에 SECRET·쿼리·키 없음', async () => {
  const f = fakeFetch(() => okText(JSON.stringify(goodManual())));
  const d = deps(f, { extract: async () => ({ ...structure(), title: '자료실 SECRET-x 010-1111-2222', url: URL_ }) });
  const r = await generateAiManual({ url: URL_, tabId: 1, apiKey: KEY, model: DEFAULT_MODEL, deps: d });
  assert.equal(r.page.source, 'ai');
  assert.equal(r.createdAt, NOW);
  assert.equal(r.model, DEFAULT_MODEL);
  const cached = await readCache(d.storage, 'http://localhost:8787/nomanual', NOW);
  assert.deepEqual(cached, r);
  assert.ok(!f.calls[0].init.body.includes('SECRET-QUERY'));
  assert.ok(!f.calls[0].init.body.includes('1111-2222'));
  assert.ok(!f.calls[0].init.body.includes(KEY));
  assert.ok(!f.calls[0].init.body.includes('?q='));
});

test('generateAiManual: 키 없음 → NO_API_KEY(호출 없음), 추출 실패 코드 전달', async () => {
  const f = fakeFetch(() => okText('{}'));
  assert.equal(await codeOf(generateAiManual({ url: URL_, tabId: 1, apiKey: '', model: 'm', deps: deps(f) })), 'NO_API_KEY');
  assert.equal(f.calls.length, 0);
  const noPerm = deps(f, { extract: async () => { throw Object.assign(new Error('x'), { code: 'NO_HOST_PERMISSION' }); } });
  assert.equal(await codeOf(generateAiManual({ url: URL_, tabId: 1, apiKey: KEY, model: 'm', deps: noPerm })), 'NO_HOST_PERMISSION');
  const weird = deps(f, { extract: async () => { throw new Error('boom'); } });
  assert.equal(await codeOf(generateAiManual({ url: URL_, tabId: 1, apiKey: KEY, model: 'm', deps: weird })), 'EXTRACT_FAILED');
  assert.equal(f.calls.length, 0);
});

test('같은 aiCacheKey의 동시 생성은 API를 한 번만 부른다(/notice/101과 /notice/102)', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const f = fakeFetch(async () => { await gate; return okText(JSON.stringify(goodManual())); });
  const d = deps(f);
  const a = generateAiManual({ url: 'http://h/notice/101', tabId: 1, apiKey: KEY, model: 'm', deps: d });
  const b = generateAiManual({ url: 'http://h/notice/102', tabId: 2, apiKey: KEY, model: 'm', deps: d });
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(f.calls.length, 1);
  assert.equal(ra, rb);
  // 끝난 뒤에는 새로 부른다(캐시 확인은 호출하는 쪽 책임)
  await generateAiManual({ url: 'http://h/notice/103', tabId: 1, apiKey: KEY, model: 'm', deps: d });
  assert.equal(f.calls.length, 2);
});

test('캐시: 7일 이내만 유효, 깨진 항목 무시', async () => {
  const s = fakeStorage({ 'ai:http://h/a': { page: { title: 'x' }, createdAt: NOW - AI_CACHE_TTL_MS + 1000, model: 'm' },
    'ai:http://h/old': { page: { title: 'x' }, createdAt: NOW - AI_CACHE_TTL_MS - 1, model: 'm' },
    'ai:http://h/bad': { createdAt: 'x' } });
  assert.ok(await readCache(s, 'http://h/a', NOW));
  assert.equal(await readCache(s, 'http://h/old', NOW), null);
  assert.equal(await readCache(s, 'http://h/bad', NOW), null);
  assert.equal(await readCache(s, 'http://h/none', NOW), null);
});

test(`캐시: ${AI_CACHE_MAX}건을 넘으면 createdAt이 오래된 것부터 삭제, 다른 키는 그대로`, async () => {
  const init = { settings: { model: 'm' }, apiKey: KEY };
  for (let i = 0; i < AI_CACHE_MAX; i++) init[`ai:http://h/p${i}`] = { page: {}, createdAt: 1000 + i, model: 'm' };
  const s = fakeStorage(init);
  await writeCache(s, 'http://h/new1', { page: {}, createdAt: 9_999_999, model: 'm' });
  await writeCache(s, 'http://h/new2', { page: {}, createdAt: 9_999_998, model: 'm' });
  const keys = await listCacheKeys(s);
  assert.equal(keys.length, AI_CACHE_MAX);
  assert.ok(!keys.includes('ai:http://h/p0') && !keys.includes('ai:http://h/p1'));
  assert.ok(keys.includes('ai:http://h/p2') && keys.includes('ai:http://h/new1') && keys.includes('ai:http://h/new2'));
  assert.ok('settings' in s.data && 'apiKey' in s.data);
});

test('캐시 비우기: 전체 또는 origin 정확히 일치만', async () => {
  const s = fakeStorage({ 'ai:http://a.com/x': 1, 'ai:http://a.com#/y': 1, 'ai:http://a.com:8080/z': 1, 'ai:http://a.community/': 1, other: 1 });
  assert.equal(await clearAiCache(s, 'http://a.com'), 2);
  assert.deepEqual(Object.keys(s.data).sort(), ['ai:http://a.com:8080/z', 'ai:http://a.community/', 'other']);
  assert.equal(await clearAiCache(s), 2);
  assert.deepEqual(Object.keys(s.data), ['other']);
});
