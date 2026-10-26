// 확장 전체에서 쓰는 상수. 메시지 타입은 messages.js에 있다.

// ManualState.state
export const STATE = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  NONE: 'none',
  ERROR: 'error',
});

// ManualState.source (state가 ready일 때)
export const SOURCE = Object.freeze({
  AUTHORED: 'authored',
  AI: 'ai',
  AI_CACHE: 'ai-cache',
});

// ManualState.reason (state가 none일 때)
export const REASON = Object.freeze({
  UNSUPPORTED_URL: 'unsupported-url',
  AI_NOT_ALLOWED: 'ai-not-allowed',
});

// 실패 응답 { ok: false, error: { code, message } }의 code
export const ERROR_CODE = Object.freeze({
  NO_API_KEY: 'NO_API_KEY',
  API_UNAUTHORIZED: 'API_UNAUTHORIZED',
  API_RATE_LIMITED: 'API_RATE_LIMITED',
  API_ERROR: 'API_ERROR',
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  NO_HOST_PERMISSION: 'NO_HOST_PERMISSION',
  INJECT_FAILED: 'INJECT_FAILED',
  EXTRACT_FAILED: 'EXTRACT_FAILED',
  NOT_AI_ELIGIBLE: 'NOT_AI_ELIGIBLE',
  // QA r3 minor 수정(리더 a안): GET_CURRENT_MANUAL 실패도 ManualState error로 돌려준다.
  TAB_NOT_FOUND: 'TAB_NOT_FOUND',     // 대상 탭이 닫혔거나 없다
  INTERNAL_ERROR: 'INTERNAL_ERROR',   // 결정 흐름의 예상하지 못한 예외
});

// Claude API (모듈 6, claude-api 스킬 기준 2026-10)
// 기본 모델은 빠르고 저렴한 최신 Haiku. 옵션에서 바꿀 수 있다(자유 입력 허용).
export const DEFAULT_MODEL = 'claude-haiku-5-5';
export const SUGGESTED_MODELS = Object.freeze(['claude-haiku-5-5', 'claude-sonnet-5-5']);
export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
// API 버전 2026-10-21: temperature·top_p·top_k를 보내면 400이므로 보내지 않는다.
export const ANTHROPIC_VERSION = '2026-10-21';
// 비스트리밍 요청 기본값. 생성 매뉴얼 JSON은 짧지만 적응형 사고(thinking)가 함께 토큰을 쓴다.
export const AI_MAX_TOKENS = 16000;
// 화면 구조만으로 쓰는 짧은 매뉴얼이므로 낮은 effort(비용·지연 절감). effort를 받지 않는 구형 모델에는 보내지 않는다.
export const AI_EFFORT = 'low';

// AI 캐시
export const AI_CACHE_PREFIX = 'ai:';
export const AI_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const AI_CACHE_MAX = 500;

// storage.session 탭 상태 키 접두사
export const TAB_STATE_PREFIX = 'tab:';

// 시간 한도
export const NAV_DEBOUNCE_MS = 150;
export const TAB_COMPLETE_WAIT_MS = 10_000;
export const API_TIMEOUT_MS = 25_000;
export const DOM_SETTLE_QUIET_MS = 300;
export const DOM_SETTLE_MAX_MS = 2_000;
export const HIGHLIGHT_AUTO_CLEAR_MS = 5_000;

// PageStructure 한도(외부 전송 범위와 토큰 비용을 줄인다)
export const STRUCTURE_MAX_ITEMS = 50;
export const STRUCTURE_MAX_TEXT = 120;
