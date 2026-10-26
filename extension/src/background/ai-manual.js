// AI 매뉴얼 생성(모듈 6): 구조 정리 → Claude API(Messages, 원시 HTTP) → JSON 추출 → 스키마 검증 → 대상 선택자 정리 → 캐시.
// 확장은 빌드 도구 없이 동작하고 원격 코드를 불러올 수 없어 SDK를 번들할 수 없다. 그래서 fetch로 직접 호출한다.
// 외부 전송은 이 파일의 callClaude 한 곳뿐이다(설계 ⑦). API 키는 헤더에만 쓰고 로그·오류 메시지에 넣지 않는다.
// fetch·now·storage·추출 함수는 인자로 받아 node 테스트에서 가짜로 바꿀 수 있다.
import { aiCacheKey, maskPath, hashPath, maskPii, containsPii } from '../shared/matcher.js';
import { validatePage } from '../shared/manual-schema.js';
import {
  ERROR_CODE, AI_CACHE_PREFIX, AI_CACHE_TTL_MS, AI_CACHE_MAX, API_TIMEOUT_MS,
  ANTHROPIC_API_URL, ANTHROPIC_VERSION, AI_MAX_TOKENS, AI_EFFORT, STRUCTURE_MAX_ITEMS, STRUCTURE_MAX_TEXT,
} from '../shared/constants.js';

export class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// chrome-extension-dev references/architecture.md 4절 초안 + 마스킹 표시 안내
export const SYSTEM_PROMPT = [
  '너는 업무용 웹 시스템의 사용자 매뉴얼 작가다. 주어진 페이지 구조(JSON)만 근거로,',
  '처음 이 화면을 본 직원을 위한 매뉴얼을 한국어로 작성한다.',
  '- 구조에 없는 버튼·기능은 쓰지 않는다. 업무 규칙을 지어내지 않는다.',
  '- 조작 단계에는 화면 라벨을 「」로 인용한다.',
  '- 구조의 "***"는 개인정보를 가린 자리다. 원래 값을 추측하지 않는다.',
  '- targets에는 구조의 buttons·fields에 있던 selector 문자열만 그대로 쓴다. 없으면 빈 배열.',
  '- 아래 JSON 스키마의 객체 하나만 출력한다. 다른 텍스트를 출력하지 않는다.',
  '{ "title": "60자 이내", "role": "10~300자", "features": [{"name", "description"}] (1~10개),',
  '  "howTo": [{"task", "steps": [] (1~12개), "targets": []}] (1~8개), "tips": [] (0~8개) }',
].join('\n');

// ---------- 전송 구조 정리(방어선: page-agent가 이미 하지만 한 번 더) ----------

const clipText = s => {
  const t = maskPii(String(s ?? '').replace(/\s+/g, ' ').trim());
  return t.length > STRUCTURE_MAX_TEXT ? t.slice(0, STRUCTURE_MAX_TEXT) : t;
};
const list = v => (Array.isArray(v) ? v.slice(0, STRUCTURE_MAX_ITEMS) : []);
const sel = v => {
  const s = typeof v === 'string' ? v : '';
  return s.length <= STRUCTURE_MAX_TEXT && !s.includes('@') && !containsPii(s) ? s : '';
};

/** 쿼리 없이 origin + 마스킹 경로(+ 해시 라우트). */
export function structureUrl(url) {
  try {
    const u = new URL(url);
    let out = u.origin + maskPath(u.pathname.length > 1 && u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname);
    if (/^#!?\//.test(u.hash)) out += '#' + maskPath(hashPath(u));
    return out;
  } catch {
    return '';
  }
}

/** PageStructure를 계약 키만 남기고 한도·마스킹을 다시 적용한다. url은 탭 URL로 다시 만든다. */
export function sanitizeStructure(s, pageUrl) {
  const src = s && typeof s === 'object' ? s : {};
  return {
    url: structureUrl(pageUrl),
    title: clipText(src.title),
    headings: list(src.headings).map(h => ({ level: Number(h?.level) || 0, text: clipText(h?.text) })).filter(h => h.text),
    nav: list(src.nav).map(clipText).filter(Boolean),
    buttons: list(src.buttons).map(b => ({ text: clipText(b?.text), selector: sel(b?.selector) })).filter(b => b.text),
    fields: list(src.fields).map(f => ({
      label: clipText(f?.label), type: clipText(f?.type), placeholder: clipText(f?.placeholder), selector: sel(f?.selector),
    })),
    tables: list(src.tables).map(t => ({ caption: clipText(t?.caption), headers: list(t?.headers).map(clipText).filter(Boolean) })),
    notices: list(src.notices).map(clipText).filter(Boolean),
  };
}

// ---------- Claude API ----------

// effort(output_config.effort)를 받지 않는 구형 모델
const supportsEffort = model => !/^claude-(?:haiku-4|sonnet-4-5|3)/.test(model);

export function buildRequestBody({ model, structure }) {
  const body = {
    model,
    max_tokens: AI_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(structure) }],
  };
  if (supportsEffort(model)) body.output_config = { effort: AI_EFFORT };
  return body;
}

