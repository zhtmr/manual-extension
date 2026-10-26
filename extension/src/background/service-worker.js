// 서비스 워커: 페이지 이동 감지 → 매뉴얼 결정 → 패널 통지.
// 리스너는 모두 최상위에서 동기적으로 등록한다(재시작 시 이벤트를 놓치지 않게).
// 탭 상태는 storage.session에 둔다. 메모리에는 다시 만들 수 있는 것(디바운스 타이머, 진행 중 결정·AI 생성 표시,
// 매뉴얼 파일 캐시)만 둔다.
// 결정 흐름(설계 ⑤-3): 웹 페이지가 아님 → 작성 매뉴얼 → AI 허용(사이트 opt-in + host 권한) → 캐시 → API 키 → 생성.
// HIGHLIGHT/CLEAR_HIGHLIGHT 중계와 구조 추출은 agent-bridge.js, AI 생성·캐시는 ai-manual.js.
import { MSG } from '../shared/messages.js';
import { STATE, SOURCE, REASON, ERROR_CODE, NAV_DEBOUNCE_MS, TAB_STATE_PREFIX, TAB_COMPLETE_WAIT_MS } from '../shared/constants.js';
import { dedupeKey, aiCacheKey } from '../shared/matcher.js';
import { getSettings, getApiKey } from '../shared/settings.js';
import { loadManuals, resolveAuthored } from './manual-store.js';
import { highlightInTab, clearHighlightInTab, extractPageStructure, hasHostPermission, webOrigin } from './agent-bridge.js';
import { generateAiManual, readCache } from './ai-manual.js';

// 툴바 아이콘 클릭 = 사이드 패널 열기
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(e => console.warn('[page-manual] setPanelBehavior 실패:', e?.message));

// --- 탭 상태 저장소(storage.session) ---

const stateKey = tabId => `${TAB_STATE_PREFIX}${tabId}`;

async function readTabRecord(tabId) {
  const key = stateKey(tabId);
  const got = await chrome.storage.session.get(key);
  return got[key] ?? null;
}

async function writeTabRecord(tabId, record) {
  await chrome.storage.session.set({ [stateKey(tabId)]: record });
}

async function removeTabRecord(tabId) {
  await chrome.storage.session.remove(stateKey(tabId));
}

// --- 결정 흐름 ---

const isWebUrl = url => /^https?:\/\//i.test(url ?? '');

// 탭별 결정 순번. 늦게 끝난 이전 결정이 최신 결과를 덮지 않게 한다(재시작으로 사라져도 무해).
const decideSeq = new Map();
// 진행 중인 결정: tabId → { key, promise }. 저장 전에 같은 이동 이벤트·탭 전환·패널 요청이 겹쳐도
// 결정(과 MANUAL_UPDATED 전송)을 한 번만 하게 한다.
const inflight = new Map();
// AI 생성을 기다리는 탭. 워커가 재시작되면 비고, 그때 남은 loading 상태는 GET에서 다시 결정한다.
const pendingAi = new Set();

/** 실패를 나타내는 ManualState. 오류 message에는 키·요청 본문을 넣지 않는다. */
function errorState({ tabId, windowId = null, url = '' }, code, message) {
  return { tabId, windowId, url, state: STATE.ERROR, error: { code, message } };
}

/** 작성 매뉴얼이 없을 때 AI 대상인가: 사이트 opt-in(settings.aiAllowedOrigins)과 host 권한이 모두 있어야 한다. */
async function isAiAllowed(url) {
  const origin = webOrigin(url);
  if (!origin) return false;
  const settings = await getSettings();
  return settings.aiAllowedOrigins.includes(origin) && (await hasHostPermission(url));
}

async function waitForTabComplete(tabId) {
  const until = Date.now() + TAB_COMPLETE_WAIT_MS;
  while (Date.now() < until) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || tab.status === 'complete') return;
    await new Promise(r => setTimeout(r, 200));
  }
}

const aiDeps = {
  storage: chrome.storage.local,
  fetchImpl: (...args) => fetch(...args),
  now: () => Date.now(),
  extract: tabId => extractPageStructure(tabId),
  waitForTabComplete,
};

