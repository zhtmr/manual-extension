// 설정 저장소(storage.local). 서비스 워커와 옵션 페이지가 쓴다. 패널은 apiKey를 읽지 않는다.
// isValidOrigin만 순수 함수다. 나머지는 호출할 때만 chrome.*에 접근하므로 node에서 import해도 된다.
import { DEFAULT_MODEL } from './constants.js';

const SETTINGS_KEY = 'settings';
const API_KEY_KEY = 'apiKey';

/** `^https?://host[:port]$` 형식의 origin인가(경로·끝 '/'·사용자 정보·쿼리 없음). */
export function isValidOrigin(str) {
  if (typeof str !== 'string' || !/^https?:\/\/[^/\s?#@]+$/.test(str)) return false;
  try {
    return new URL(str).origin === str;
  } catch {
    return false;
  }
}

function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const model = typeof s.model === 'string' && s.model.trim() ? s.model.trim() : DEFAULT_MODEL;
  const origins = Array.isArray(s.aiAllowedOrigins) ? s.aiAllowedOrigins.filter(isValidOrigin) : [];
  return { model, aiAllowedOrigins: [...new Set(origins)] };
}

/** @returns {Promise<{ model: string, aiAllowedOrigins: string[] }>} */
export async function getSettings() {
  const got = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(got[SETTINGS_KEY]);
}

export async function saveSettings(patch) {
  const next = normalizeSettings({ ...(await getSettings()), ...patch });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** 저장된 API 키. 없으면 null. 반환값을 로그에 남기지 않는다. */
export async function getApiKey() {
  const got = await chrome.storage.local.get(API_KEY_KEY);
  const key = got[API_KEY_KEY];
  return typeof key === 'string' && key.trim() ? key.trim() : null;
}

export async function addAiOrigin(origin) {
  if (!isValidOrigin(origin)) throw new Error('origin 형식이 올바르지 않습니다');
  const s = await getSettings();
  if (s.aiAllowedOrigins.includes(origin)) return s;
  return saveSettings({ aiAllowedOrigins: [...s.aiAllowedOrigins, origin] });
}

export async function removeAiOrigin(origin) {
  const s = await getSettings();
  return saveSettings({ aiAllowedOrigins: s.aiAllowedOrigins.filter(o => o !== origin) });
}