/**
 * Messages API를 부르고 응답의 text 블록을 이어 붙여 돌려준다. thinking 블록은 버린다.
 * 실패는 AiError(code). 오류 메시지에는 HTTP 상태와 API 오류 type만 담는다.
 */
export async function callClaude({ apiKey, model, structure, fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        // 브라우저(확장 서비스 워커)에서 직접 호출할 때 CORS를 여는 헤더. 키는 사용자 본인 것이다.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(buildRequestBody({ model, structure })),
      signal: controller.signal,
    });
  } catch (e) {
    if (controller.signal.aborted) throw new AiError(ERROR_CODE.TIMEOUT, `응답이 ${Math.round(timeoutMs / 1000)}초 안에 오지 않았습니다.`);
    throw new AiError(ERROR_CODE.NETWORK, '네트워크 오류로 API에 연결하지 못했습니다.');
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const type = typeof data?.error?.type === 'string' ? data.error.type.replace(/[^\w]/g, '').slice(0, 40) : '';
    const detail = `HTTP ${res.status}${type ? ` ${type}` : ''}`;
    if (res.status === 401 || res.status === 403) throw new AiError(ERROR_CODE.API_UNAUTHORIZED, `API 키가 거부되었습니다(${detail}).`);
    if (res.status === 429 || res.status === 529) throw new AiError(ERROR_CODE.API_RATE_LIMITED, `요청이 많아 잠시 거절되었습니다(${detail}).`);
    throw new AiError(ERROR_CODE.API_ERROR, `API 오류(${detail}).`);
  }
  if (!data || !Array.isArray(data.content)) throw new AiError(ERROR_CODE.INVALID_RESPONSE, 'API 응답 형식이 올바르지 않습니다.');
  if (data.stop_reason === 'refusal') throw new AiError(ERROR_CODE.API_ERROR, '모델이 이 요청을 거절했습니다(refusal).');
  if (data.stop_reason === 'max_tokens') throw new AiError(ERROR_CODE.INVALID_RESPONSE, '응답이 길이 제한에 걸려 잘렸습니다.');
  const text = data.content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('');
  if (!text.trim()) throw new AiError(ERROR_CODE.INVALID_RESPONSE, 'API 응답에 글자가 없습니다.');
  return text;
}

/** 응답 글자에서 JSON 객체 하나를 꺼낸다(코드펜스·앞뒤 설명 허용). */
export function parseManualJson(text) {
  let t = String(text ?? '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AiError(ERROR_CODE.INVALID_RESPONSE, 'AI 응답에서 JSON을 찾지 못했습니다.');
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not object');
    return obj;
  } catch {
    throw new AiError(ERROR_CODE.INVALID_RESPONSE, 'AI 응답 JSON을 해석하지 못했습니다.');
  }
}

