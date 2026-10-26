#!/usr/bin/env node
// 페이지 매뉴얼 확장 정적 검증기.
// 사용법: node validate_extension.mjs <extensionDir>
// manifest, 참조 파일, 메시지 계약(MSG), 보안 패턴, 매뉴얼 origin 권한을 검사한다. 오류가 있으면 종료 코드 1.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = process.argv[2];
if (!root) { console.error('사용법: validate_extension.mjs <extensionDir>'); process.exit(2); }

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
const read = p => readFileSync(p, 'utf8');
const exists = rel => existsSync(join(root, rel));

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out); } else out.push(p);
  }
  return out;
}

// 1. manifest
let manifest = null;
try { manifest = JSON.parse(read(join(root, 'manifest.json'))); }
catch (e) { err('manifest.json', `읽을 수 없습니다 (${e.message})`); }

if (manifest) {
  if (manifest.manifest_version !== 3) err('manifest.json', 'manifest_version은 3이어야 합니다');
  const perms = manifest.permissions ?? [];
  for (const p of ['sidePanel', 'storage', 'tabs', 'webNavigation']) if (!perms.includes(p)) err('manifest.json', `permissions에 ${p}가 없습니다`);
  const sp = manifest.side_panel?.default_path;
  if (!sp) err('manifest.json', 'side_panel.default_path가 없습니다');
  else if (!exists(sp)) err('manifest.json', `side_panel 파일 ${sp}이 없습니다`);
  const sw = manifest.background?.service_worker;
  if (!sw) err('manifest.json', 'background.service_worker가 없습니다');
  else {
    if (!exists(sw)) err('manifest.json', `서비스 워커 ${sw}이 없습니다`);
    if (manifest.background.type !== 'module') warn('manifest.json', 'background.type이 module이 아닙니다(ES 모듈 import 불가)');
  }
  for (const cs of manifest.content_scripts ?? []) for (const f of cs.js ?? []) if (!exists(f)) err('manifest.json', `content script ${f}이 없습니다`);
  const opts = manifest.options_ui?.page ?? manifest.options_page;
  if (opts && !exists(opts)) err('manifest.json', `옵션 페이지 ${opts}이 없습니다`);
  for (const icon of Object.values(manifest.icons ?? {})) if (!exists(icon)) err('manifest.json', `아이콘 ${icon}이 없습니다`);
  const hosts = [...(manifest.host_permissions ?? []), ...(manifest.optional_host_permissions ?? [])];
  if (hosts.includes('<all_urls>') || hosts.includes('*://*/*')) warn('manifest.json', '모든 사이트 권한을 요청합니다. 대상 origin만 나열하세요');
  if (!hosts.some(h => h.startsWith('https://api.anthropic.com'))) warn('manifest.json', 'host_permissions에 https://api.anthropic.com/*가 없습니다(AI 폴백 불가)');

  // 매뉴얼 origin이 권한에 있는가
  const indexPath = join(root, 'manuals', 'index.json');
  if (existsSync(indexPath)) {
    try {
      const index = JSON.parse(read(indexPath));
      for (const s of index.sites ?? []) {
        const site = JSON.parse(read(join(root, 'manuals', s.file)));
        for (const o of site.site?.origins ?? []) {
          if (!hosts.some(h => h === `${o}/*` || h.startsWith(`${o}/`))) err('manifest.json', `매뉴얼 origin ${o}에 대한 host 권한이 없습니다`);
        }
      }
    } catch (e) { err('manuals', `index.json 또는 사이트 파일을 읽을 수 없습니다 (${e.message})`); }
  } else warn('manuals', 'manuals/index.json이 없습니다');
}

// 2. HTML이 참조하는 로컬 파일과 원격 스크립트
const files = walk(join(root, 'src'));
for (const f of files.filter(f => extname(f) === '.html')) {
  const html = read(f);
  const rel = relative(root, f);
  for (const m of html.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/g)) {
    const ref = m[1];
    if (/^(https?:)?\/\//.test(ref)) { err(rel, `원격 리소스 ${ref} (MV3 CSP 위반)`); continue; }
    const target = ref.startsWith('/') ? join(root, ref) : join(dirname(f), ref);
    if (!existsSync(target)) err(rel, `참조 파일 ${ref}이 없습니다`);
  }
  if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(html)) err(rel, '인라인 스크립트가 있습니다(MV3 CSP 위반)');
}

