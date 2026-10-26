// 사이드 패널: 대상 탭의 매뉴얼 상태(ManualState)를 받아 그린다.
// 렌더링은 createElement + textContent만 쓴다(매뉴얼·AI 응답은 신뢰하지 않는 문자열). HTML 문자열 대입 금지.
// 「화면에서 보기」는 HIGHLIGHT(panel → SW → content)로 동작한다(모듈 5).
// 「다시 생성」은 REGENERATE_MANUAL, 「AI 매뉴얼 생성 허용」은 전송 범위 안내 → 권한 요청 → 허용 목록 추가 → REFRESH_MANUAL.
import { MSG } from '../shared/messages.js';
import { STATE, SOURCE, ERROR_CODE } from '../shared/constants.js';
import { addAiOrigin } from '../shared/settings.js';
import {
  parsePinnedTabId, acceptsUpdate, isRenderableState, badgeFor, isAiSource,
  errorGuide, noneGuide, formatDate, displayUrl, highlightGuide, webOrigin, aiConsentText,
} from './panel-logic.js';

const features = Object.freeze({ highlight: true, aiActions: true });
const PENDING_FEATURE_HINT = '다음 업데이트에서 사용할 수 있습니다.';
const SKELETON_DELAY_MS = 120;

const els = {
  title: document.getElementById('pageTitle'),
  badge: document.getElementById('sourceBadge'),
  url: document.getElementById('pageUrl'),
  settings: document.getElementById('btnSettings'),
  content: document.getElementById('content'),
};

const pinnedTabId = parsePinnedTabId(location.search);
const target = { tabId: pinnedTabId, windowId: null, pinned: pinnedTabId !== null };
let requestSeq = 0;
let skeletonTimer = null;
let highlightTabId = null; // 하이라이트를 표시한 탭. 다시 그리기 전에 그 탭에 CLEAR_HIGHLIGHT
let currentState = null;   // 마지막으로 그린 ManualState

// --- DOM 도우미 ---

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'className') el.className = v;
    else if (k === 'onClick') el.addEventListener('click', v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'disabled' || k === 'hidden' || k === 'open') el[k] = !!v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function section(title, ...body) {
  return h('section', { className: 'section' }, h('h2', { className: 'section-title', text: title }), ...body);
}

function setHeader(title, state) {
  els.title.textContent = title;
  const badge = badgeFor(state);
  if (badge) {
    els.badge.textContent = badge.label;
    els.badge.dataset.kind = badge.kind;
    els.badge.hidden = false;
  } else {
    els.badge.hidden = true;
    els.badge.textContent = '';
    delete els.badge.dataset.kind;
  }
  els.url.textContent = state?.url ? displayUrl(state.url) : '';
  els.url.title = els.url.textContent;
}

// --- 상태별 화면 ---

function renderLoading(state) {
  const generating = state?.state === STATE.LOADING && state?.source === SOURCE.AI;
  setHeader(generating ? 'AI 매뉴얼 만드는 중' : '매뉴얼 확인 중', generating ? { url: state.url } : null);
  const bar = cls => h('div', { className: `skeleton ${cls}` });
  els.content.setAttribute('aria-busy', 'true');
  const nodes = [];
  if (generating) {
    nodes.push(h('p', { className: 'muted loading-note', text: 'AI가 이 화면의 구조를 보고 매뉴얼을 만들고 있습니다. 잠시 기다려 주세요.' }));
  }
  nodes.push(h('div', { className: 'skeleton-group', role: 'status', 'aria-label': '매뉴얼을 불러오는 중' },
    bar('w-90'), bar('w-70'),
    h('div', { className: 'skeleton-gap' }),
    bar('w-40 tall'), bar('w-100'), bar('w-80'), bar('w-60'),
    h('div', { className: 'skeleton-gap' }),
    bar('w-40 tall'), bar('w-100'), bar('w-90')));
  els.content.replaceChildren(...nodes);
}

// --- AI: 다시 생성, 사이트 허용 ---