/**
 * 탭의 상태를 계산한다. AI 생성이 필요하면 loading 상태와, 생성 후 최종 상태를 만드는 continuation을 돌려준다.
 * @returns {Promise<{ state: object, continuation?: () => Promise<object> }>}
 */
async function computeState(tab, { regenerate = false } = {}) {
  const url = tab.url || tab.pendingUrl || '';
  const base = { tabId: tab.id, windowId: tab.windowId, url };
  if (!isWebUrl(url)) return { state: { ...base, state: STATE.NONE, reason: REASON.UNSUPPORTED_URL, canEnableAi: false } };

  const siteFiles = await loadManuals();
  const hit = resolveAuthored(siteFiles, url);
  if (hit) {
    return { state: { ...base, state: STATE.READY, source: SOURCE.AUTHORED, siteId: hit.siteId, page: hit.page, related: hit.related } };
  }
  if (!(await isAiAllowed(url))) {
    return { state: { ...base, state: STATE.NONE, reason: REASON.AI_NOT_ALLOWED, canEnableAi: true } };
  }
  const key = aiCacheKey(url);
  if (!regenerate) {
    const cached = await readCache(aiDeps.storage, key, aiDeps.now());
    if (cached) return { state: { ...base, state: STATE.READY, source: SOURCE.AI_CACHE, page: cached.page, generatedAt: cached.createdAt } };
  }
  const apiKey = await getApiKey();
  if (!apiKey) return { state: errorState(base, ERROR_CODE.NO_API_KEY, 'API 키가 없습니다. 설정에서 저장하세요.') };
  const { model } = await getSettings();
  return {
    state: { ...base, state: STATE.LOADING, source: SOURCE.AI },
    continuation: async () => {
      try {
        const r = await generateAiManual({ url, tabId: tab.id, apiKey, model, deps: aiDeps });
        return { ...base, state: STATE.READY, source: SOURCE.AI, page: r.page, generatedAt: r.createdAt };
      } catch (e) {
        const known = typeof e?.code === 'string';
        if (!known) console.warn('[page-manual] AI 생성 중 예외:', e?.name);
        return errorState(base, known ? e.code : ERROR_CODE.INTERNAL_ERROR, known ? e.message : 'AI 매뉴얼을 만드는 중 문제가 생겼습니다.');
      }
    },
  };
}

/**
 * 탭의 매뉴얼 상태를 결정해 storage.session에 저장하고 MANUAL_UPDATED로 알린다.
 * force가 아니면 같은 탭에서 진행 중인 결정을 함께 기다린다. regenerate면 AI 캐시를 무시한다.
 * AI 생성이 필요하면 loading 상태로 먼저 끝나고, 생성 결과는 나중에 MANUAL_UPDATED로 간다.
 * @returns {Promise<object>} ManualState. 실패해도 null이 아니라 state: "error"인 ManualState를 돌려준다
 *   (탭이 없으면 TAB_NOT_FOUND, 예외면 INTERNAL_ERROR).
 */
function decide(tabId, { force = false, regenerate = false } = {}) {
  const running = inflight.get(tabId);
  if (running && !force) return running.promise;
  const seq = (decideSeq.get(tabId) ?? 0) + 1;
  decideSeq.set(tabId, seq);
  const entry = { key: null, promise: null };
  entry.promise = runDecide(tabId, seq, entry, { regenerate }).finally(() => {
    if (inflight.get(tabId) === entry) inflight.delete(tabId);
  });
  inflight.set(tabId, entry);
  return entry.promise;
}

async function saveRecord(tabId, key, state) {
  try {
    // error 상태도 저장한다. 다음 이동 이벤트에서 error는 중복 제거 대상이 아니므로 다시 결정된다.
    await writeTabRecord(tabId, { dedupeKey: key, state, updatedAt: Date.now() });
  } catch (e) {
    console.warn('[page-manual] 탭 상태 저장 실패:', e?.message);
  }
}

