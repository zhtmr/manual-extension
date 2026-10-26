// 실제 데모 페이지 요소 좌표(1x, 900x720 뷰포트)를 잰다 — 커서·강조 애니메이션 위치용
const { chromium } = require(process.env.PW);
const path = require('path'), { spawn } = require('child_process');
const EXT = path.resolve(__dirname, '../../extension');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const srv = spawn(process.execPath, [path.join(EXT, 'tests/fixtures/serve.mjs'), '8788'], { stdio: 'ignore' });
  await sleep(700);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 900, height: 720 } });
  const box = async sel => { const r = await p.locator(sel).first().boundingBox(); return r && [r.x, r.y, r.width, r.height].map(Math.round); };
  const out = {};
  await p.goto('http://localhost:8788/'); out.home = { navNotice: await box('#navNotice') };
  await p.goto('http://localhost:8788/spa'); await sleep(300); out.spa = { spaNavOrders: await box('#spaNavOrders') };
  await p.goto('http://localhost:8788/spa/orders'); await sleep(300);
  out.orders = { newBtn: await box('button:has-text("새 주문")'), h1: await box('h1'), select: await box('select'), table: await box('table'), nav: await box('nav, header') };
  await p.goto('http://localhost:8788/hash#/inbox'); await sleep(300); out.hash = { hashNavSettings: await box('#hashNavSettings') };
  await p.goto('http://localhost:8788/nomanual'); await sleep(300);
  out.nomanual = {};
  for (const sel of ['header, nav', 'h1', '#fileSearch', '#fileKeyword', '#btnFileSearch', '#btnUpload', 'table', 'p']) out.nomanual[sel] = await box(sel);
  out.nomanualText = await p.evaluate(() => document.body.innerText);
  console.log(JSON.stringify(out, null, 1));
  await b.close(); srv.kill();
})();
