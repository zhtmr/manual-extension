// tools/package-extension.mjs: 배포 폴더 생성·검사. 임시 폴더에 만들어 확인한다(dist/는 건드리지 않음).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packageExtension, stripDevHosts, inspectPackage, EXCLUDED_TOP } from '../../tools/package-extension.mjs';

const EXT = fileURLToPath(new URL('../', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'pm-pkg-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const walk = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};

const out = join(tmp, 'manual-extension');
const result = packageExtension({ outDir: out });

test('배포 폴더: 검사 통과, validate_extension 오류 0건', () => {
  assert.deepEqual(result.problems, [], result.validatorOutput);
  assert.equal(result.ok, true);
  assert.match(result.validatorOutput, /결과: 오류 0건/);
});

test('배포 폴더: manuals-dev·tests·package.json 없음, 나머지 파일은 원본과 같다', () => {
  for (const n of EXCLUDED_TOP) assert.equal(existsSync(join(out, n)), false, n);
  const shipped = walk(out).map(f => relative(out, f).split(sep).join('/')).sort();
  assert.ok(shipped.every(p => !p.startsWith('manuals-dev/') && !p.startsWith('tests/') && p !== 'package.json'));
  const expected = walk(EXT).map(f => relative(EXT, f).split(sep).join('/'))
    .filter(p => !EXCLUDED_TOP.includes(p.split('/')[0])).sort();
  assert.deepEqual(shipped, expected);
  for (const p of expected.filter(p => p !== 'manifest.json' && p !== 'src/shared/build-info.js')) {
    assert.ok(readFileSync(join(out, p)).equals(readFileSync(join(EXT, p))), `${p} 내용이 다릅니다`);
  }
  assert.ok(shipped.includes('src/content/page-agent.js') && shipped.includes('manuals/index.json'));
});

test('배포 manifest: localhost 권한만 빠지고 나머지는 원본과 같다, 원본은 그대로', () => {
  const src = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
  const dist = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.ok(!JSON.stringify(dist).includes('localhost'));
  assert.deepEqual(dist.host_permissions, ['https://api.anthropic.com/*']);
  assert.deepEqual(dist.optional_host_permissions, ['https://*/*', 'http://*/*']);
  assert.deepEqual({ ...dist, host_permissions: src.host_permissions }, src);
  assert.ok(src.host_permissions.includes('http://localhost:8787/*'), '개발 원본 manifest는 바꾸지 않는다');
});

test('stripDevHosts: localhost·127.0.0.1·[::1](포트 포함)만 지운다', () => {
  const m = stripDevHosts({
    host_permissions: ['https://api.anthropic.com/*', 'http://localhost:8787/*', 'http://127.0.0.1/*', 'http://[::1]:3000/*', 'https://localhost.example.com/*'],
    optional_host_permissions: ['https://*/*', '*://localhost/*'],
  });
  assert.deepEqual(m.host_permissions, ['https://api.anthropic.com/*', 'https://localhost.example.com/*']);
  assert.deepEqual(m.optional_host_permissions, ['https://*/*']);
});

test('inspectPackage: 개발 전용 폴더·파일·localhost 권한·문자열을 잡는다', () => {
  const bad = join(tmp, 'bad');
  cpSync(out, bad, { recursive: true });
  mkdirSync(join(bad, 'manuals-dev'));
  writeFileSync(join(bad, 'manuals-dev', 'index.json'), '{}');
  mkdirSync(join(bad, 'src', 'tests'));
  writeFileSync(join(bad, 'src', 'tests', 'x.js'), '');
  writeFileSync(join(bad, 'package.json'), '{}');
  writeFileSync(join(bad, 'src', 'leak.js'), "const u = 'http://localhost:8787/';");
  const m = JSON.parse(readFileSync(join(bad, 'manifest.json'), 'utf8'));
  m.host_permissions.push('http://127.0.0.1:8787/*');
  writeFileSync(join(bad, 'manifest.json'), JSON.stringify(m));
  const problems = inspectPackage(bad).join('\n');
  for (const w of ['manuals-dev이 배포물에', 'package.json이 배포물에', 'src/tests/x.js', 'src/leak.js', 'manifest에 개발 전용 권한 http://127.0.0.1:8787/*']) {
    assert.ok(problems.includes(w.replace(/\//g, sep)) || problems.includes(w), `${w}\n${problems}`);
  }
});

test('위험한 출력 폴더(저장소 루트, extension 원본과 그 안)는 거부한다', () => {
  for (const outDir of [ROOT, EXT, join(EXT, 'dist'), join(ROOT, '..')]) {
    assert.throws(() => packageExtension({ outDir }), /출력 폴더로 쓸 수 없습니다/, outDir);
  }
  assert.ok(existsSync(join(EXT, 'manifest.json')), '원본이 그대로 있다');
});

test('빌드 표식: 원본은 데모 매뉴얼 포함(true), 배포물은 false로 바뀐다', async () => {
  const srcInfo = await import(new URL('../src/shared/build-info.js', import.meta.url).href);
  assert.equal(srcInfo.BUILD_INFO.includesDevManuals, true);
  const distText = readFileSync(join(out, 'src', 'shared', 'build-info.js'), 'utf8');
  assert.match(distText, /export const BUILD_INFO = Object\.freeze\(\{ includesDevManuals: false \}\);/);
  const distInfo = await import(pathToFileURL(join(out, 'src', 'shared', 'build-info.js')).href);
  assert.equal(distInfo.BUILD_INFO.includesDevManuals, false);
});

test('inspectPackage: 배포물 빌드 표식이 개발용(true)이면 잡는다', () => {
  const bad = join(tmp, 'bad-build-info');
  cpSync(out, bad, { recursive: true });
  cpSync(join(EXT, 'src', 'shared', 'build-info.js'), join(bad, 'src', 'shared', 'build-info.js'));
  assert.ok(inspectPackage(bad).some(p => p.includes('build-info.js')));
});