const localDate = ms => {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * AI 응답 객체 → Page. 내용 필드만 남기고 validatePage(full: false)를 통과해야 한다.
 * targets는 PageStructure의 buttons·fields selector에 있던 것만 남긴다. id·match·related·updatedAt·source는 여기서 채운다.
 */
export function buildAiPage(raw, structure, url, now) {
  const content = {
    title: raw?.title,
    role: raw?.role,
    features: raw?.features,
    howTo: raw?.howTo,
    ...(raw?.tips !== undefined ? { tips: raw.tips } : {}),
  };
  const errors = validatePage(content, { full: false });
  if (errors.length) throw new AiError(ERROR_CODE.INVALID_RESPONSE, `AI 응답이 매뉴얼 형식에 맞지 않습니다(${errors.length}건).`);

  const known = new Set([...structure.buttons, ...structure.fields].map(x => x.selector).filter(Boolean));
  const page = {
    title: content.title,
    role: content.role,
    features: content.features.map(f => ({ name: f.name, description: f.description })),
    howTo: content.howTo.map(h => {
      const targets = Array.isArray(h.targets) ? [...new Set(h.targets.filter(s => known.has(s)))] : [];
      return targets.length ? { task: h.task, steps: [...h.steps], targets } : { task: h.task, steps: [...h.steps] };
    }),
    tips: Array.isArray(content.tips) ? [...content.tips] : [],
  };
  const u = new URL(url);
  const hashRoute = /^#!?\//.test(u.hash);
  const path = u.pathname.length > 1 && u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname;
  return {
    id: aiCacheKey(url),
    match: hashRoute ? { type: 'glob', pattern: maskPath(hashPath(u)), hash: true } : { type: 'glob', pattern: maskPath(path) },
    ...page,
    related: [],
    updatedAt: localDate(now),
    source: 'ai',
  };
}

// ---------- 캐시(storage.local, 키 ai:{aiCacheKey}) ----------

const cacheKey = key => `${AI_CACHE_PREFIX}${key}`;

/** 유효한 캐시 항목 { page, createdAt, model } 또는 null(없음·만료·깨짐). */
export async function readCache(storage, key, now) {
  const k = cacheKey(key);
  const got = await storage.get(k);
  const entry = got?.[k];
  if (!entry || typeof entry !== 'object' || !Number.isFinite(entry.createdAt) || !entry.page) return null;
  if (now - entry.createdAt > AI_CACHE_TTL_MS || entry.createdAt > now + 60_000) return null;
  return entry;
}

/** 저장 후 AI_CACHE_MAX를 넘으면 createdAt이 오래된 것부터 지운다. */
export async function writeCache(storage, key, entry) {
  await storage.set({ [cacheKey(key)]: entry });
  const all = await storage.get(null);
  const items = Object.entries(all ?? {}).filter(([k]) => k.startsWith(AI_CACHE_PREFIX));
  if (items.length <= AI_CACHE_MAX) return;
  items.sort((a, b) => (a[1]?.createdAt ?? 0) - (b[1]?.createdAt ?? 0));
  await storage.remove(items.slice(0, items.length - AI_CACHE_MAX).map(([k]) => k));
}

/** AI 캐시 키 목록. origin을 주면 그 origin(정확히 같은 origin)의 것만. */
export async function listCacheKeys(storage, origin) {
  const all = await storage.get(null);
  return Object.keys(all ?? {}).filter(k => {
    if (!k.startsWith(AI_CACHE_PREFIX)) return false;
    if (!origin) return true;
    const rest = k.slice(AI_CACHE_PREFIX.length);
    return rest.startsWith(origin) && /^[/#]?$/.test(rest.charAt(origin.length));
  });
}

export async function clearAiCache(storage, origin) {
  const keys = await listCacheKeys(storage, origin);
  if (keys.length) await storage.remove(keys);
  return keys.length;
}

// ---------- 생성 ----------

const inflight = new Map(); // aiCacheKey → Promise

/**
 * 탭의 화면 구조를 추출해 AI 매뉴얼을 만들고 캐시한다. 같은 aiCacheKey의 생성이 진행 중이면 그 결과를 기다린다.
 * 캐시 확인은 호출하는 쪽(서비스 워커 결정 흐름)이 먼저 한다. 실패하면 AiError이고 캐시하지 않는다.
 * @param {object} p
 * @param {string} p.url 탭 URL
 * @param {number} p.tabId
 * @param {string} p.apiKey
 * @param {string} p.model
 * @param {object} p.deps { storage, fetchImpl, now, extract(tabId), waitForTabComplete(tabId), timeoutMs? }
 * @returns {Promise<{ page: object, createdAt: number, model: string }>}
 */
export function generateAiManual({ url, tabId, apiKey, model, deps }) {
  const key = aiCacheKey(url);
  if (!key) return Promise.reject(new AiError(ERROR_CODE.NOT_AI_ELIGIBLE, 'AI 매뉴얼을 만들 수 없는 주소입니다.'));
  const running = inflight.get(key);
  if (running) return running;
  const promise = (async () => {
    if (!apiKey) throw new AiError(ERROR_CODE.NO_API_KEY, 'API 키가 없습니다.');
    if (deps.waitForTabComplete) await deps.waitForTabComplete(tabId);
    let rawStructure;
    try {
      rawStructure = await deps.extract(tabId);
    } catch (e) {
      const code = typeof e?.code === 'string' && Object.values(ERROR_CODE).includes(e.code) ? e.code : ERROR_CODE.EXTRACT_FAILED;
      throw new AiError(code, '페이지 구조를 읽지 못했습니다.');
    }
    const structure = sanitizeStructure(rawStructure, url);
    const text = await callClaude({ apiKey, model, structure, fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs });
    const page = buildAiPage(parseManualJson(text), structure, url, deps.now());
    const entry = { page, createdAt: deps.now(), model };
    await writeCache(deps.storage, key, entry);
    return entry;
  })().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
