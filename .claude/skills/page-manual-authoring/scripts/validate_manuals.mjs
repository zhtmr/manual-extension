#!/usr/bin/env node
// 매뉴얼 JSON 검증기. 규칙은 references/manual-schema.md를 따른다.
// 사용법:
//   node validate_manuals.mjs <manualsDir> [--samples <00_pages.json>]
//   node validate_manuals.mjs --page <draft.json>
// 오류가 있으면 종료 코드 1.

import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const ID_RE = /^[a-z0-9-]+$/;
const ORIGIN_RE = /^https?:\/\/[^/\s]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MATCH_TYPES = ['exact', 'glob', 'regex'];
const PRIORITY = { exact: 3, glob: 2, regex: 1 };

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    err(path, `JSON을 읽을 수 없습니다 (${e.message})`);
    return null;
  }
}

const isStr = (v, min = 1, max = Infinity) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
const isArr = (v, min = 0, max = Infinity) => Array.isArray(v) && v.length >= min && v.length <= max;

function validateMatch(where, m) {
  if (!m || typeof m !== 'object') return err(where, 'match가 없습니다');
  if (!MATCH_TYPES.includes(m.type)) err(where, `match.type은 ${MATCH_TYPES.join('|')} 중 하나여야 합니다`);
  if (!isStr(m.pattern)) return err(where, 'match.pattern이 없습니다');
  if (m.type === 'regex') {
    try { new RegExp(m.pattern); } catch (e) { err(where, `잘못된 정규식: ${e.message}`); }
  } else if (!m.pattern.startsWith('/')) {
    err(where, 'match.pattern은 /로 시작해야 합니다');
  }
  if (m.query !== undefined) {
    if (typeof m.query !== 'object' || Array.isArray(m.query)) err(where, 'match.query는 객체여야 합니다');
    else for (const [k, v] of Object.entries(m.query)) if (typeof v !== 'string') err(where, `match.query.${k} 값은 문자열이어야 합니다`);
  }
  if (m.hash !== undefined && typeof m.hash !== 'boolean') err(where, 'match.hash는 boolean이어야 합니다');
}

// full=false면 AI 생성 결과 규칙(내용 필드만)으로 검사한다.
export function validatePage(where, p, { full = true } = {}) {
  if (!p || typeof p !== 'object') return err(where, '페이지 객체가 아닙니다');
  if (full) {
    if (!isStr(p.id) || !ID_RE.test(p.id)) err(where, 'id는 ^[a-z0-9-]+$ 형식이어야 합니다');
    validateMatch(where, p.match);
    if (!DATE_RE.test(p.updatedAt ?? '')) err(where, 'updatedAt은 YYYY-MM-DD 형식이어야 합니다');
    if (!['authored', 'ai'].includes(p.source)) err(where, 'source는 authored|ai 여야 합니다');
    if (p.related !== undefined && !isArr(p.related)) err(where, 'related는 배열이어야 합니다');
  }
  if (!isStr(p.title, 1, 60)) err(where, 'title은 1~60자여야 합니다');
  if (!isStr(p.role, 10, 300)) err(where, 'role은 10~300자여야 합니다');
  if (!isArr(p.features, 1, 10)) err(where, 'features는 1~10개여야 합니다');
  else p.features.forEach((f, i) => {
    if (!isStr(f?.name) || !isStr(f?.description)) err(where, `features[${i}]에 name/description이 필요합니다`);
  });
  if (!isArr(p.howTo, 1, 8)) err(where, 'howTo는 1~8개여야 합니다');
  else p.howTo.forEach((h, i) => {
    if (!isStr(h?.task)) err(where, `howTo[${i}].task가 없습니다`);
    if (!isArr(h?.steps, 1, 12) || !h.steps.every(s => isStr(s))) err(where, `howTo[${i}].steps는 문자열 1~12개여야 합니다`);
    if (h?.targets !== undefined && (!isArr(h.targets) || !h.targets.every(s => isStr(s)))) err(where, `howTo[${i}].targets는 문자열 배열이어야 합니다`);
  });
  if (p.tips !== undefined && (!isArr(p.tips, 0, 8) || !p.tips.every(s => isStr(s)))) err(where, 'tips는 문자열 0~8개여야 합니다');
}