async function regenerate(button) {
  const tabId = target.tabId;
  if (tabId == null) return;
  button.disabled = true;
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: MSG.REGENERATE_MANUAL, tabId });
  } catch {
    res = null;
  }
  if (res?.ok) return; // loading → 결과가 MANUAL_UPDATED로 온다
  button.disabled = false;
  const note = button.closest('.ai-note');
  if (note && tabId === target.tabId) {
    note.querySelector('.ai-note-error')?.remove();
    note.append(h('p', { className: 'ai-note-error', role: 'status',
      text: res?.error?.code === ERROR_CODE.NOT_AI_ELIGIBLE ? '이 페이지는 AI 매뉴얼 대상이 아닙니다.' : '다시 생성하지 못했습니다.' }));
  }
}

// 1단계: 전송 범위 안내와 「동의하고 허용」 / 「취소」
function showAiConsent(state) {
  const origin = webOrigin(state.url);
  if (!origin) return;
  const box = els.content.querySelector('.message');
  if (!box) return;
  box.querySelector('.ai-consent')?.remove();
  const status = h('p', { className: 'consent-status', role: 'status', hidden: true });
  const consent = h('div', { className: 'ai-consent' },
    h('h3', { className: 'consent-title', text: 'AI 매뉴얼 생성 전에 확인하세요' }),
    h('ul', { className: 'consent-list' }, aiConsentText(origin).map(t => h('li', { text: t }))),
    h('div', { className: 'actions' },
      h('button', { type: 'button', className: 'button', text: '동의하고 허용', onClick: () => allowAiForOrigin(origin, state.tabId, status) }),
      h('button', { type: 'button', className: 'button secondary', text: '취소', onClick: () => consent.remove() })),
    status);
  box.append(consent);
  consent.querySelector('button')?.focus();
}

// 2단계: 클릭 처리 안에서 바로 권한을 요청한다(사용자 제스처). 허용되면 목록에 넣고 결정 흐름을 다시 돌린다.
function allowAiForOrigin(origin, tabId, status) {
  chrome.permissions.request({ origins: [`${origin}/*`] })
    .then(async granted => {
      if (!granted) {
        status.textContent = '사이트 접근을 허용하지 않아 AI 매뉴얼을 만들 수 없습니다.';
        status.hidden = false;
        return;
      }
      await addAiOrigin(origin);
      if (tabId !== target.tabId) return;
      ++requestSeq;
      renderLoading();
      await chrome.runtime.sendMessage({ type: MSG.REFRESH_MANUAL, tabId }).catch(() => requestCurrent());
    })
    .catch(() => {
      status.textContent = '권한을 요청하지 못했습니다.';
      status.hidden = false;
    });
}

function scheduleSkeleton() {
  clearTimeout(skeletonTimer);
  skeletonTimer = setTimeout(renderLoading, SKELETON_DELAY_MS);
}

function cancelSkeleton() {
  clearTimeout(skeletonTimer);
  skeletonTimer = null;
}

function renderReady(state) {
  const page = state.page ?? {};
  setHeader(page.title || '페이지 매뉴얼', state);
  const nodes = [];

  if (isAiSource(state)) {
    const created = formatDate(state.generatedAt);
    nodes.push(h('div', { className: 'ai-note', role: 'note' },
      h('p', { text: 'AI가 화면 구조만 보고 만든 매뉴얼입니다. 정확하지 않을 수 있습니다.' }),
      h('div', { className: 'ai-note-row' },
        created ? h('span', { className: 'muted', text: `생성 ${created}` }) : null,
        h('button', {
          type: 'button', className: 'button small', text: '다시 생성',
          disabled: !features.aiActions, title: features.aiActions ? undefined : PENDING_FEATURE_HINT,
          onClick: e => regenerate(e.currentTarget),
        }))));
  }

  if (page.role) nodes.push(section('이 화면은', h('p', { className: 'role', text: page.role })));

  if (Array.isArray(page.features) && page.features.length) {
    nodes.push(section('주요 기능', h('ul', { className: 'feature-list' },
      page.features.map(f => h('li', {},
        h('span', { className: 'feature-name', text: f?.name ?? '' }),
        h('span', { className: 'feature-desc', text: f?.description ?? '' }))))));
  }

  if (Array.isArray(page.howTo) && page.howTo.length) {
    nodes.push(section('조작 방법', h('div', { className: 'howto-list' },
      page.howTo.map((task, i) => {
        const targets = Array.isArray(task?.targets) ? task.targets.filter(t => typeof t === 'string' && t) : [];
        return h('details', { className: 'howto', open: i === 0 },
          h('summary', { text: task?.task ?? '' }),
          h('ol', { className: 'steps' }, (task?.steps ?? []).map(s => h('li', { text: String(s) }))),
          targets.length ? highlightControls(targets) : null);
      }))));
  }

  if (Array.isArray(page.tips) && page.tips.length) {
    nodes.push(section('팁', h('ul', { className: 'tip-list' }, page.tips.map(t => h('li', { text: String(t) })))));
  }

  if (Array.isArray(state.related) && state.related.length) {
    nodes.push(section('관련 페이지', h('ul', { className: 'related-list' },
      state.related.map(r => h('li', { text: r?.title ?? r?.id ?? '' })))));
  }

  if (page.updatedAt && !isAiSource(state)) {
    nodes.push(h('p', { className: 'muted footnote', text: `매뉴얼 갱신일 ${page.updatedAt}` }));
  }

  els.content.replaceChildren(...nodes);
}