async function runDecide(tabId, seq, entry, { regenerate }) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    // 탭이 닫혔다. 저장·전송할 탭이 없으므로 응답용 상태만 돌려준다.
    return errorState({ tabId }, ERROR_CODE.TAB_NOT_FOUND, '대상 탭을 찾을 수 없습니다.');
  }
  const key = dedupeKey(tab.url || tab.pendingUrl || '');
  entry.key = key;
  let result;
  try {
    result = await computeState(tab, { regenerate });
  } catch (e) {
    console.warn('[page-manual] 매뉴얼 결정 실패:', e?.message);
    result = { state: errorState({ tabId, windowId: tab.windowId, url: tab.url || tab.pendingUrl || '' },
      ERROR_CODE.INTERNAL_ERROR, '매뉴얼을 확인하는 중 문제가 생겼습니다.') };
  }
  const { state, continuation } = result;
  // 그사이 더 새 결정이 시작됐으면 저장·전송하지 않고 그 결과를 돌려준다.
  if (decideSeq.get(tabId) !== seq) return inflight.get(tabId)?.promise ?? state;
  await saveRecord(tabId, key, state);
  if (decideSeq.get(tabId) !== seq) return inflight.get(tabId)?.promise ?? state;
  notifyPanel(state);
  if (continuation) finishAiInBackground(tabId, seq, key, continuation);
  return state;
}

// AI 생성이 끝나면, 그 탭이 아직 같은 페이지이고 더 새 결정이 없을 때만 결과를 저장·전송한다.
// (다른 페이지로 이동했으면 결과는 ai-manual.js가 캐시에만 남긴다.)
function finishAiInBackground(tabId, seq, key, continuation) {
  pendingAi.add(tabId);
  continuation()
    .then(async finalState => {
      if (decideSeq.get(tabId) !== seq) return;
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab || dedupeKey(tab.url || tab.pendingUrl || '') !== key) return;
      await saveRecord(tabId, key, finalState);
      if (decideSeq.get(tabId) !== seq) return;
      notifyPanel(finalState);
    })
    .catch(e => console.warn('[page-manual] AI 결과 처리 실패:', e?.name))
    .finally(() => {
      if (decideSeq.get(tabId) === seq) pendingAi.delete(tabId);
    });
}

function notifyPanel(state) {
  // 패널이 닫혀 있으면 "Receiving end does not exist"가 난다. 무시한다.
  chrome.runtime.sendMessage({ type: MSG.MANUAL_UPDATED, ...state }).catch(() => {});
}

// --- 이동 이벤트 디바운스 ---

const timers = new Map(); // tabId → { timer, url }

function schedule(tabId, url) {
  if (typeof tabId !== 'number' || tabId < 0) return;
  const prev = timers.get(tabId);
  if (prev) clearTimeout(prev.timer);
  const entry = { url };
  entry.timer = setTimeout(() => {
    timers.delete(tabId);
    onNavigationSettled(tabId, entry.url).catch(e => console.warn('[page-manual] 이동 처리 실패:', e?.message));
  }, NAV_DEBOUNCE_MS);
  timers.set(tabId, entry);
}

async function onNavigationSettled(tabId, url) {
  const key = dedupeKey(url ?? '');
  const running = inflight.get(tabId);
  if (running && running.key === key) return;
  const record = await readTabRecord(tabId);
  if (record && record.dedupeKey === key && record.state?.state !== STATE.ERROR) return;
  // URL이 바뀐 이동이므로 진행 중인 (이전 URL의) 결정을 기다리지 않고 새로 시작한다.
  await decide(tabId, { force: true });
}

// --- 이벤트 리스너(최상위 동기 등록) ---

chrome.runtime.onInstalled.addListener(() => {
  // 설치·업데이트 직후에는 탭 상태가 없다. 패널이 열리면 GET_CURRENT_MANUAL이 결정 흐름을 돌린다.
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') schedule(tabId, changeInfo.url ?? tab.url);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  readTabRecord(tabId)
    .then(record => (record ? null : decide(tabId)))
    .catch(e => console.warn('[page-manual] 탭 전환 처리 실패:', e?.message));
});

chrome.tabs.onRemoved.addListener(tabId => {
  const t = timers.get(tabId);
  if (t) clearTimeout(t.timer);
  timers.delete(tabId);
  decideSeq.delete(tabId);
  inflight.delete(tabId);
  removeTabRecord(tabId).catch(() => {});
});

chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
  if (details.frameId === 0) schedule(details.tabId, details.url);
});

chrome.webNavigation.onReferenceFragmentUpdated.addListener(details => {
  if (details.frameId === 0) schedule(details.tabId, details.url);
});

