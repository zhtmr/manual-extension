// 사이드 패널의 순수 판단 로직(DOM·chrome 없음). node 테스트 대상.
import { STATE, SOURCE, REASON, ERROR_CODE } from '../shared/constants.js';

/** `?tabId=<n>` 고정 모드(QA 자동화용). 없거나 잘못되면 null. */
export function parsePinnedTabId(search) {
  const raw = new URLSearchParams(search ?? '').get('tabId');
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * MANUAL_UPDATED를 이 패널이 반영할지. 필드는 메시지 최상위에 펼쳐져 온다(msg.tabId, msg.windowId).
 * tabId는 브라우저 전체에서 유일하므로 tabId가 같아야 한다. 고정 모드가 아니면 windowId도 같아야 한다
 * (여러 창에 패널이 열려 있을 때). 고정 모드는 패널이 다른 창에 있을 수 있어 windowId를 보지 않는다.
 */
export function acceptsUpdate(msg, target) {
  if (!msg || typeof msg !== 'object' || !target || target.tabId == null) return false;
  if (msg.tabId !== target.tabId) return false;
  if (!target.pinned && Number.isInteger(target.windowId) && Number.isInteger(msg.windowId) && msg.windowId !== target.windowId) {
    return false;
  }
  return true;
}

/** GET_CURRENT_MANUAL 응답이 그릴 수 있는 ManualState인가. windowId는 보지 않는다(탭이 창을 옮겼을 수 있다). */
export function isRenderableState(res, tabId) {
  return !!res && typeof res === 'object' && typeof res.state === 'string'
    && Object.values(STATE).includes(res.state) && res.tabId === tabId;
}

/** @returns {{ label: string, kind: 'authored'|'ai'|'none' } | null} */
export function badgeFor(state) {
  if (state?.state === STATE.READY) {
    if (state.source === SOURCE.AI || state.source === SOURCE.AI_CACHE) return { label: 'AI 생성', kind: 'ai' };
    return { label: '작성됨', kind: 'authored' };
  }
  if (state?.state === STATE.NONE) return { label: '없음', kind: 'none' };
  return null;
}

export const isAiSource = state => state?.source === SOURCE.AI || state?.source === SOURCE.AI_CACHE;

/**
 * error 상태의 안내. action: 'options'(설정 열기) | 'retry'(REFRESH_MANUAL) | 'reselect'(대상 탭 다시 찾기)
 * @returns {{ title: string, detail: string, action: 'options'|'retry'|'reselect' }}
 */
export function errorGuide(error) {
  switch (error?.code) {
    case ERROR_CODE.NO_API_KEY:
      return { title: 'API 키가 없습니다', detail: 'AI 매뉴얼을 만들려면 설정에서 Claude API 키를 저장하세요.', action: 'options' };
    case ERROR_CODE.API_UNAUTHORIZED:
      return { title: 'API 키를 확인하세요', detail: '저장된 API 키가 거부되었습니다. 설정에서 키를 다시 확인하세요.', action: 'options' };
    case ERROR_CODE.API_RATE_LIMITED:
      return { title: '잠시 후 다시 시도하세요', detail: '요청이 많아 API가 잠시 응답하지 않습니다.', action: 'retry' };
    case ERROR_CODE.TIMEOUT:
      return { title: '응답이 늦어 중단했습니다', detail: '잠시 후 다시 시도하세요.', action: 'retry' };
    case ERROR_CODE.NETWORK:
      return { title: '네트워크에 연결할 수 없습니다', detail: '인터넷 연결을 확인한 뒤 다시 시도하세요.', action: 'retry' };
    case ERROR_CODE.INVALID_RESPONSE:
      return { title: 'AI 응답을 해석하지 못했습니다', detail: '다시 시도하면 새로 만듭니다.', action: 'retry' };
    case ERROR_CODE.NO_HOST_PERMISSION:
    case ERROR_CODE.INJECT_FAILED:
    case ERROR_CODE.EXTRACT_FAILED:
      return { title: '페이지 구조를 읽지 못했습니다', detail: '페이지가 다 열린 뒤 다시 시도하세요.', action: 'retry' };
    case ERROR_CODE.TAB_NOT_FOUND:
      return { title: '대상 탭을 찾을 수 없습니다', detail: '탭이 닫혔을 수 있습니다. 다른 탭을 선택하면 그 탭의 매뉴얼을 보여줍니다.', action: 'reselect' };
    default:
      return { title: '매뉴얼을 불러오지 못했습니다', detail: '다시 시도하세요.', action: 'retry' };
  }
}

/** none 상태의 안내. */
export function noneGuide(state) {
  if (state?.reason === REASON.UNSUPPORTED_URL) {
    return { title: '이 페이지에서는 매뉴얼을 볼 수 없습니다', detail: '브라우저 설정 화면이나 새 탭처럼 웹 페이지가 아닌 곳입니다.', showEnableAi: false };
  }
  return {
    title: '이 페이지에는 작성된 매뉴얼이 없습니다',
    detail: state?.canEnableAi
      ? '이 사이트에서 AI 매뉴얼 생성을 허용하면 화면 구조를 바탕으로 매뉴얼을 만들어 보여줍니다.'
      : '매뉴얼이 준비되면 이곳에 표시됩니다.',
    showEnableAi: !!state?.canEnableAi,
  };
}

/**
 * HIGHLIGHT 응답 → 안내. kind: 'ok' | 'notFound' | 'needPermission' | 'unavailable'
 * @returns {{ kind: string, text: string }}
 */
export function highlightGuide(res) {
  const code = res?.error?.code;
  if (code === ERROR_CODE.NO_HOST_PERMISSION) {
    return { kind: 'needPermission', text: '이 사이트에 접근할 권한이 없어 화면에 표시할 수 없습니다.' };
  }
  if (code === ERROR_CODE.TAB_NOT_FOUND) return { kind: 'unavailable', text: '대상 탭을 찾을 수 없습니다.' };
  if (code) return { kind: 'unavailable', text: '이 페이지에서는 화면에 표시할 수 없습니다.' };
  if (!res || typeof res !== 'object' || !Number.isInteger(res.found)) {
    return { kind: 'unavailable', text: '화면 표시 요청에 실패했습니다.' };
  }
  if (res.found > 0) return { kind: 'ok', text: `화면에 ${res.found}곳을 표시했습니다.` };
  return { kind: 'notFound', text: '화면에서 요소를 찾지 못했습니다.' };
}

/** AI 생성 허용 전 보여주는 전송 범위 안내(설계 ② 사이드 패널, ⑦ 외부 전송). */
export function aiConsentText(origin) {
  return [
    `허용하면 ${origin} 화면에서 매뉴얼이 없을 때 화면 구조를 Claude API(Anthropic)로 보내 매뉴얼을 만듭니다.`,
    '보내는 것: 화면 제목, 메뉴, 버튼·입력란 이름, 표 머리글, 안내 문구.',
    '보내지 않는 것: 입력한 값, 비밀번호, 숨은 값, 표 내용, 편집 중인 글, 주소의 검색어. 이메일·전화번호 같은 형식은 가립니다.',
    '요청에는 설정에 저장한 본인 API 키를 쓰고, 이 사이트에 접근할 권한을 함께 요청합니다.',
  ];
}

/** http(s) URL의 origin. 아니면 null(권한 요청 대상이 아니다). */
export function webOrigin(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch {
    return null;
  }
}

/** epoch ms → 'YYYY-MM-DD'(로컬 시간). 잘못된 값이면 ''. */
export function formatDate(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 'http(s)://host/path?q#h' → 'host/path'(표시용, 쿼리·해시 앵커 제외, 해시 라우트는 유지). */
export function displayUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return url;
    const hashRoute = /^#!?\//.test(u.hash) ? u.hash : '';
    return u.host + u.pathname + hashRoute;
  } catch {
    return String(url ?? '');
  }
}
