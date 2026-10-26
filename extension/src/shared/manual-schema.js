// 매뉴얼 JSON 검증(순수 함수). 규칙은 page-manual-authoring/references/manual-schema.md(schemaVersion 1)를 따르고
// validate_manuals.mjs와 같은 판정을 한다. 오류가 없으면 빈 배열을 돌려준다.

const ID_RE = /^[a-z0-9-]+$/;
const ORIGIN_RE = /^https?:\/\/[^/\s]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MATCH_TYPES = ['exact', 'glob', 'regex'];

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v, min = 1, max = Infinity) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
const isArr = (v, min = 0, max = Infinity) => Array.isArray(v) && v.length >= min && v.length <= max;

function validateMatch(m, errors) {
  if (!isObj(m)) { errors.push('match가 없습니다'); return; }
  if (!MATCH_TYPES.includes(m.type)) errors.push(`match.type은 ${MATCH_TYPES.join('|')} 중 하나여야 합니다`);
  if (!isStr(m.pattern)) { errors.push('match.pattern이 없습니다'); return; }
  if (m.type === 'regex') {
    try { new RegExp(m.pattern); } catch (e) { errors.push(`잘못된 정규식: ${e.message}`); }
  } else if (!m.pattern.startsWith('/')) {
    errors.push('match.pattern은 /로 시작해야 합니다');
  }
  if (m.query !== undefined) {
    if (!isObj(m.query)) errors.push('match.query는 객체여야 합니다');
    else for (const [k, v] of Object.entries(m.query)) if (typeof v !== 'string') errors.push(`match.query.${k} 값은 문자열이어야 합니다`);
  }
  if (m.hash !== undefined && typeof m.hash !== 'boolean') errors.push('match.hash는 boolean이어야 합니다');
}

/**
 * 페이지 하나를 검사한다.
 * full=false(AI 생성 결과)면 내용 필드(title, role, features, howTo, tips)만 검사한다.
 * @returns {string[]} 오류 목록
 */
export function validatePage(page, { full = true } = {}) {
  const errors = [];
  if (!isObj(page)) return ['페이지 객체가 아닙니다'];
  const p = page;
  if (full) {
    if (!isStr(p.id) || !ID_RE.test(p.id)) errors.push('id는 ^[a-z0-9-]+$ 형식이어야 합니다');
    validateMatch(p.match, errors);
    if (!DATE_RE.test(p.updatedAt ?? '')) errors.push('updatedAt은 YYYY-MM-DD 형식이어야 합니다');
    if (!['authored', 'ai'].includes(p.source)) errors.push('source는 authored|ai 여야 합니다');
    if (p.related !== undefined && !isArr(p.related)) errors.push('related는 배열이어야 합니다');
  }
  if (!isStr(p.title, 1, 60)) errors.push('title은 1~60자여야 합니다');
  if (!isStr(p.role, 10, 300)) errors.push('role은 10~300자여야 합니다');
  if (!isArr(p.features, 1, 10)) errors.push('features는 1~10개여야 합니다');
  else p.features.forEach((f, i) => {
    if (!isStr(f?.name) || !isStr(f?.description)) errors.push(`features[${i}]에 name/description이 필요합니다`);
  });
  if (!isArr(p.howTo, 1, 8)) errors.push('howTo는 1~8개여야 합니다');
  else p.howTo.forEach((h, i) => {
    if (!isStr(h?.task)) errors.push(`howTo[${i}].task가 없습니다`);
    if (!isArr(h?.steps, 1, 12) || !h.steps.every(s => isStr(s))) errors.push(`howTo[${i}].steps는 문자열 1~12개여야 합니다`);
    if (h?.targets !== undefined && (!isArr(h.targets) || !h.targets.every(s => isStr(s)))) errors.push(`howTo[${i}].targets는 문자열 배열이어야 합니다`);
  });
  if (p.tips !== undefined && (!isArr(p.tips, 0, 8) || !p.tips.every(s => isStr(s)))) errors.push('tips는 문자열 0~8개여야 합니다');
  return errors;
}

/**
 * 사이트 파일 하나를 검사한다. 페이지 오류는 `pages[i](id): ` 접두사를 붙인다.
 * @param {object} file 사이트 파일 JSON
 * @param {string} [fileName] 'groupware.json' 같은 파일 이름. 주면 site.id와 같은지 확인한다.
 * @returns {string[]} 오류 목록
 */
export function validateSiteFile(file, fileName) {
  const errors = [];
  if (!isObj(file)) return ['사이트 파일 객체가 아닙니다'];
  if (file.schemaVersion !== 1) errors.push('schemaVersion은 1이어야 합니다');
  if (!isStr(file.site?.id) || !ID_RE.test(file.site.id)) errors.push('site.id 형식 오류');
  if (fileName !== undefined) {
    const base = String(fileName).split(/[\\/]/).pop().replace(/\.json$/, '');
    if (base !== file.site?.id) errors.push('파일 이름과 site.id가 다릅니다');
  }
  if (!isArr(file.site?.origins, 1) || !file.site.origins.every(o => typeof o === 'string' && ORIGIN_RE.test(o))) {
    errors.push('site.origins는 https?://host 형식 1개 이상이어야 합니다');
  }
  if (!isArr(file.pages)) { errors.push('pages 배열이 필요합니다'); return errors; }
  const ids = new Set();
  file.pages.forEach((p, i) => {
    const where = `pages[${i}]${p?.id ? `(${p.id})` : ''}`;
    for (const e of validatePage(p)) errors.push(`${where}: ${e}`);
    if (p?.id) {
      if (ids.has(p.id)) errors.push(`${where}: id가 중복됩니다`);
      ids.add(p.id);
    }
  });
  file.pages.forEach((p, i) => {
    if (!Array.isArray(p?.related)) return;
    for (const r of p.related) if (!ids.has(r)) errors.push(`pages[${i}]${p?.id ? `(${p.id})` : ''}: related의 '${r}'가 이 파일에 없습니다`);
  });
  return errors;
}

/**
 * manuals/index.json을 검사한다.
 * @returns {string[]} 오류 목록
 */
export function validateIndex(index) {
  const errors = [];
  if (!isObj(index)) return ['index 객체가 아닙니다'];
  if (index.schemaVersion !== 1) errors.push('schemaVersion은 1이어야 합니다');
  if (!isArr(index.sites)) { errors.push('sites 배열이 필요합니다'); return errors; }
  index.sites.forEach((s, i) => {
    if (!isStr(s?.siteId) || !ID_RE.test(s.siteId)) errors.push(`sites[${i}].siteId 형식 오류`);
    if (!isStr(s?.file) || !/\.json$/.test(s.file) || /[\\/]/.test(s.file)) errors.push(`sites[${i}].file은 같은 폴더의 .json 파일 이름이어야 합니다`);
    else if (isStr(s?.siteId) && s.file !== `${s.siteId}.json`) errors.push(`sites[${i}].file(${s.file})이 siteId와 다릅니다`);
  });
  return errors;
}
