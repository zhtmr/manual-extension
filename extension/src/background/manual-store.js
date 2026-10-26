// 패키지 매뉴얼 로더. extension/manuals/(배포)와, 개발 설치일 때만 extension/manuals-dev/(데모)를 읽는다.
// 런타임에도 스키마를 검사해 깨진 사이트·페이지를 그리지 않는다. 오류 문자열을 파싱하지 않고
// 단계마다 검증 함수를 직접 불러 판정한다.
import { validateIndex, validateSiteFile, validatePage } from '../shared/manual-schema.js';
import { findPage } from '../shared/matcher.js';
import { BUILD_INFO } from '../shared/build-info.js';

const MANUAL_DIRS = ['manuals'];
const DEV_MANUAL_DIRS = ['manuals-dev'];

const warn = msg => console.warn(`[page-manual] ${msg}`);

/**
 * 매뉴얼 폴더 하나를 읽어 검증을 통과한 사이트 파일 목록을 돌려준다.
 * - index 자체가 깨졌으면(schemaVersion·sites) 폴더 전체를 건너뛴다.
 * - index 항목이 깨졌거나, 파일을 못 읽었거나, 사이트 수준 오류(schemaVersion, site.id, index siteId 불일치,
 *   파일 이름, origins)가 있으면 그 사이트만 건너뛴다.
 * - 페이지 오류가 있으면 그 페이지만 뺀다. 같은 id가 다시 나오면 뒤의 것을 뺀다.
 * - related는 남은 페이지 id만 남긴다(다른 페이지가 빠져도 이 페이지는 살린다).
 * @param {string} dir 'manuals' 같은 확장 루트 기준 폴더
 * @param {(path: string) => Promise<any>} fetchJson 경로를 받아 JSON을 돌려준다. 실패하면 throw.
 * @param {{ optional?: boolean }} [opts] optional이면 index가 없을 때 경고하지 않는다(배포물의 manuals-dev).
 */
export async function loadManualDir(dir, fetchJson, { optional = false } = {}) {
  let index;
  try {
    index = await fetchJson(`${dir}/index.json`);
  } catch (e) {
    if (!optional) warn(`${dir}/index.json을 읽을 수 없습니다 (${e?.message ?? e})`);
    return [];
  }
  if (validateIndex({ schemaVersion: index?.schemaVersion, sites: [] }).length || !Array.isArray(index?.sites)) {
    warn(`${dir}/index.json 형식 오류로 건너뜁니다`);
    return [];
  }

  const out = [];
  for (const entry of index.sites) {
    if (validateIndex({ schemaVersion: 1, sites: [entry] }).length) {
      warn(`${dir}/index.json의 항목 ${JSON.stringify(entry)?.slice(0, 80)} 형식 오류로 건너뜁니다`);
      continue;
    }
    let file;
    try {
      file = await fetchJson(`${dir}/${entry.file}`);
    } catch (e) {
      warn(`${dir}/${entry.file}을 읽을 수 없습니다 (${e?.message ?? e})`);
      continue;
    }
    const site = sanitizeSiteFile(file, entry, `${dir}/${entry.file}`);
    if (site) out.push(site);
  }
  return out;
}

function sanitizeSiteFile(file, entry, where) {
  if (!file || typeof file !== 'object' || Array.isArray(file)) {
    warn(`${where}: 사이트 파일 객체가 아니어서 건너뜁니다`);
    return null;
  }
  // 페이지를 비우고 검사하면 사이트 수준 오류만 남는다.
  const siteErrors = validateSiteFile({ ...file, pages: [] }, entry.file);
  if (siteErrors.length || file.site.id !== entry.siteId || !Array.isArray(file.pages)) {
    warn(`${where}: 사이트 정보 오류로 건너뜁니다`);
    return null;
  }
  const ids = new Set();
  const pages = [];
  file.pages.forEach((p, i) => {
    if (validatePage(p).length) {
      warn(`${where}: pages[${i}] 스키마 오류로 제외합니다`);
      return;
    }
    if (ids.has(p.id)) {
      warn(`${where}: pages[${i}](${p.id}) id 중복으로 제외합니다`);
      return;
    }
    ids.add(p.id);
    pages.push(p);
  });
  const cleaned = pages.map(p => (Array.isArray(p.related) && p.related.some(r => !ids.has(r))
    ? { ...p, related: p.related.filter(r => ids.has(r)) }
    : p));
  return { ...file, pages: cleaned };
}

/**
 * URL에 맞는 작성 매뉴얼과 관련 페이지 목록을 찾는다(순수 함수).
 * @returns {{ siteId: string, page: object, related: { id: string, title: string }[] } | null}
 */
export function resolveAuthored(siteFiles, url) {
  const hit = findPage(siteFiles, url);
  if (!hit) return null;
  const file = siteFiles.find(f => f.site?.id === hit.siteId && f.pages?.includes(hit.page));
  const byId = new Map((file?.pages ?? []).map(p => [p.id, p]));
  const related = (hit.page.related ?? [])
    .filter(id => id !== hit.page.id && byId.has(id))
    .map(id => ({ id, title: byId.get(id).title }));
  return { siteId: hit.siteId, page: hit.page, related };
}

// --- 확장 런타임 전용 ---

async function extensionFetchJson(path) {
  const res = await fetch(chrome.runtime.getURL(path));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 개발 설치(압축 해제 로드)인가. management.getSelf는 권한이 필요 없다. */
/**
 * 데모 매뉴얼(manuals-dev/)을 읽을지: 개발 원본 빌드(build-info 표식)이고 개발 설치일 때만.
 * 배포물은 표식이 false라서 fetch 자체를 하지 않는다(없는 파일로 콘솔 오류를 남기지 않게).
 */
export async function shouldLoadDevManuals({ buildInfo = BUILD_INFO, isDevInstall = isDevelopmentInstall } = {}) {
  if (!buildInfo?.includesDevManuals) return false;
  return isDevInstall();
}

export async function isDevelopmentInstall() {
  try {
    const self = await chrome.management.getSelf();
    return self?.installType === 'development';
  } catch {
    return false;
  }
}

let cached = null;

/**
 * 모든 매뉴얼 사이트 파일을 읽는다. 워커 수명 동안 메모리에 캐시한다(재시작하면 다시 읽는다).
 * @returns {Promise<object[]>}
 */
export function loadManuals() {
  if (!cached) {
    cached = (async () => {
      const files = [];
      for (const dir of MANUAL_DIRS) files.push(...await loadManualDir(dir, extensionFetchJson));
      if (await shouldLoadDevManuals()) {
        for (const dir of DEV_MANUAL_DIRS) files.push(...await loadManualDir(dir, extensionFetchJson, { optional: true }));
      }
      return files;
    })().catch(e => {
      warn(`매뉴얼을 불러오지 못했습니다 (${e?.message ?? e})`);
      cached = null;
      return [];
    });
  }
  return cached;
}

export function resetManualCache() {
  cached = null;
}