// --- 패널 요청 ---

// 확장 자신의 페이지(사이드 패널, 옵션, 탭으로 연 sidepanel.html?tabId=…)에서 온 메시지만 받는다.
// 콘텐츠 스크립트는 sender.tab이 있고 sender.url이 웹 페이지 주소이므로 거부된다.
function isFromExtensionPage(sender) {
  if (sender.id !== chrome.runtime.id) return false;
  const extBase = chrome.runtime.getURL('');
  if (sender.tab) return typeof sender.url === 'string' && sender.url.startsWith(extBase);
  return true;
}

const isTabId = v => Number.isInteger(v) && v >= 0;

async function handleGetCurrent(tabId) {
  const record = await readTabRecord(tabId);
  if (record?.state) {
    // 워커가 자는 동안 놓친 이동이 있으면 다시 결정한다.
    let tab = null;
    try { tab = await chrome.tabs.get(tabId); } catch { /* 닫힌 탭 */ }
    const samePage = tab && dedupeKey(tab.url || tab.pendingUrl || '') === record.dedupeKey;
    // loading인데 이 워커에서 진행 중인 생성이 없으면(워커 재시작으로 사라짐) 다시 결정한다.
    const staleLoading = record.state.state === STATE.LOADING && !pendingAi.has(tabId) && !inflight.has(tabId);
    if (samePage && !staleLoading) return record.state;
    if (samePage && staleLoading) return decide(tabId, { force: true });
  }
  return decide(tabId); // 탭이 없으면 TAB_NOT_FOUND error 상태
}

/** REGENERATE_MANUAL: AI 대상(작성 매뉴얼 없음 + AI 허용)이면 캐시를 무시하고 다시 생성한다. */
async function handleRegenerate(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const url = tab?.url || '';
  const notEligible = { ok: false, error: { code: ERROR_CODE.NOT_AI_ELIGIBLE, message: '이 페이지는 AI 매뉴얼 대상이 아닙니다.' } };
  if (!tab || !isWebUrl(url)) return notEligible;
  if (resolveAuthored(await loadManuals(), url)) return notEligible;
  if (!(await isAiAllowed(url))) return notEligible;
  decide(tabId, { force: true, regenerate: true });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isFromExtensionPage(sender)) return false;
  switch (message?.type) {
    case MSG.GET_CURRENT_MANUAL: {
      if (!isTabId(message.tabId)) return false;
      handleGetCurrent(message.tabId)
        .then(state => sendResponse(state))
        .catch(e => {
          console.warn('[page-manual] GET_CURRENT_MANUAL 실패:', e?.message);
          sendResponse(errorState({ tabId: message.tabId }, ERROR_CODE.INTERNAL_ERROR, '매뉴얼을 확인하는 중 문제가 생겼습니다.'));
        });
      return true;
    }
    case MSG.REFRESH_MANUAL: {
      if (!isTabId(message.tabId)) return false;
      sendResponse({ ok: true });
      // 중복 제거를 무시하고 결정 흐름을 처음부터 다시 돌린다. 결과는 MANUAL_UPDATED로 간다.
      decide(message.tabId, { force: true });
      return false;
    }
    case MSG.REGENERATE_MANUAL: {
      if (!isTabId(message.tabId)) return false;
      handleRegenerate(message.tabId)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, error: { code: ERROR_CODE.INTERNAL_ERROR, message: '다시 생성하지 못했습니다.' } }));
      return true;
    }
    case MSG.HIGHLIGHT: {
      // 권한 확인 → page-agent 주입 → 최상위 프레임에 HIGHLIGHT. 응답 { found } 또는 { found: 0, error }.
      if (!isTabId(message.tabId)) return false;
      highlightInTab(message.tabId, message.selectors)
        .then(sendResponse)
        .catch(() => sendResponse({ found: 0, error: { code: ERROR_CODE.INJECT_FAILED, message: '화면에 표시하지 못했습니다.' } }));
      return true;
    }
    case MSG.CLEAR_HIGHLIGHT: {
      if (!isTabId(message.tabId)) return false;
      clearHighlightInTab(message.tabId).then(sendResponse, () => sendResponse({ ok: true }));
      return true;
    }
    default:
      return false;
  }
});