// --- 「화면에서 보기」 ---

// 버튼 + 결과 안내 + (권한이 없을 때) 「이 사이트 접근 허용」 자리
function highlightControls(targets) {
  const status = h('p', { className: 'highlight-status', role: 'status', hidden: true });
  const extra = h('div', { className: 'highlight-extra' });
  const button = h('button', {
    type: 'button', className: 'button small secondary', text: '화면에서 보기',
    disabled: !features.highlight, title: features.highlight ? undefined : PENDING_FEATURE_HINT,
    onClick: () => showOnScreen(targets, { button, status, extra }),
  });
  return h('div', { className: 'highlight-controls' }, button, status, extra);
}

function setHighlightStatus(ui, kind, text) {
  ui.status.textContent = text;
  ui.status.dataset.kind = kind;
  ui.status.hidden = !text;
}

async function showOnScreen(targets, ui) {
  const tabId = target.tabId;
  if (tabId == null) return;
  const stateAtClick = currentState;
  ui.extra.replaceChildren();
  ui.button.disabled = true;
  setHighlightStatus(ui, 'pending', '');
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: MSG.HIGHLIGHT, tabId, selectors: targets });
  } catch {
    res = null;
  }
  ui.button.disabled = false;
  // 그사이 대상 탭이나 상태가 바뀌었으면(다시 그려졌으면) 이 버튼은 이미 화면에 없다.
  if (tabId !== target.tabId || stateAtClick !== currentState) return;
  const g = highlightGuide(res);
  if (g.kind === 'ok') highlightTabId = tabId;
  setHighlightStatus(ui, g.kind, g.text);
  const origin = webOrigin(stateAtClick?.url);
  if (g.kind === 'needPermission' && origin) {
    ui.extra.replaceChildren(h('button', {
      type: 'button', className: 'button small', text: '이 사이트 접근 허용',
      onClick: () => requestSiteAccess(origin, targets, ui),
    }));
  }
}

// permissions.request는 사용자 클릭 처리 안에서 바로(다른 await 없이) 불러야 한다.
function requestSiteAccess(origin, targets, ui) {
  chrome.permissions.request({ origins: [`${origin}/*`] })
    .then(granted => {
      if (granted) {
        ui.extra.replaceChildren();
        showOnScreen(targets, ui);
      } else {
        setHighlightStatus(ui, 'unavailable', '접근을 허용하지 않아 화면에 표시할 수 없습니다.');
      }
    })
    .catch(() => setHighlightStatus(ui, 'unavailable', '권한을 요청하지 못했습니다.'));
}

function clearPreviousHighlight() {
  if (highlightTabId == null) return;
  const tabId = highlightTabId;
  highlightTabId = null;
  chrome.runtime.sendMessage({ type: MSG.CLEAR_HIGHLIGHT, tabId }).catch(() => {});
}

function renderNone(state) {
  setHeader('페이지 매뉴얼', state);
  const g = noneGuide(state);
  els.content.replaceChildren(h('div', { className: 'message' },
    h('h2', { className: 'message-title', text: g.title }),
    h('p', { text: g.detail }),
    h('div', { className: 'actions' },
      g.showEnableAi ? h('button', {
        type: 'button', className: 'button', text: '이 사이트에서 AI 매뉴얼 생성 허용',
        disabled: !features.aiActions || !webOrigin(state.url), title: features.aiActions ? undefined : PENDING_FEATURE_HINT,
        onClick: () => showAiConsent(state),
      }) : null,
      h('button', { type: 'button', className: 'button secondary', text: '설정 열기', onClick: openOptions }))));
}

