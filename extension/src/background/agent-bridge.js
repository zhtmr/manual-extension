// 서비스 워커 → 페이지 에이전트(page-agent.js) 연결. 권한 확인, 필요할 때만 주입, 최상위 프레임에 메시지.
// 하이라이트 중계(service-worker.js)와 AI 구조 추출(ai-manual.js, 모듈 6)이 함께 쓴다.
import { MSG } from '../shared/messages.js';
import { ERROR_CODE } from '../shared/constants.js';

const AGENT_FILE = 'src/content/page-agent.js';
const MAX_SELECTORS = 20;
const MAX_SELECTOR_LENGTH = 500;

export class AgentError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** http(s) URL의 origin. 아니면 null. */
export function webOrigin(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch {
    return null;
  }
}

/** 패널이 보낸 selectors를 정리한다(문자열만, 개수·길이 제한). */
export function sanitizeSelectors(selectors) {
  if (!Array.isArray(selectors)) return [];
  return selectors
    .filter(s => typeof s === 'string' && s.trim() && s.length <= MAX_SELECTOR_LENGTH)
    .slice(0, MAX_SELECTORS);
}

async function getTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    throw new AgentError(ERROR_CODE.TAB_NOT_FOUND, '대상 탭을 찾을 수 없습니다.');
  }
}

/** 탭의 origin에 host 권한이 있는가. http(s)가 아니면 false. */
export async function hasHostPermission(url) {
  const origin = webOrigin(url);
  if (!origin) return false;
  try {
    return await chrome.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

/**
 * 권한을 확인하고 page-agent를 주입한 뒤 최상위 프레임에 메시지를 보낸다.
 * 실패하면 AgentError(code: TAB_NOT_FOUND | INJECT_FAILED | NO_HOST_PERMISSION)를 던진다.
 */
export async function sendToAgent(tabId, message) {
  const tab = await getTab(tabId);
  const url = tab.url || '';
  if (!webOrigin(url)) throw new AgentError(ERROR_CODE.INJECT_FAILED, '웹 페이지가 아니라서 화면에 접근할 수 없습니다.');
  if (!(await hasHostPermission(url))) throw new AgentError(ERROR_CODE.NO_HOST_PERMISSION, '이 사이트에 접근할 권한이 없습니다.');
  try {
    // 중복 주입은 page-agent의 IIFE 플래그가 무시한다.
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: [AGENT_FILE] });
  } catch {
    throw new AgentError(ERROR_CODE.INJECT_FAILED, '페이지에 스크립트를 넣지 못했습니다.');
  }
  try {
    return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  } catch {
    throw new AgentError(ERROR_CODE.INJECT_FAILED, '페이지 스크립트가 응답하지 않았습니다.');
  }
}

/**
 * 이미 주입된 에이전트에만 메시지를 보낸다(주입·권한 요청 없음). 받는 쪽이 없으면 null.
 */
export async function sendToExistingAgent(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  } catch {
    return null;
  }
}

/** HIGHLIGHT 중계. 응답은 { found } 또는 { found: 0, error: { code, message } }. */
export async function highlightInTab(tabId, selectors) {
  const list = sanitizeSelectors(selectors);
  try {
    const res = await sendToAgent(tabId, { type: MSG.HIGHLIGHT, selectors: list });
    const found = Number.isInteger(res?.found) && res.found >= 0 ? res.found : 0;
    return { found };
  } catch (e) {
    const code = e instanceof AgentError ? e.code : ERROR_CODE.INJECT_FAILED;
    return { found: 0, error: { code, message: e instanceof AgentError ? e.message : '화면에 표시하지 못했습니다.' } };
  }
}

/** CLEAR_HIGHLIGHT 중계. 에이전트가 없거나 권한이 없어도 { ok: true }(지울 것이 없다). */
export async function clearHighlightInTab(tabId) {
  await sendToExistingAgent(tabId, { type: MSG.CLEAR_HIGHLIGHT });
  return { ok: true };
}

/**
 * 페이지 구조 추출(AI 폴백용, 모듈 6에서 ai-manual.js가 쓴다). 실패하면 AgentError.
 * @returns {Promise<object>} PageStructure
 */
export async function extractPageStructure(tabId) {
  const res = await sendToAgent(tabId, { type: MSG.EXTRACT_PAGE });
  if (!res || typeof res !== 'object' || res.ok === false || typeof res.url !== 'string') {
    throw new AgentError(ERROR_CODE.EXTRACT_FAILED, '페이지 구조를 읽지 못했습니다.');
  }
  return res;
}
