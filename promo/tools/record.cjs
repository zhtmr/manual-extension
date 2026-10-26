// README용 데모 프레임 촬영: 웹 페이지 + 실제 사이드 패널을 장면마다 캡처한다.
const { chromium } = require(process.env.PW);
const path = require('path'), os = require('os'), fs = require('fs'), { spawn } = require('child_process');
const EXT = path.resolve('D:/swchoi/IdeaProjects/manual-extension/extension');
const OUT = path.resolve(__dirname, '../assets/real');
const B = 'http://localhost:8787';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));

(async () => {
  const srv = spawn(process.execPath, [path.join(EXT, 'tests/fixtures/serve.mjs'), '8787'], { stdio: 'ignore' });
  await sleep(700);
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pwdemo-'));
  const ctx = await chromium.launchPersistentContext(ud, {
    headless: true, channel: 'chromium', viewport: { width: 900, height: 720 }, deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--remote-debugging-port=9334', '--lang=ko-KR'],
  });
  try {
    let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const id = sw.url().split('/')[2];
    const p = ctx.pages()[0]; await p.goto(B + '/');
    const opt = await ctx.newPage(); await opt.goto(`chrome-extension://${id}/src/options/options.html`);
    const winId = await sw.evaluate(async () => (await chrome.windows.getCurrent()).id);
    await opt.evaluate(w => { const b = document.createElement('button'); b.id = 'demoOpen'; b.onclick = () => chrome.sidePanel.open({ windowId: w }); b.textContent = 'open'; document.body.append(b); }, winId);
    await opt.click('#demoOpen'); await sleep(800);
    await opt.close(); await p.bringToFront(); await sleep(1000);

    const list = await (await fetch('http://127.0.0.1:9334/json/list')).json();
    const tgt = list.find(x => x.url.endsWith('/src/sidepanel/sidepanel.html'));
    if (!tgt) throw new Error('사이드 패널 대상을 찾지 못함');
    const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => (ws.onopen = r));
    let n = 0; const pend = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
    const cdp = async (method, params = {}) => { const i = ++n; ws.send(JSON.stringify({ id: i, method, params })); return new Promise(r => pend.set(i, r)); };
    const spEval = async expr => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
    await cdp('Emulation.setDeviceMetricsOverride', { width: 400, height: 720, deviceScaleFactor: 2, mobile: false });

    let k = 0;
    const shot = async (label, repeat = 1) => {
      await sleep(250);
      const num = String(++k).padStart(2, '0');
      await p.screenshot({ path: path.join(OUT, `${num}_page.png`) });
      const r = await cdp('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, `${num}_panel.png`), Buffer.from(r.result.data, 'base64'));
      fs.writeFileSync(path.join(OUT, `${num}_meta.json`), JSON.stringify({ label, repeat }));
      console.log(num, label, JSON.stringify(await spEval("document.querySelector('#pageTitle').textContent")));
    };

    // 시험용 비밀값(SECRET-*)은 영상에 어색하므로 촬영 전에 화면에서만 지운다(확장 동작과 무관)
    await p.evaluate(() => { document.querySelector('#q').value = ''; document.querySelector('#category').selectedIndex = 1;
      document.querySelectorAll('td').forEach(td => { if (td.textContent === 'SECRET-CELL') td.textContent = '시스템 점검 안내'; }); });
    await shot('홈 화면 — 작성된 매뉴얼 표시', 3);
    await p.click('#navNotice'); await sleep(900);
    await shot('링크 이동 → 공지 상세 매뉴얼', 3);
    await p.goto(B + '/spa'); await sleep(900);
    await shot('SPA 앱 진입', 2);
    await p.click('#spaNavOrders'); await sleep(900);
    await shot('SPA 화면 전환(pushState)도 감지', 3);
    await spEval("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '화면에서 보기')?.click()");
    await sleep(700);
    await shot('「화면에서 보기」 → 조작할 요소 강조', 4);
    await p.goto(B + '/hash#/inbox'); await sleep(900);
    await shot('해시 라우팅 화면', 2);
    await p.click('#hashNavSettings'); await sleep(900);
    await shot('해시 이동 → 메시지 설정', 3);
    await p.goto(B + '/nomanual'); await sleep(1200);
    await shot('매뉴얼이 없는 화면 → AI 생성 안내', 4);
  } catch (e) { console.log('ERR', e.stack); process.exitCode = 1; }
  finally { await ctx.close(); srv.kill(); }
})();