function renderError(state) {
  setHeader('페이지 매뉴얼', state);
  const g = errorGuide(state.error);
  const action = g.action === 'options'
    ? h('button', { type: 'button', className: 'button', text: '설정 열기', onClick: openOptions })
    : g.action === 'reselect'
      ? h('button', { type: 'button', className: 'button', text: '현재 탭 다시 찾기', onClick: reselectTarget })
      : h('button', { type: 'button', className: 'button', text: '재시도', onClick: retry });
  els.content.replaceChildren(h('div', { className: 'message error', role: 'alert' },
    h('h2', { className: 'message-title', text: g.title }),
    h('p', { text: g.detail }),
    state.error?.code ? h('p', { className: 'muted small', text: `오류 코드 ${state.error.code}` }) : null,
    h('div', { className: 'actions' }, action)));
}

function render(state) {
  cancelSkeleton();
  els.content.removeAttribute('aria-busy');
  // 매뉴얼(상태)이 바뀌어 다시 그리기 직전, 보냈던 하이라이트를 지운다.
  clearPreviousHighlight();
  currentState = state;
  switch (state.state) {
    case STATE.READY: return renderReady(state);
    case STATE.NONE: return renderNone(state);
    case STATE.ERROR: return renderError(state);
    case STATE.LOADING:
    default: return renderLoading(state);
  }
}

// 패널 쪽에서 만든 오류 상태(서비스 워커 응답이 없거나 형식이 틀릴 때)
function localError(code, message) {
  return { tabId: target.tabId, windowId: target.windowId, url: '', state: STATE.ERROR, error: { code, message } };
}

// --- 서비스 워커와 통신 ---

async function requestCurrent() {
  const seq = ++requestSeq;
  const tabId = target.tabId;
  if (tabId == null) {
    render(localError(ERROR_CODE.TAB_NOT_FOUND, '대상 탭이 없습니다.'));
    return;
  }
  scheduleSkeleton();
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: MSG.GET_CURRENT_MANUAL, tabId });
  } catch {
    res = null;
  }
  // 그사이 대상 탭이 바뀌었거나 MANUAL_UPDATED로 더 새 상태를 받았으면 버린다.
  if (seq !== requestSeq || tabId !== target.tabId) return;
  // GET 응답은 tabId만 확인한다(windowId는 탭이 창을 옮기면 옛 값일 수 있다).
  render(isRenderableState(res, tabId) ? res : localError(ERROR_CODE.INTERNAL_ERROR, '서비스 워커가 응답하지 않았습니다.'));
}

async function retry() {
  const tabId = target.tabId;
  if (tabId == null) return reselectTarget();
  ++requestSeq;
  renderLoading();
  try {
    const res = await chrome.runtime.sendMessage({ type: MSG.REFRESH_MANUAL, tabId });
    if (!res?.ok) throw new Error('refresh rejected');
    // 결과는 MANUAL_UPDATED로 온다.
  } catch {
    if (tabId === target.tabId) requestCurrent();
  }
}

function openOptions() {
  chrome.runtime.openOptionsPage().catch(() => {});
}

async function resolveActiveTarget() {
  const win = await chrome.windows.getCurrent();
  target.windowId = win?.id ?? null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: target.windowId });
  target.tabId = tab?.id ?? null;
}

async function reselectTarget() {
  if (target.pinned) {
    requestCurrent();
    return;
  }
  try {
    await resolveActiveTarget();
  } catch {
    target.tabId = null;
  }
  requestCurrent();
}

// --- 리스너(동기 등록) ---

chrome.runtime.onMessage.addListener(msg => {
  if (msg?.type !== MSG.MANUAL_UPDATED) return false;
  if (!acceptsUpdate(msg, target)) return false;
  ++requestSeq; // 진행 중인 GET의 (더 오래된) 응답이 이 상태를 덮지 않게 한다.
  const { type, ...state } = msg;
  render(state);
  return false;
});

if (!target.pinned) {
  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    if (windowId !== target.windowId || tabId === target.tabId) return;
    target.tabId = tabId;
    requestCurrent();
  });
}

els.settings.addEventListener('click', openOptions);

// --- 시작 ---

(async () => {
  scheduleSkeleton();
  if (!target.pinned) {
    try {
      await resolveActiveTarget();
    } catch {
      target.tabId = null;
    }
  }
  requestCurrent();
})();
