#!/usr/bin/env node
// 배포 폴더 만들기(설계 ⑥-3, ⑧ 마무리).
// 사용법: node tools/package-extension.mjs [--out <폴더>]   (기본: dist/manual-extension)
//  1. extension/을 복사하되 manuals-dev/, tests/, package.json은 뺀다.
//  2. manifest의 host_permissions·optional_host_permissions에서 localhost/127.0.0.1/[::1] 항목을 지운다.
//     src/shared/build-info.js를 includesDevManuals: false로 바꿔 쓴다(배포물은 manuals-dev를 읽지 않음).
//  3. 결과물에 validate_extension.mjs를 돌려 오류 0건을 확인한다.
//  4. 배포물에 manuals-dev·tests 폴더, package.json, localhost 권한·문자열이 하나도 없는지 검사한다.
// 외부 패키지 없이 node 내장 모듈만 쓴다. zip이 필요하면 만든 폴더를 압축한다.
// 하나라도 실패하면 종료 코드 1. 결과 폴더(dist/)는 저장소에 넣지 않는다(.gitignore).
import { cpSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve, relative, dirname, sep, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'extension');
const VALIDATOR = join(ROOT, '.claude', 'skills', 'extension-qa', 'scripts', 'validate_extension.mjs');

// 배포물에 넣지 않는 것(extension/ 기준 최상위 이름)
export const EXCLUDED_TOP = ['manuals-dev', 'tests', 'package.json'];
// 개발 전용 host 패턴
const DEV_HOST_RE = /^[a-z*]+:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//i;
// 배포물 어떤 파일 내용에도 있으면 안 되는 문자열
const FORBIDDEN_CONTENT = /localhost|127\.0\.0\.1|\[::1\]/i;
// 배포물의 빌드 표식 파일과 내용
export const BUILD_INFO_PATH = join('src', 'shared', 'build-info.js');
export const RELEASE_BUILD_INFO = [
  '// 빌드 표식(배포물). tools/package-extension.mjs가 만들었다. 데모 매뉴얼(manuals-dev/)은 싣지 않는다.',
  'export const BUILD_INFO = Object.freeze({ includesDevManuals: false });',
  '',
].join('\n');
// 내용 검사 대상 확장자(바이너리 제외)
const TEXT_EXT = /\.(js|mjs|json|html|css|txt|md)$/i;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** manifest에서 개발 전용 host 권한을 지운 사본. */
export function stripDevHosts(manifest) {
  const m = structuredClone(manifest);
  for (const key of ['host_permissions', 'optional_host_permissions']) {
    if (Array.isArray(m[key])) m[key] = m[key].filter(h => !DEV_HOST_RE.test(h));
  }
  return m;
}

/** 배포 폴더 검사. 문제 목록을 돌려준다(빈 배열이면 통과). */
export function inspectPackage(outDir) {
  const problems = [];
  for (const name of EXCLUDED_TOP) if (existsSync(join(outDir, name))) problems.push(`${name}이 배포물에 있습니다`);
  const files = walk(outDir);
  for (const f of files) {
    const rel = relative(outDir, f);
    const parts = rel.split(sep);
    if (parts.some(p => p === 'manuals-dev' || p === 'tests')) problems.push(`개발 전용 경로 ${rel}`);
    if (TEXT_EXT.test(f) && FORBIDDEN_CONTENT.test(readFileSync(f, 'utf8'))) problems.push(`${rel}에 localhost 문자열이 있습니다`);
  }
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
  } catch (e) {
    problems.push(`manifest.json을 읽을 수 없습니다(${e.message})`);
  }
  if (manifest) {
    const hosts = [...(manifest.host_permissions ?? []), ...(manifest.optional_host_permissions ?? [])];
    for (const h of hosts) if (DEV_HOST_RE.test(h)) problems.push(`manifest에 개발 전용 권한 ${h}`);
    if (!hosts.includes('https://api.anthropic.com/*')) problems.push('manifest에 https://api.anthropic.com/* 권한이 없습니다');
  }
  const buildInfoPath = join(outDir, BUILD_INFO_PATH);
  // 주석이 아닌 실제 선언을 본다(개발용 파일의 주석에도 "includesDevManuals: false"라는 글자가 있다).
  const releaseDecl = /^export const BUILD_INFO = Object\.freeze\(\{ includesDevManuals: false \}\);$/m;
  if (!existsSync(buildInfoPath) || !releaseDecl.test(readFileSync(buildInfoPath, 'utf8'))) {
    problems.push('src/shared/build-info.js가 배포용(includesDevManuals: false)이 아닙니다');
  }
  return problems;
}

/** 배포 폴더를 만들고 검증한다. @returns {{ ok: boolean, outDir: string, problems: string[], validatorOutput: string }} */
export function packageExtension({ outDir = join(ROOT, 'dist', 'manual-extension'), validator = VALIDATOR } = {}) {
  const out = resolve(outDir);
  // 엉뚱한 곳을 지우지 않도록: 저장소 루트·extension 원본·그 상위를 대상으로 삼지 않는다.
  if (out === ROOT || out === SRC || SRC.startsWith(out + sep) || out.startsWith(SRC + sep) || out === resolve(sep) || basename(out) === '') {
    throw new Error(`출력 폴더로 쓸 수 없습니다: ${out}`);
  }
  rmSync(out, { recursive: true, force: true });
  mkdirSync(dirname(out), { recursive: true });
  cpSync(SRC, out, {
    recursive: true,
    filter: src => {
      const rel = relative(SRC, src);
      if (!rel) return true;
      return !EXCLUDED_TOP.includes(rel.split(sep)[0]);
    },
  });
  const manifestPath = join(out, 'manifest.json');
  const manifest = stripDevHosts(JSON.parse(readFileSync(manifestPath, 'utf8')));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(out, BUILD_INFO_PATH), RELEASE_BUILD_INFO);

  const problems = inspectPackage(out);
  const r = spawnSync(process.execPath, [validator, out], { encoding: 'utf8' });
  const validatorOutput = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) problems.push(`validate_extension.mjs 실패(종료 코드 ${r.status})`);
  return { ok: problems.length === 0, outDir: out, problems, validatorOutput };
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  const a = resolve(process.argv[1]);
  const b = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
})();

if (isMain) {
  const i = process.argv.indexOf('--out');
  const outDir = i >= 0 ? process.argv[i + 1] : undefined;
  try {
    const r = packageExtension(outDir ? { outDir } : {});
    process.stdout.write(r.validatorOutput);
    for (const p of r.problems) console.log(`문제  ${p}`);
    console.log(r.ok ? `\n배포 폴더를 만들었습니다: ${r.outDir}` : `\n배포 폴더 검사 실패(${r.problems.length}건): ${r.outDir}`);
    process.exit(r.ok ? 0 : 1);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
