// URL → 매뉴얼 페이지 매칭과 URL 키 생성(순수 함수).
// findPage의 매칭 규칙은 .claude/skills/page-manual-authoring/scripts/validate_manuals.mjs와 같아야 한다
// (tests/matcher-parity.test.js가 대조한다). 바꾸려면 스키마 문서·검증기·이 파일을 함께 바꾼다.

const PRIORITY = { exact: 3, glob: 2, regex: 1 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_SEG_RE = /^\d{4}-\d{2}-\d{2}$/;
const HASH_ROUTE_RE = /^#!?\//;

const warnedRegex = new Set();

function toUrl(url) {
  if (url instanceof URL) return url;
  try { return new URL(url); } catch { return null; }
}

// 끝의 '/' 제거(루트 제외). 대소문자는 바꾸지 않는다.
function normPath(p) {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

function globToRegex(glob) {
  const esc = normPath(glob).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + esc.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]+').replace(/\u0000/g, '.*') + '$');
}

function regexTest(pattern, target) {
  try {
    return new RegExp(pattern).test(target);
  } catch (e) {
    if (!warnedRegex.has(pattern)) {
      warnedRegex.add(pattern);
      console.warn(`[page-manual] 잘못된 정규식 패턴을 무시합니다: ${pattern}`);
    }
    return false;
  }
}

function pageMatches(page, url) {
  const m = page.match;
  // 검증기와 같은 규칙: 해시 앞의 '#'만 뗀다(해시뱅 '!'은 매칭에서 처리하지 않는다).
  const target = normPath(m.hash ? (url.hash.replace(/^#/, '') || '/') : url.pathname);
  let ok = false;
  if (m.type === 'exact') ok = target === normPath(m.pattern);
  else if (m.type === 'glob') ok = globToRegex(m.pattern).test(target);
  else if (m.type === 'regex') ok = regexTest(m.pattern, target);
  if (!ok) return false;
  for (const [k, v] of Object.entries(m.query ?? {})) {
    if (!url.searchParams.has(k)) return false;
    if (v !== '*' && url.searchParams.get(k) !== v) return false;
  }
  return true;
}

function rank(page) {
  return [PRIORITY[page.match.type] ?? 0, page.match.pattern.length, Object.keys(page.match.query ?? {}).length];
}

/**
 * 사이트 파일 목록에서 URL에 맞는 페이지를 찾는다.
 * 우선순위: 종류(exact > glob > regex) → 패턴 길이 → 쿼리 조건 수. 완전 동률이면 먼저 나온 것.
 * @returns {{ siteId: string, page: object } | null}
 */
export function findPage(siteFiles, url) {
  const u = toUrl(url);
  if (!u || !Array.isArray(siteFiles)) return null;
  let best = null;
  let bestRank = null;
  for (const f of siteFiles) {
    if (!f?.site?.origins?.includes(u.origin)) continue;
    for (const p of f.pages ?? []) {
      if (!p?.match || typeof p.match.pattern !== 'string') continue;
      if (!pageMatches(p, u)) continue;
      const r = rank(p);
      if (!best || compareRank(r, bestRank) > 0) {
        best = { siteId: f.site.id, page: p };
        bestRank = r;
      }
    }
  }
  return best;
}

function compareRank(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * 해시 라우트 경로. '#/a/b' 또는 '#!/a/b' → '/a/b'. 해시 라우트가 아니면 '/'.
 * 해시 안의 쿼리('?' 뒤)는 버린다. 끝 '/'는 루트를 빼고 제거한다.
 */
export function hashPath(url) {
  const u = toUrl(url);
  if (!u || !HASH_ROUTE_RE.test(u.hash)) return '/';
  const path = u.hash.replace(/^#!?/, '').split('?')[0];
  return normPath(path || '/');
}

function isHashRoute(u) {
  return HASH_ROUTE_RE.test(u.hash);
}

// pii:begin — 이 블록은 src/shared/matcher.js와 src/content/page-agent.js에 글자 그대로 같아야 한다(테스트가 대조).
// 개인정보 마스커(설계 ⑦ 강화, 리더 결정 r5·r6·r7 — r7 조정 이후 확장 중단).
// 순서: 정규화 → 이메일 → 글자 사이 공백 주민번호형 → 주민번호형 → 카드 → 전화 → 계좌형 → 긴 숫자열.
const piiMask = '***';
// 보이지 않는 문자: soft hyphen, 결합 문자 표시 금지자, ZWSP·ZWNJ·ZWJ·LRM·RLM, 양방향 제어, word joiner 등, 한글 채움, 변형 선택자, BOM
const piiInvisibleRe = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u206a-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;
// 하이픈·대시류(하이픈, U+2010~U+2015)
const piiDash = String.raw`\-\u2010-\u2015`;
const piiSep = String.raw`[\s._${piiDash}]*`;
const piiEmailRe = /[^\s@<>()[\]{}"',;:]+@[^\s@<>()[\]{}"',;:]+/g;
// "9 0 0 1 0 1 - 1 2 3 4 5 6 7"처럼 글자 사이에 공백이 낀 주민번호형
const piiSpacedRrnRe = new RegExp(String.raw`(?<!\d)(?:\d[ \t]+){5}\d[ \t]*[.${piiDash}]?[ \t]*(?:[\d*][ \t]+){6}[\d*](?!\d)`, 'g');
const piiRrnRe = new RegExp(String.raw`(?<!\d)\d{6}${piiSep}[1-8*][\d*]{6}(?!\d)`, 'g');
const piiCardRe = new RegExp(String.raw`(?<!\d)\d{4}([ \t.${piiDash}])\d{4}\1\d{4}\1\d{3,4}(?!\d)`, 'g');
const piiPhoneRe = new RegExp(String.raw`(?<!\d)(?:\+\s*82[\s._${piiDash})]*\(?0?|\(?0)\d{1,2}\)?${piiSep}\d{3,4}${piiSep}\d{4}(?!\d)`, 'g');
// 계좌형: 같은 구분자(하이픈·대시·공백 중 한 글자)로 이은 숫자 묶음 3개 이상(합계 10자리 이상이면 마스킹).
// 구분자가 섞이면 이어 보지 않는다("2026-10-23 14:30" 보존). 마침표는 넣지 않는다(IP 주소 보존).
const piiAccountRe = new RegExp(String.raw`(?<!\d)\d+([ \t${piiDash}])\d+(?:\1\d+)+(?!\d)`, 'g');
const piiLongDigitsRe = /(?<!\d)\d{6,}(?!\d)/g;
// 9자리 이하 숫자 뒤에 바로(또는 공백 한 칸 뒤에) 붙으면 업무 수치로 보고 남기는 단위
const piiUnitRe = /^ ?(?:원|건|개|명|회|일|시간|분|초|바이트|KB|MB|%)/i;
// "hong @ corp.com"처럼 양쪽이 이메일 모양일 때만 @ 앞뒤 공백을 붙인다("회의실 @ 3층"은 그대로)
const piiSpacedAtRe = /([A-Za-z0-9._-]+)[ \t]*@[ \t]*(?=[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

// 유니코드 십진 숫자(아랍-인도 숫자 등)를 ASCII로
function piiDigitsToAscii(s) {
  return s.replace(/\p{Nd}/gu, ch => {
    const cp = ch.codePointAt(0);
    if (cp <= 0x39) return ch;
    let zero = cp;
    while (zero > cp - 9 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero -= 1;
    return String(cp - zero);
  });
}

// 검사 전 정규화: NFKC(전각 숫자·＠·－ 등) → 보이지 않는 문자 제거 → 숫자 ASCII화 → [at]·(at) → @, 이메일 모양일 때만 " @ " → @
function piiNormalize(s) {
  let t = String(s ?? '').normalize('NFKC').replace(piiInvisibleRe, '');
  t = piiDigitsToAscii(t);
  t = t.replace(/\s*[[({]\s*(?:at|골뱅이)\s*[\])}]\s*/gi, '@').replace(piiSpacedAtRe, '$1@');
  return t;
}

function piiValidYmd(d) {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(4, 6));
  const day = Number(d.slice(6, 8));
  return y >= 1900 && y <= 2099 && m >= 1 && m <= 12 && day >= 1 && day <= 31;
}

/** 문자열을 정규화하고 개인정보 패턴을 '***'로 바꾼다. */
function maskPii(s) {
  return piiNormalize(s)
    .replace(piiEmailRe, piiMask)
    .replace(piiSpacedRrnRe, piiMask)
    .replace(piiRrnRe, piiMask)
    .replace(piiCardRe, piiMask)
    .replace(piiPhoneRe, piiMask)
    .replace(piiAccountRe, m => (m.replace(/\D/g, '').length >= 10 ? piiMask : m))
    .replace(piiLongDigitsRe, (m, offset, str) => {
      if (m.length <= 9 && piiUnitRe.test(str.slice(offset + m.length))) return m;
      if (m.length === 8 && piiValidYmd(m)) return m;
      return piiMask;
    });
}

/** 개인정보 패턴이 들어 있는가(마스킹으로 바뀌는 부분이 있는가). */
function containsPii(s) {
  return maskPii(s) !== piiNormalize(s);
}
// pii:end

export { maskPii, containsPii };
export const PII_MASK = piiMask;

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** 숫자만, UUID, YYYY-MM-DD, '@'가 든 세그먼트, 개인정보 패턴이 든 세그먼트를 '*'로 바꾼다. */
export function maskPath(path) {
  return String(path)
    .split('/')
    .map(seg => {
      if (!seg) return seg;
      const d = safeDecode(seg);
      return /^\d+$/.test(seg) || UUID_RE.test(seg) || DATE_SEG_RE.test(seg) || d.includes('@') || containsPii(d) ? '*' : seg;
    })
    .join('/');
}

/**
 * 같은 탭의 연속 이벤트를 합치는 키.
 * origin + pathname(끝 '/' 제거) + 정렬한 쿼리 + 해시 라우트('#/' 또는 '#!/'로 시작할 때만, 그대로).
 * '#section' 같은 앵커는 넣지 않는다. 잘못된 URL이면 입력 문자열을 그대로 돌려준다.
 */
export function dedupeKey(url) {
  const u = toUrl(url);
  if (!u) return String(url);
  const entries = [...u.searchParams.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
  const query = new URLSearchParams(entries).toString();
  return u.origin + normPath(u.pathname) + (query ? '?' + query : '') + (isHashRoute(u) ? u.hash : '');
}

/**
 * AI 캐시 키. origin + maskPath(pathname) (+ 해시 라우트면 '#' + maskPath(hashPath)). 쿼리는 넣지 않는다.
 * 잘못된 URL이면 null.
 */
export function aiCacheKey(url) {
  const u = toUrl(url);
  if (!u) return null;
  return u.origin + maskPath(normPath(u.pathname)) + (isHashRoute(u) ? '#' + maskPath(hashPath(u)) : '');
}
