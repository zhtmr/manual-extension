#!/usr/bin/env node
// 로컬 fixture 서버. node 내장 http만 쓴다.
// 실행: node extension/tests/fixtures/serve.mjs [port=8787]  (localhost 바인딩)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'site');

// 정적 자산: 이 목록에 있는 파일만 내보낸다(경로 탐색 방지).
const ASSETS = {
  '/fixture.css': ['fixture.css', 'text/css; charset=utf-8'],
  '/spa.js': ['spa.js', 'text/javascript; charset=utf-8'],
  '/hash.js': ['hash.js', 'text/javascript; charset=utf-8'],
};

// 경로 → HTML 파일. 끝의 '/'는 루트를 빼고 무시한다.
export function resolvePage(pathname) {
  const p = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (p === '/') return 'home.html';
  if (/^\/notice\/\d+$/.test(p)) return 'notice.html';
  if (p === '/nomanual') return 'nomanual.html';
  if (p === '/spa' || p.startsWith('/spa/')) return 'spa.html'; // SPA 하위 경로 직접 진입
  if (p === '/hash') return 'hash.html';
  return null;
}

export function createFixtureServer() {
  return createServer((req, res) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { pathname = ''; }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Method Not Allowed');
    }
    let file, type;
    if (ASSETS[pathname]) [file, type] = ASSETS[pathname];
    else if ((file = resolvePage(pathname))) type = 'text/html; charset=utf-8';
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    const body = readFileSync(join(SITE_DIR, file));
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  const a = resolve(process.argv[1]);
  const b = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
})();

if (isMain) {
  const port = Number(process.argv[2] ?? 8787);
  createFixtureServer().listen(port, 'localhost', () => {
    console.log(`fixture 서버: http://localhost:${port}/`);
  });
}