// --- 매칭 (chrome-extension-dev references/architecture.md 「URL 매칭」과 같은 규칙) ---
function normPath(p) {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}
function globToRegex(glob) {
  const esc = normPath(glob).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + esc.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]+').replace(/\u0000/g, '.*') + '$');
}
function pageMatches(page, url) {
  const m = page.match;
  const target = normPath(m.hash ? (url.hash.replace(/^#/, '') || '/') : url.pathname);
  let ok = false;
  if (m.type === 'exact') ok = target === normPath(m.pattern);
  else if (m.type === 'glob') ok = globToRegex(m.pattern).test(target);
  else { try { ok = new RegExp(m.pattern).test(target); } catch { ok = false; } }
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
export function findPage(siteFiles, rawUrl) {
  const url = new URL(rawUrl);
  const hits = [];
  for (const f of siteFiles) {
    if (!f.site?.origins?.includes(url.origin)) continue;
    for (const p of f.pages ?? []) if (p.match && pageMatches(p, url)) hits.push({ siteId: f.site.id, page: p });
  }
  hits.sort((a, b) => {
    const ra = rank(a.page), rb = rank(b.page);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i];
    return 0;
  });
  return { best: hits[0] ?? null, tie: hits.length > 1 && rank(hits[0].page).join() === rank(hits[1].page).join() ? hits[1] : null };
}

// --- 실행 ---
const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

if (opt('--page')) {
  const path = opt('--page');
  const p = readJson(path);
  if (p) validatePage(basename(path), p);
} else {
  const dir = argv.find(a => !a.startsWith('--') && a !== opt('--samples'));
  if (!dir) {
    console.error('사용법: validate_manuals.mjs <manualsDir> [--samples <pages.json>] | --page <draft.json>');
    process.exit(2);
  }
  const indexPath = join(dir, 'index.json');
  const index = existsSync(indexPath) ? readJson(indexPath) : (err(indexPath, '파일이 없습니다'), null);
  const siteFiles = [];
  if (index) {
    if (index.schemaVersion !== 1) err('index.json', 'schemaVersion은 1이어야 합니다');
    if (!isArr(index.sites)) err('index.json', 'sites 배열이 필요합니다');
    for (const s of index.sites ?? []) {
      // 확장 런타임(validateIndex)과 같은 규칙: file은 manuals 폴더 바로 아래 파일 이름만 허용
      if (typeof s.file === 'string' && /[\\/]|\.\./.test(s.file)) { err('index.json', `${s.siteId}의 file '${s.file}'에 경로 구분자를 쓸 수 없습니다`); continue; }
      const path = join(dir, s.file ?? '');
      if (!s.file || !existsSync(path)) { err('index.json', `${s.siteId}의 파일 ${s.file}이 없습니다`); continue; }
      const f = readJson(path);
      if (!f) continue;
      const where = s.file;
      if (f.schemaVersion !== 1) err(where, 'schemaVersion은 1이어야 합니다');
      if (!isStr(f.site?.id) || !ID_RE.test(f.site.id)) err(where, 'site.id 형식 오류');
      if (f.site?.id !== s.siteId) err(where, `site.id(${f.site?.id})가 index의 siteId(${s.siteId})와 다릅니다`);
      if (basename(s.file, '.json') !== f.site?.id) err(where, '파일 이름과 site.id가 다릅니다');
      if (!isArr(f.site?.origins, 1) || !f.site.origins.every(o => ORIGIN_RE.test(o))) err(where, 'site.origins는 https?://host 형식 1개 이상이어야 합니다');
      if (!isArr(f.pages)) { err(where, 'pages 배열이 필요합니다'); continue; }
      const ids = new Set();
      f.pages.forEach((p, i) => {
        const pw = `${where} pages[${i}]${p?.id ? `(${p.id})` : ''}`;
        validatePage(pw, p);
        if (p?.id) { if (ids.has(p.id)) err(pw, 'id가 중복됩니다'); ids.add(p.id); }
        if (p?.source === 'ai') warn(pw, '저장된 매뉴얼의 source가 ai입니다');
      });
      f.pages.forEach(p => (p?.related ?? []).forEach(r => { if (!ids.has(r)) err(`${where} ${p.id}`, `related의 '${r}'가 이 파일에 없습니다`); }));
      siteFiles.push(f);
    }
  }
  const samplesPath = opt('--samples');
  if (samplesPath) {
    const samples = readJson(samplesPath);
    for (const s of samples?.pages ?? []) {
      let r;
      try { r = findPage(siteFiles, s.url); } catch (e) { err('samples', `${s.url} URL 해석 실패: ${e.message}`); continue; }
      if (!r.best) err('samples', `${s.pageId}: ${s.url}에 맞는 매뉴얼이 없습니다`);
      else if (r.best.page.id !== s.pageId) err('samples', `${s.pageId}: ${s.url}이 다른 매뉴얼 '${r.best.page.id}'에 매칭됩니다`);
      if (r?.tie) warn('samples', `${s.url}: '${r.best.page.id}'와 '${r.tie.page.id}'가 같은 우선순위로 매칭됩니다`);
    }
  }
}

for (const w of warnings) console.log(`경고  ${w}`);
for (const e of errors) console.log(`오류  ${e}`);
console.log(`\n결과: 오류 ${errors.length}건, 경고 ${warnings.length}건`);
process.exit(errors.length ? 1 : 0);