// 3. 메시지 계약
const jsFiles = files.filter(f => extname(f) === '.js');
const parseConsts = src => Object.fromEntries([...src.matchAll(/\b([A-Z][A-Z_]*)\s*:\s*['"]([A-Za-z_]+)['"]/g)].map(m => [m[1], m[2]]));
const msgPath = join(root, 'src', 'shared', 'messages.js');
let MSG = {};
if (!existsSync(msgPath)) err('src/shared/messages.js', '메시지 상수 파일이 없습니다');
else {
  MSG = parseConsts(read(msgPath));
  if (!Object.keys(MSG).length) err('src/shared/messages.js', 'MSG 상수를 찾지 못했습니다');
  for (const [k, v] of Object.entries(MSG)) if (k !== v) warn('messages.js', `${k}의 값이 키와 다릅니다(${v})`);
}
const usage = Object.fromEntries(Object.keys(MSG).map(k => [k, new Set()]));
for (const f of jsFiles) {
  const src = read(f);
  const rel = relative(root, f);
  if (f === msgPath) continue;
  for (const m of src.matchAll(/\bMSG\.([A-Z_]+)/g)) {
    if (!(m[1] in MSG)) err(rel, `정의되지 않은 메시지 MSG.${m[1]}`);
    else usage[m[1]].add(rel);
  }
  // 콘텐츠 스크립트의 복사본은 원본과 같아야 한다
  if (/sync:\s*src\/shared\/messages\.js/.test(src)) {
    const copy = parseConsts(src);
    for (const [k, v] of Object.entries(copy)) {
      if (!(k in MSG)) err(rel, `복사본의 ${k}가 messages.js에 없습니다`);
      else if (MSG[k] !== v) err(rel, `MSG.${k} 값이 messages.js와 다릅니다(${v} ≠ ${MSG[k]})`);
    }
  }
  // 보안 패턴
  if (/\beval\s*\(|new\s+Function\s*\(/.test(src)) err(rel, 'eval/new Function 사용(MV3 CSP 위반)');
  for (const m of src.matchAll(/\.innerHTML\s*=\s*([^;\n]+)/g)) {
    if (!/^\s*(['"`])\s*\1\s*$/.test(m[1])) warn(rel, `innerHTML 대입: ${m[1].trim().slice(0, 40)} — AI 응답이나 페이지 텍스트라면 XSS 위험`);
  }
  if (/console\.\w+\([^)]*apiKey/i.test(src)) err(rel, 'API 키를 콘솔에 출력할 수 있습니다');
  if (/\.value\b/.test(src) && /page-agent|content/.test(rel) && /JSON\.stringify|fields\.push|value:/.test(src)) {
    warn(rel, '콘텐츠 스크립트에서 입력값(.value)을 수집하는지 확인하세요(외부 전송 금지)');
  }
}
for (const [k, set] of Object.entries(usage)) {
  if (set.size === 0) warn('messages.js', `MSG.${k}를 쓰는 곳이 없습니다`);
  else if (set.size === 1) warn('messages.js', `MSG.${k}가 ${[...set][0]} 한 파일에서만 쓰입니다(보내는 쪽 또는 받는 쪽 누락?)`);
}

// 4. 매뉴얼 스키마 검증 위임
const manualValidator = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'page-manual-authoring', 'scripts', 'validate_manuals.mjs');
if (existsSync(join(root, 'manuals', 'index.json')) && existsSync(manualValidator)) {
  const r = spawnSync(process.execPath, [manualValidator, join(root, 'manuals')], { encoding: 'utf8' });
  if (r.status !== 0) {
    for (const line of r.stdout.split('\n').filter(l => l.startsWith('오류'))) err('manuals', line.replace(/^오류\s+/, ''));
  }
}

for (const w of warnings) console.log(`경고  ${w}`);
for (const e of errors) console.log(`오류  ${e}`);
console.log(`\n결과: 오류 ${errors.length}건, 경고 ${warnings.length}건`);
process.exit(errors.length ? 1 : 0);
