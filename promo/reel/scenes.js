/* 페이지 매뉴얼 소개 영상 — 48초, 120 BPM. 구간별 아트 디렉션은 concept.md.
 * 3~5구간의 브라우저 화면은 실제 확장을 로드해 찍은 스크린샷(assets/real, 2배율)이다. */
const { ease, prog, win, kf, spring, clamp, lerp, rand, noise, split, stagger, css, h, s, cue } = REEL;
REEL.config({ duration: 48, fps: 30, width: 1920, height: 1080, audio: '../audio/mix.wav' });

const F = 1 / REEL.fps;
const E = (name, off = 0) => cue(name) + off - 0.5 * F;      // 사건 시각: 큐 프레임에 새 상태가 처음 보이게
const C = { ink: '#1f2328', muted: '#57606a', border: '#d0d7de', accent: '#0b5cad', sky: '#6cb0f5',
  stage: '#f5f7f9', navy: '#0d1b2a', orange: '#f59e0b', ok: '#1a6334', okBg: '#dff3e4', aiBg: '#fdf0d5', aiFg: '#7a4a00' };
const REAL = n => `../assets/real/${n}`;

// 브라우저 창 배치(3~5구간 공통). 스크린샷 1배율 좌표 → 화면 좌표 배율 K
const K = 1.125, WX = 229, WY = 150, BAR = 56, PW = 900 * K, PNW = 400 * K, CH = 720 * K;
const CY = WY + BAR;                       // 콘텐츠 위쪽
const PX = WX + PW;                        // 패널 왼쪽
const pg = (x, y) => [WX + x * K, CY + y * K];
const pn = (x, y) => [PX + x * K, CY + y * K];

const URLS = { '01': 'localhost:8787/', '02': 'localhost:8787/notice/101', '03': 'localhost:8787/spa',
  '04': 'localhost:8787/spa/orders', '06': 'localhost:8787/hash#/inbox', '07': 'localhost:8787/hash#/settings', '08': 'localhost:8787/nomanual' };

function cursorSvg(parent) {
  const svg = s('svg', { width: 44, height: 56, viewBox: '0 0 22 28' }, parent);
  s('path', { d: 'M2 2 L2 22 L7.5 16.8 L11.2 25.5 L14.6 24 L11 15.6 L18.5 15.6 Z', fill: '#111', stroke: '#fff', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }, svg);
  css(svg, { position: 'absolute', left: 0, top: 0, overflow: 'visible', filter: 'drop-shadow(0 3px 4px rgba(0,0,0,.25))' });
  return svg;
}

// 브라우저 창: 탭·주소줄 + 페이지 칸(이미지 2장) + 패널 칸(이미지 2장)
function browser(parent, ns) {
  const b = {};
  b.root = h('div', 'a', parent);
  css(b.root, { left: WX + 'px', top: WY + 'px', width: PW + PNW + 'px', height: BAR + CH + 'px', background: '#fff',
    borderRadius: '14px', overflow: 'hidden', boxShadow: '0 30px 80px rgba(31,35,40,.18), 0 0 0 1px rgba(31,35,40,.08)' });
  const bar = h('div', 'a', b.root);
  css(bar, { left: 0, top: 0, right: 0, height: BAR + 'px', background: '#e8ecf0', borderBottom: '1px solid #d0d7de' });
  const tab = h('div', 'a', bar, '업무 포털');
  css(tab, { left: '18px', top: '10px', height: '46px', width: '210px', background: '#fff', borderRadius: '10px 10px 0 0',
    font: '500 17px Pretendard', color: C.muted, padding: '13px 0 0 18px', boxSizing: 'border-box' });
  b.addr = h('div', 'a', bar, URLS['01']);
  css(b.addr, { left: '250px', top: '11px', height: '34px', width: '640px', background: '#fff', borderRadius: '17px',
    font: '500 17px "JetBrains Mono", Pretendard', color: C.ink, padding: '8px 0 0 20px', boxSizing: 'border-box', border: '1px solid #d0d7de' });
  const ph = h('div', 'a', bar, '페이지 매뉴얼');
  css(ph, { left: PW + 'px', top: '0', width: PNW + 'px', height: BAR + 'px', borderLeft: '1px solid #d0d7de', boxSizing: 'border-box',
    font: '700 18px Pretendard', color: C.ink, padding: '17px 0 0 20px', background: '#f1f4f7' });
  b.page = h('div', 'a', b.root); css(b.page, { left: 0, top: BAR + 'px', width: PW + 'px', height: CH + 'px', overflow: 'hidden', background: '#fff' });
  b.panel = h('div', 'a', b.root); css(b.panel, { left: PW + 'px', top: BAR + 'px', width: PNW + 'px', height: CH + 'px', overflow: 'hidden',
    background: '#fff', borderLeft: '1px solid #d0d7de', boxSizing: 'border-box' });
  b.glow = h('div', 'a', b.root); css(b.glow, { left: PW + 'px', top: BAR + 'px', width: PNW + 'px', height: CH + 'px', boxSizing: 'border-box', pointerEvents: 'none' });
  // 화면마다 이미지 요소를 미리 만들어 두고 보이기만 바꾼다(렌더 중 src 를 바꾸면 빈 프레임이 생길 수 있다)
  b.pg = {}; b.pn = {};
  ns.forEach(n => {
    const a = h('img', 'a', b.page); a.src = REAL(`${n}_page.png`); css(a, { left: 0, top: 0, width: PW + 'px', height: CH + 'px', opacity: 0 }); b.pg[n] = a;
    const c = h('img', 'a', b.panel); c.src = REAL(`${n}_panel.png`); css(c, { left: 0, top: 0, width: PNW + 'px', height: CH + 'px', opacity: 0 }); b.pn[n] = c;
  });
  b.hideAll = () => { Object.values(b.pg).forEach(e => css(e, { opacity: 0, zIndex: 0 })); Object.values(b.pn).forEach(e => css(e, { opacity: 0, zIndex: 0 })); };
  return b;
}
// 이미지 미리 불러오기
['01', '02', '03', '04', '05', '06', '07', '08'].forEach(n => { REEL.img(REAL(`${n}_page.png`)); REEL.img(REAL(`${n}_panel.png`)); });

// 마스크 안에서 솟는 글자 줄
function riseLine(parent, text, style) {
  const el = h('div', 'a', parent, text); css(el, style);
  return { el, chars: split(el, 'char', { mask: true }) };
}
function riseRender(L, lt, t0, t1, each = 0.035) {
  const out = t1 == null ? 0 : prog(lt, t1, 0.3, ease.exit);
  L.chars.forEach((c, i) => {
    const p = stagger(lt, t0, each, 0.5, i);
    css(c, { transform: `translateY(${(1 - p) * 135 - out * 135}%)`, opacity: p > 0 && out < 1 ? 1 : 0 });
  });
}

/* ───────── 1구간 0–8: 막막함 ───────── */
const S1_Q = [
  ['이 화면은 뭐 하는 곳이지?', 1010, 255, 40, 0.35],
  ['승인은 어디서 하죠?', 560, 470, 34, 1.25],
  ['‘이관’이 뭐예요?', 1330, 560, 34, 2.0],
  ['조회 조건엔 뭘 넣지?', 420, 745, 34, 2.75],
  ['이거 눌러도 돼요?', 1120, 800, 34, 3.5],
  ['엑셀은 어디서 받지?', 1480, 360, 30, 4.0],
];
REEL.scene({ id: 's1', start: 0, end: E('scene.s2'),
  setup(el) {
    css(el, { background: '#e9edf1' });
    this.cam = h('div', 'full', el);
    const ui = this.cam;
    const top = h('div', 'a', ui); css(top, { left: 0, top: 0, width: '1920px', height: '64px', background: '#3b4652' });
    const logo = h('div', 'a', top, '통합업무포털'); css(logo, { left: '28px', top: '18px', font: '800 24px Pretendard', color: '#fff' });
    '결재 인사 회계 구매 자산 게시판 일정 메일 설정'.split(' ').forEach((m, i) => {
      const t = h('div', 'a', top, m); css(t, { left: `${300 + i * 92}px`, top: '21px', font: '500 19px Pretendard', color: '#c9d1d9' });
    });
    const side = h('div', 'a', ui); css(side, { left: 0, top: '64px', width: '250px', height: '1016px', background: '#dde3e8' });
    '기안함 결재대기 수신참조 결재완료 반려함 임시저장 부서문서함 이관문서 공람함 회람함 보존문서 양식관리 결재선관리 위임설정 통계'.split(' ').forEach((m, i) => {
      const t = h('div', 'a', side, '▸ ' + m); css(t, { left: '24px', top: `${24 + i * 46}px`, font: '500 19px Pretendard', color: '#4a535c' });
    });
    const main = h('div', 'a', ui); css(main, { left: '280px', top: '86px', width: '1610px', height: '980px' });
    const bc = h('div', 'a', main, '결재 › 결재대기 › 목록'); css(bc, { left: 0, top: 0, font: '500 17px Pretendard', color: '#7a858f' });
    const ttl = h('div', 'a', main, '결재대기 문서'); css(ttl, { left: 0, top: '30px', font: '800 32px Pretendard', color: '#2d333a' });
    const form = h('div', 'a', main); css(form, { left: 0, top: '90px', width: '1600px', height: '120px', background: '#f4f6f8', border: '1px solid #c8d0d8' });
    ['기간', '문서종류', '기안부서', '상태', '긴급', '보안등급'].forEach((m, i) => {
      const x = 24 + (i % 3) * 520, y = 18 + Math.floor(i / 3) * 52;
      const l = h('div', 'a', form, m); css(l, { left: x + 'px', top: y + 8 + 'px', font: '600 18px Pretendard', color: '#57606a' });
      const b = h('div', 'a', form); css(b, { left: x + 100 + 'px', top: y + 'px', width: '360px', height: '36px', background: '#fff', border: '1px solid #c8d0d8' });
    });
    this.btns = [];
    '조회 저장 삭제 승인 반려 이관 출력 엑셀 초기화 일괄처리 회수 전결'.split(' ').forEach((m, i) => {
      const b = h('div', 'a', main, m); css(b, { left: `${i * 104}px`, top: '230px', width: '94px', height: '40px', background: '#f6f8fa',
        border: '1px solid #b9c2cb', font: '600 17px Pretendard', color: '#3b4652', textAlign: 'center', lineHeight: '40px', boxSizing: 'border-box' });
      this.btns.push(b);
    });
    const grid = h('div', 'a', main); css(grid, { left: 0, top: '290px', width: '1600px', height: '660px', background: '#fff', border: '1px solid #c8d0d8' });
    const cols = [['번호', 90], ['문서번호', 220], ['제목', 620], ['기안자', 160], ['기안일', 200], ['상태', 140], ['비고', 170]];
    let cx = 0; cols.forEach(([m, w]) => { const c = h('div', 'a', grid, m); css(c, { left: cx + 'px', top: 0, width: w + 'px', height: '44px', background: '#eef1f4',
      borderRight: '1px solid #d6dce2', font: '700 17px Pretendard', color: '#4a535c', textAlign: 'center', lineHeight: '44px', boxSizing: 'border-box' }); cx += w; });
    for (let r = 0; r < 13; r++) {
      let x = 0; cols.forEach(([, w], ci) => {
        const bar = h('div', 'a', grid); const bw = (w - 40) * (0.35 + 0.55 * rand(r * 7 + ci, 3));
        css(bar, { left: x + 20 + 'px', top: 62 + r * 46 + 'px', width: bw + 'px', height: '12px', borderRadius: '6px', background: ci === 2 ? '#c4ccd4' : '#d8dee4' });
        x += w;
      });
    }
    this.cursor = cursorSvg(el);
    this.q = S1_Q.map(([text, x, y, size, L], i) => {
      const b = h('div', 'a', el);
      css(b, { left: x + 'px', top: y + 'px', padding: '16px 26px 18px', background: '#fff', borderRadius: '22px', font: `700 ${size}px Pretendard`,
        color: C.ink, whiteSpace: 'nowrap', boxShadow: '0 14px 30px rgba(31,35,40,.18), 0 0 0 2px #1f2328', transformOrigin: '30% 100%' });
      b.textContent = text;
      const tail = h('div', 'a', b); css(tail, { left: '34px', bottom: '-13px', width: '24px', height: '24px', background: '#fff', transform: 'rotate(45deg)',
        boxShadow: '2px 2px 0 0 #1f2328' });
      return { b, x, y, L, rot: (rand(i, 5) - 0.5) * 8 };
    });
    this.scrim = h('div', 'full', el); css(this.scrim, { background: 'rgba(233,237,241,.86)' });
    this.big = riseLine(el, '처음 보는 화면, 막막할 때.', { left: '160px', top: '420px', font: '900 128px Pretendard', letterSpacing: '-0.045em', color: C.ink, whiteSpace: 'nowrap' });
    this.strip = h('div', 'a', el); css(this.strip, { top: 0, right: 0, height: '1080px', background: C.accent });
  },
  render(lt) {
    const sk = E('scene.s2') - 0.45;                    // 빨려 들어가기 시작(음악 정지 직후)
    const pull = prog(lt, sk, 0.45, ease.inExpo);
    // 카메라: 붐비는 화면이 천천히 다가오며 흔들림
    const z = lerp(1.04, 1.13, prog(lt, 0, 7.5, ease.inOutSine));
    css(this.cam, { transformOrigin: '960px 540px', transform: `scale(${z}) translate(${noise(lt * 0.4, 3) * 10}px, ${noise(lt * 0.4, 4) * 8}px)` });
    // 커서: 갈 곳을 못 찾고 헤맴
    const cx = 960 + 560 * noise(lt * 0.55, 11) + 120 * Math.sin(lt * 2.1), cy = 560 + 300 * noise(lt * 0.6, 12);
    css(this.cursor, { transform: `translate(${cx}px, ${cy}px)`, opacity: 1 - pull });
    this.btns.forEach((b, i) => {
      const bx = 280 + i * 104 * z, hit = Math.abs(cx - (bx + 47)) < 60 && Math.abs(cy - 340) < 80;
      css(b, { background: hit ? '#e1e7ed' : '#f6f8fa' });
    });
    // 질문 말풍선: 위에서 떨어져 눌렸다 튐
    this.q.forEach(({ b, x, y, L, rot }, i) => {
      const fall = 1 - ease.inExpo(clamp((lt - (L - 8 * F)) / (8 * F)));
      const k = lt >= L ? 0 : fall;
      const dt = lt - L;
      const sq = dt < 0 ? 1 : 1 - 0.14 * Math.exp(-dt * 9) * Math.cos(dt * 26);
      const toRight = pull * (1920 - x + 200 + i * 40);
      const wob = lt > L ? 2.2 * noise(lt * 2.4, i + 20) : 0;
      css(b, { opacity: lt < L - 8 * F ? 0 : 1 - pull * 0.6,
        transform: `translate(${toRight + wob * 3}px, ${-(y + 160) * k + wob * 2}px) rotate(${(rot + wob) * (1 - pull)}deg) scale(${(1 + (1 - sq) * 0.6) * (1 + pull * 0.6)}, ${sq * (1 - pull * 0.5)})` });
    });
    // 한 줄로 정리: "처음 보는 화면, 막막할 때."
    const sc = prog(lt, 4.4, 0.4, ease.swift);
    css(this.scrim, { opacity: sc * (1 - pull) });
    riseRender(this.big, lt, 4.5, null, 0.04);
    const push = lerp(1, 1.08, prog(lt, 4.5, 3.0, ease.linear));
    css(this.big.el, { transform: `translateX(${pull * 1400}px) scale(${push * (1 + pull * 0.4)}, ${push})`, transformOrigin: '0 50%' });
    // 오른쪽에서 파란 면이 열려 다음 구간이 된다
    css(this.strip, { width: `${1920 * pull}px` });
  } });

/* ───────── 2구간 8–12: "페이지 매뉴얼" 자모 조립 ───────── */
const VERT = new Set([0, 1, 2, 3, 4, 5, 6, 7, 20]);
function jamoRegions(ch) {
  const c = ch.charCodeAt(0) - 0xac00; if (c < 0 || c > 11171) return [[0, 0, 1, 1]];
  const jung = Math.floor((c % 588) / 28), jong = c % 28, yb = jong ? 0.58 : 1;
  const top = VERT.has(jung) ? [[0, 0, 0.56, yb], [0.56, 0, 1, yb]] : [[0, 0, 1, yb * 0.55], [0, yb * 0.55, 1, yb]];
  return jong ? [...top, [0, yb, 1, 1]] : top;
}
REEL.scene({ id: 's2', start: E('scene.s2'), end: E('scene.s3'),
  setup(el) {
    css(el, { background: C.stage });
    this.field = h('div', 'a', el); css(this.field, { background: C.accent, left: 0, top: 0, width: '1920px', height: '1080px' });
    this.inner = h('div', 'full', el);
    const word = '페이지 매뉴얼', size = 230;
    const probe = h('div', 'a', this.inner, word); css(probe, { font: `920 ${size}px Pretendard`, letterSpacing: '-0.02em', whiteSpace: 'nowrap', visibility: 'hidden' });
    const totalW = probe.getBoundingClientRect().width; probe.remove();
    const x0 = (1920 - totalW) / 2, y0 = 300;
    this.pieces = []; let k = 0, x = x0;
    [...word].forEach((ch, ci) => {
      const cw = (() => { const p = h('div', 'a', this.inner, ch === ' ' ? ' ' : ch); css(p, { font: `920 ${size}px Pretendard`, letterSpacing: '-0.02em', visibility: 'hidden' });
        const w = p.getBoundingClientRect().width; p.remove(); return w; })();
      if (ch !== ' ') jamoRegions(ch).forEach(([a, b, c2, d]) => {
        const p = h('div', 'a', this.inner, ch);
        css(p, { left: x + 'px', top: y0 + 'px', font: `920 ${size}px Pretendard`, lineHeight: 1.1, color: '#fff', letterSpacing: '-0.02em',
          clipPath: `inset(${b * 100}% ${(1 - c2) * 100}% ${(1 - d) * 100}% ${a * 100}%)` });
        const side = rand(k, 1) < 0.5;
        this.pieces.push({ el: p, k, ci, dx: side ? (rand(k, 2) < 0.5 ? -1 : 1) * (700 + 300 * rand(k, 4)) : 0, dy: side ? 0 : -(560 + 260 * rand(k, 3)) * (rand(k, 6) < 0.5 ? 1 : -1), slide: side });
        k++;
      });
      x += cw;
    });
    this.sub = riseLine(this.inner, '화면이 바뀌면 설명서도 바뀝니다.', { left: 0, right: 0, top: '600px', textAlign: 'center', font: '600 60px Pretendard', color: 'rgba(255,255,255,.92)', letterSpacing: '-0.02em' });
  },
  render(lt, ctx) {
    const t = ctx.t, T0 = cue('scene.s2');
    this.pieces.forEach((p) => {
      const L = T0 + 0.02 + p.k * 0.125 - 0.5 * F;
      const k = t >= L ? 0 : p.slide ? 1 - ease.outExpo(clamp((t - (L - 3 * F)) / (10 * F))) : 1 - ease.inExpo(clamp((t - (L - 7 * F)) / (7 * F)));
      const q = t < L ? 1 : t < L + 2 * F ? 0.86 : lerp(0.86, 1, ease.outBack(clamp((t - L - 2 * F) / (5 * F))));
      const wv = prog(t, T0 + 1.75, 0.6, ease.inOutSine) * (0.5 - 0.5 * Math.cos(2 * Math.PI * ((t - T0 - 1.75) / 1.0 - p.ci * 0.11)));
      css(p.el, { fontVariationSettings: `'wght' ${(920 - 560 * wv).toFixed(1)}`, transform: `translate(${p.dx * k}px, ${p.dy * k}px) scale(${1 + (1 - q) * 0.4}, ${q})`, transformOrigin: '50% 100%',
        color: t < L + 3 * F ? C.sky : '#fff', opacity: k > 0.98 ? 0 : 1 });
    });
    riseRender(this.sub, t - T0, 1.85, null, 0.03);
    // 파란 면이 접혀 사이드 패널 자리가 된다
    const T1 = cue('scene.s3'), f = prog(t, T1 - 0.68, 0.66, ease.inOutCubic);
    const L = lerp(0, PX, f), T = lerp(0, CY, f), W = lerp(1920, PNW, f), H = lerp(1080, CH, f);
    css(this.field, { left: L + 'px', top: T + 'px', width: W + 'px', height: H + 'px', borderRadius: `${f * 6}px`,
      background: C.accent });
    const u = Math.min(W / 1920, H / 1080);              // 글자는 찌그러뜨리지 않고 면 가운데에 맞춰 줄인다
    css(this.inner, { transformOrigin: '0 0', transform: `translate(${L + (W - 1920 * u) / 2}px, ${T + (H - 1080 * u) / 2}px) scale(${u})`, opacity: 1 - prog(t, T1 - 0.12, 0.1, ease.linear) });
  } });

/* ───────── 3구간 12–24: 따라오는 설명서(실제 스크린샷, 카메라가 클릭 지점과 패널 머리를 오감) ───────── */
// 묶음마다: 첫 화면(at) → 클릭(at+1.55) → 페이지 교체(at+2) → 패널 교체(at+2.15)
const S3_STEPS = [
  { at: 0, n: '01', how: 'open', click: [86, 22] },
  { at: 2, n: '02', how: 'whip' },
  { at: 4, n: '06', how: 'push', click: [208, 22] },
  { at: 6, n: '07', how: 'whip' },
  { at: 8, n: '03', how: 'push', click: [230, 22] },
  { at: 10, n: '04', how: 'whip' },
];
const S3_HEAD = ['링크를 눌러 이동해도', '주소 뒤 #만 바뀌어도', '새로고침 없이 바뀌어도'];
const SX = 960, SY = 583;                                    // 카메라 기준점(화면)
const shotFull = { cx: 960, cy: 583, z: 1 };
const shotClick = (k) => { const [tx] = pg(S3_STEPS[k * 2].click[0], 0); return { cx: tx + 330, cy: 380, z: 1.55 }; };
const shotPanel = { cx: PX + 105, cy: 392, z: 1.9 };          // 패널 왼쪽이 화면 x≈760, 위쪽이 y≈230 에 오게
const mixShot = (a, b, p) => ({ cx: lerp(a.cx, b.cx, p), cy: lerp(a.cy, b.cy, p), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), p)) });
REEL.scene({ id: 's3', start: E('scene.s3'), end: E('scene.s4'),
  setup(el) {
    css(el, { background: C.stage });
    this.world = h('div', 'full', el);
    this.b = browser(this.world, ['01', '02', '03', '04', '06', '07']);
    // 주소줄: 해시 부분을 따로 강조할 수 있게 나눔
    this.b.addr.textContent = '';
    this.uBase = h('span', '', this.b.addr); this.uHash = h('span', '', this.b.addr);
    css(this.uHash, { borderRadius: '6px', padding: '0 3px', display: 'inline-block' });
    this.noReload = h('div', 'a', this.b.root, '↻ 새로고침 없음');
    css(this.noReload, { left: '700px', top: '15px', font: '700 18px Pretendard', color: C.ok, background: C.okBg, padding: '5px 12px', borderRadius: '14px', whiteSpace: 'nowrap' });
    this.cover = h('div', 'a', this.b.root); css(this.cover, { left: PW + 'px', top: 0, width: PNW + 'px', height: BAR + CH + 'px', background: C.accent });
    // 패널 꼬리표(역할·기능·조작 방법) — 첫 묶음의 패널 클로즈업에서
    this.tags = [['역할', 95], ['기능', 185], ['조작 방법', 445]].map(([tx, y]) => {
      const [, yy] = pn(0, y);
      const ln = h('div', 'a', this.world); css(ln, { left: PX + PNW - 40 + 'px', top: yy - 1 + 'px', width: '62px', height: '3px', background: C.accent, transformOrigin: '0 50%' });
      const t = h('div', 'a', this.world, tx);
      css(t, { left: PX + PNW + 26 + 'px', top: yy - 17 + 'px', font: '800 22px Pretendard', color: '#fff', background: C.accent, padding: '5px 12px', borderRadius: '8px', whiteSpace: 'nowrap' });
      return { t, ln };
    });
    this.cursor = cursorSvg(this.world);
    this.ring = h('div', 'a', this.world); css(this.ring, { width: '60px', height: '60px', marginLeft: '-30px', marginTop: '-30px', borderRadius: '50%', border: `4px solid ${C.accent}`, boxSizing: 'border-box' });
    this.heads = S3_HEAD.map(tx => riseLine(el, tx, { left: '120px', top: '40px', font: '800 66px Pretendard', color: C.ink, letterSpacing: '-0.035em', whiteSpace: 'nowrap' }));
  },
  render(lt) {
    const b = this.b;
    let i = 0; S3_STEPS.forEach((st, k) => { if (lt >= st.at - 0.5 * F) i = k; });
    const st = S3_STEPS[i], prev = S3_STEPS[Math.max(0, i - 1)], d = lt - (st.at - 0.5 * F);
    b.hideAll();
    const url = URLS[st.n], hx = url.indexOf('#');
    this.uBase.textContent = hx < 0 ? url : url.slice(0, hx); this.uHash.textContent = hx < 0 ? '' : url.slice(hx);
    // 페이지 교체
    const o = b.pg[prev.n], n = b.pg[st.n];
    css(n, { zIndex: 2 }); css(o, { zIndex: 1 });
    if (st.how === 'whip') {
      const p = ease.outExpo(clamp(d / (8 * F)));
      css(n, { transform: `translateX(${(1 - p) * 22}%)`, filter: `blur(${(1 - p) * 16}px)`, opacity: 1 });
      css(o, { transform: `translateX(${-p * 22}%)`, opacity: 1 - clamp(d / (4 * F)), filter: 'none' });
    } else if (st.how === 'push') {
      // 새 앱으로 넘어가는 컷: 짧게 떠오르며 겹쳐 바뀜(어두운 메뉴 띠가 화면을 쓸고 지나가면 섬광으로 잡혀서 이동 거리를 줄였다)
      const p = ease.outCubic(clamp(d / (12 * F)));
      css(n, { transform: `translateY(${(1 - p) * 6}%)`, filter: 'none', opacity: p });
      css(o, { transform: 'none', opacity: p < 1 ? 1 : 0, filter: 'none' });
    } else css(n, { transform: 'none', filter: 'none', opacity: 1 });
    // 패널 교체: 카메라가 패널에 도착한 뒤(0.15초 늦게) 위로 밀리며 바뀜
    const po = b.pn[prev.n], pnI = b.pn[st.n], q = ease.outQuart(clamp((d - 0.15) / (9 * F)));
    css(pnI, { zIndex: 2 }); css(po, { zIndex: 1 });
    if (st.how === 'open') css(pnI, { transform: 'none', opacity: 1 });
    else { css(pnI, { transform: `translateY(${(1 - q) * 14}%)`, opacity: q }); css(po, { transform: `translateY(${-q * 8}%)`, opacity: 1 - q }); }
    const gl = st.how === 'open' || d < 0.15 ? 0 : Math.exp(-(d - 0.15) * 2.6);
    css(b.glow, { boxShadow: `inset 0 0 0 ${3 + 4 * gl}px rgba(11,92,173,${0.15 + 0.7 * gl})` });
    // 첫 등장: 패널 자리(2구간의 파란 면)에서 창이 왼쪽으로 펼쳐지고 파란 덮개가 걷힘
    const op = ease.outExpo(clamp((lt + 0.5 * F) / (12 * F)));
    css(b.root, { clipPath: `inset(0 0 0 ${(1 - op) * PW}px round 14px)` });
    const cv = ease.inOutCubic(clamp((lt - 4 * F) / (10 * F)));
    css(this.cover, { clipPath: `inset(0 0 ${cv * 100}% 0)`, opacity: cv < 1 ? 1 : 0 });
    // 카메라: 전체 → 클릭 지점 → 패널 머리 → (다음 묶음) 클릭 지점 … → 전체
    const g = Math.min(2, Math.floor((lt + 0.5 * F) / 4)), u = lt - g * 4;
    const clickShot = shotClick(g);
    let shot;
    if (g === 0 && u < 1.7) shot = mixShot(shotFull, clickShot, prog(u, 0.55, 0.7, ease.inOutCubic));
    else if (u < 1.7) shot = { ...clickShot, z: clickShot.z * (1 + 0.05 * prog(u, -0.1, 1.8, ease.inOutSine)) };
    else if (u < 3.5) shot = mixShot({ ...clickShot, z: clickShot.z * (g === 0 ? 1 : 1.05) }, shotPanel, prog(u, 1.7, 0.42, ease.inOutCubic));
    else if (g < 2) shot = mixShot(shotPanel, shotClick(g + 1), prog(u, 3.5, 0.6, ease.inOutCubic));
    else shot = mixShot(shotPanel, shotFull, prog(u, 3.45, 0.5, ease.inOutCubic));
    if (u >= 2.15 && u < 3.5) shot = { ...shot, cy: shot.cy + 22 * prog(u, 2.15, 1.35, ease.inOutSine) };   // 패널을 읽어 내려감
    if (u >= 3.5) shot = { ...shot, cy: shot.cy + 22 * (1 - prog(u, g < 2 ? 3.5 : 3.45, g < 2 ? 0.6 : 0.5, ease.inOutCubic)) };
    css(this.world, { transformOrigin: `${shot.cx}px ${shot.cy}px`, transform: `translate(${SX - shot.cx}px, ${SY - shot.cy}px) scale(${shot.z})` });
    // 커서: 링크로 가서 누름(누르기 직전 살짝 내려앉는 예비 동작)
    const cst = S3_STEPS[g * 2];
    const [tx, ty] = pg(cst.click[0], cst.click[1]);
    const m = prog(u, 0.45, 0.9, ease.inOutCubic), down = u >= 1.45 && u < 1.62;
    css(this.cursor, { opacity: prog(u, 0.3, 0.2) * (1 - prog(u, 1.9, 0.2)), transform: `translate(${lerp(tx + 220, tx, m) - 4}px, ${lerp(ty + 300, ty, m) - 2 + (down ? 3 : 0)}px) scale(${down ? 0.86 : 1})` });
    const rp = clamp((u - 1.55) / 0.45);
    css(this.ring, { left: tx + 'px', top: ty + 'px', opacity: rp > 0 && rp < 1 ? 1 - rp : 0, transform: `scale(${0.3 + rp * 1.6})` });
    // 묶음별 증거: 해시는 주소줄의 # 부분, SPA 는 새로고침 없음
    const hashOn = g === 1 ? prog(u, 0.2, 0.3, ease.swift) * (1 - prog(u, 3.6, 0.3)) : 0;
    const hp = g === 1 && u >= 2 - 0.5 * F ? ease.outBack(clamp((u - 2) / (7 * F))) : 1;
    css(this.uHash, { background: `rgba(245,158,11,${0.3 * hashOn})`, boxShadow: `0 0 0 ${2 * hashOn}px rgba(245,158,11,${hashOn})`, transform: `scale(${lerp(1.3, 1, hp)})` });
    const nr = g === 2 ? ease.outBack(clamp((u - 2.0) / (8 * F))) * (1 - prog(u, 3.6, 0.3)) : 0;
    css(this.noReload, { opacity: nr > 1e-3 ? 1 : 0, transform: `scale(${nr})` });
    // 헤드라인
    this.heads.forEach((H, k) => riseRender(H, lt, k * 4 + 0.1, k * 4 + 3.62, 0.03));
    // 꼬리표
    this.tags.forEach(({ t, ln }, k) => {
      const p = stagger(lt, 2.45, 0.16, 0.45, k, ease.outBack), out = prog(lt, 3.4, 0.2, ease.exit);
      css(t, { opacity: p > 1e-3 ? 1 - out : 0, transform: `translateX(${(1 - p) * 30}px)` });
      css(ln, { transform: `scaleX(${clamp(p) * (1 - out)})` });
    });
  } });

/* ───────── 4구간 24–31.4: 「화면에서 보기」 → 주황 강조 ───────── */
REEL.scene({ id: 's4', start: E('scene.s4'), end: E('scene.s5'),
  setup(el) {
    css(el, { background: C.stage });
    this.cam = h('div', 'full', el);
    this.b = browser(this.cam, ['04', '05', '08']);
    css(this.b.pg['04'], { opacity: 1 }); css(this.b.pn['04'], { opacity: 1 });
    this.b.addr.textContent = URLS['04'];
    this.p8 = this.b.pg['08'];
    // 강조 대상(1배율): 패널 버튼, 페이지 「새 주문」
    this.B = pn(81, 527); this.T = pg(50, 360);
    this.press = h('div', 'a', this.cam); const [bx, by] = pn(30, 514);
    css(this.press, { left: bx + 'px', top: by + 'px', width: 103 * K + 'px', height: 26 * K + 'px', borderRadius: '5px', background: 'rgba(11,92,173,.18)' });
    this.svg = s('svg', { width: 1920, height: 1080, viewBox: '0 0 1920 1080' }, this.cam); css(this.svg, { position: 'absolute', left: 0, top: 0, overflow: 'visible' });
    const [Bx, By] = this.B, [Tx, Ty] = this.T;
    this.path = s('path', { d: `M${Bx - 50},${By} C${Bx - 420},${By + 60} ${Tx + 520},${Ty + 260} ${Tx + 44},${Ty + 8}`, fill: 'none', stroke: C.orange, 'stroke-width': 5, 'stroke-linecap': 'round' }, this.svg);
    this.len = this.path.getTotalLength(); this.path.style.strokeDasharray = this.len;
    this.dot = s('circle', { r: 9, fill: C.orange }, this.svg);
    this.rings = [0, 1, 2].map(() => s('ellipse', { cx: Tx, cy: Ty, rx: 60, ry: 30, fill: 'none', stroke: C.orange, 'stroke-width': 4 }, this.svg));
    this.cursor = cursorSvg(this.cam);
    this.h1 = riseLine(el, '「화면에서 보기」를 누르면', { left: '120px', top: '70px', font: '800 66px Pretendard', color: C.ink, letterSpacing: '-0.035em', whiteSpace: 'nowrap' });
    this.h2 = riseLine(el, '눌러야 할 곳을 화면에서 바로.', { left: '120px', top: '70px', font: '800 66px Pretendard', color: C.ink, letterSpacing: '-0.035em', whiteSpace: 'nowrap' });
    // 글자 뒤 판(마스크 글자 안에 배경을 주면 글자가 바랜다)
    this.plates = [this.h1, this.h2].map(L => { const r = L.el.getBoundingClientRect(); const pl = h('div', 'a', el);
      css(pl, { left: r.left - 22 + 'px', top: r.top - 8 + 'px', width: r.width + 44 + 'px', height: r.height + 18 + 'px', background: 'rgba(245,247,249,.98)', borderRadius: '14px', transformOrigin: '0 50%', boxShadow: '0 8px 24px rgba(31,35,40,.08)' });
      el.insertBefore(pl, L.el); return pl; });
    this.h3 = riseLine(el, '매뉴얼이 없는 화면이라면?', { left: WX + 'px', top: '46px', font: '800 62px Pretendard', color: C.ink, letterSpacing: '-0.035em', whiteSpace: 'nowrap' });
  },
  render(lt) {
    const [Bx, By] = this.B, [Tx, Ty] = this.T;
    // 카메라: 버튼으로 펀치 인 → 대상까지 이동 → 빠짐
    const zIn = prog(lt, 0.05, 0.85, ease.inOutCubic), mv = prog(lt, 1.55, 0.75, ease.inOutCubic), back = prog(lt, 4.9, 1.2, ease.inOutCubic);
    const fx = lerp(lerp(960, Bx, zIn), Tx + 260, mv), fy = lerp(lerp(560, By, zIn), Ty, mv);
    const z = lerp(1, lerp(2.5, 2.1, mv) + 0.12 * prog(lt, 2.6, 2.2, ease.inOutSine), zIn);
    const zz = lerp(z, 1, back), ax = lerp(fx, 960, back), ay = lerp(fy, 560, back);
    css(this.cam, { transform: `translate(${960 - ax}px, ${560 - ay}px) scale(${zz})`, transformOrigin: `${ax}px ${ay}px` });
    // 커서와 누름
    const cm = prog(lt, 0.2, 0.7, ease.inOutCubic);
    const down = lt >= 0.9 && lt < 1.15;
    css(this.cursor, { transform: `translate(${lerp(Bx + 180, Bx - 6, cm)}px, ${lerp(By + 160, By - 4, cm)}px) scale(${down ? 0.88 : 1})`, opacity: 1 - prog(lt, 1.5, 0.3) });
    const pr = clamp((lt - 1.0) / 0.55);
    css(this.press, { opacity: lt >= 1.0 - 0.5 * F && pr < 1 ? 1 - pr : 0, transform: `scale(${down ? 0.96 : 1})` });
    // 연결선: 버튼에서 대상까지 그어짐
    const dr = prog(lt, 1.55, 0.9, ease.inOutCubic), ret = prog(lt, 4.9, 0.6, ease.exit);
    this.path.style.strokeDashoffset = this.len * (1 - dr) + ret * -this.len;
    css(this.path, { opacity: dr > 0 ? 1 : 0 });
    const pt = this.path.getPointAtLength(this.len * clamp(dr));
    this.dot.setAttribute('cx', pt.x); this.dot.setAttribute('cy', pt.y); this.dot.style.opacity = dr > 0 && dr < 1 ? 1 : 0;
    // 대상 도착: 실제 강조 화면(05)으로 바뀌고 링이 번짐
    const hit = lt >= 2.5 - 0.5 * F;
    css(this.b.pg['05'], { opacity: hit ? 1 : 0 });
    this.rings.forEach((r, k) => {
      const rp = clamp((lt - 2.5 - k * 0.32) / 0.9);
      r.setAttribute('rx', 40 + rp * 120); r.setAttribute('ry', 20 + rp * 70); r.style.opacity = hit && rp < 1 ? (1 - rp) * (1 - ret) : 0;
    });
    // 헤드라인
    riseRender(this.h1, lt, 0.15, 2.3, 0.03);
    riseRender(this.h2, lt, 2.6, 4.75, 0.03);
    [[0.1, 2.3], [2.55, 4.75]].forEach(([a0, a1], k) => { const p = prog(lt, a0, 0.3, ease.swift) * (1 - prog(lt, a1 + 0.1, 0.3, ease.exit));
      css(this.plates[k], { opacity: p > 1e-3 ? 1 : 0, transform: `scaleX(${p})` }); });
    // 다음: 매뉴얼이 없는 화면으로 휩
    const wp = ease.outExpo(clamp((lt - (6.2 - 0.5 * F)) / (8 * F)));
    if (lt >= 6.2 - 0.5 * F) {
      css(this.p8, { opacity: 1, transform: `translateX(${(1 - wp) * 22}%)`, filter: `blur(${(1 - wp) * 16}px)` });
      css(this.b.pn['08'], { opacity: wp }); css(this.b.pn['04'], { opacity: 1 - wp });
      this.b.addr.textContent = URLS['08'];
    } else { css(this.p8, { opacity: 0 }); css(this.b.pn['08'], { opacity: 0 }); css(this.b.pn['04'], { opacity: 1 }); this.b.addr.textContent = URLS['04']; }
    riseRender(this.h3, lt, 6.25, null, 0.03);
  } });

/* ───────── 5구간 31.4–40: 화면 구조 투시, 개인정보 가림, AI 생성 ───────── */
// 08(자료실) 페이지 요소(1배율)와 태그
const S5_BOX = [[0, 0, 900, 44, 'header'], [20, 84, 860, 48, 'h1'], [20, 152, 860, 40, 'p'], [20, 207, 420, 89, 'form'],
  [20, 241, 420, 21, 'input'], [20, 272, 420, 24, 'button'], [20, 308, 179, 91, 'table'], [20, 411, 86, 24, 'button']];
// [글자, 출발 상자, 종류: ok | pii | drop]
const S5_TOK = [['자료실', 1, 'ok'], ['파일 이름', 3, 'ok'], ['담당 010-2345-6789', 2, 'pii'], ['자료 찾기', 5, 'ok'], ['입력값 “2027 예산안”', 4, 'drop'],
  ['hong@corp.kr', 2, 'pii'], ['자료 목록', 6, 'ok'], ['표 내용', 6, 'drop'], ['자료 올리기', 7, 'ok']];
const GATE = 1010, NODE = [1250, 560];
REEL.scene({ id: 's5', start: E('scene.s5'), end: E('scene.s6'),
  setup(el) {
    css(el, { background: C.stage });
    // 시작 화면: 4구간 끝과 같은 브라우저(08)
    this.b = browser(el, ['08']); css(this.b.pg['08'], { opacity: 1 }); css(this.b.pn['08'], { opacity: 1 });
    this.b.addr.textContent = URLS['08'];
    this.h3 = h('div', 'a', el, '매뉴얼이 없는 화면이라면?'); css(this.h3, { left: WX + 'px', top: '46px', font: '800 62px Pretendard', color: C.ink, letterSpacing: '-0.035em', whiteSpace: 'nowrap' });
    // 투시층(어두운 화면): 왼쪽부터 스캔선으로 드러남
    this.dark = h('div', 'full', el); css(this.dark, { background: C.navy });
    this.g = (() => { const c = h('canvas', '', this.dark); c.width = 1920; c.height = 1080; css(c, { position: 'absolute', left: 0, top: 0, width: '1920px', height: '1080px' }); return c.getContext('2d'); })();
    this.scan = h('div', 'a', el); css(this.scan, { top: 0, width: '4px', height: '1080px', background: C.sky, boxShadow: `0 0 40px 10px rgba(108,176,245,.55)` });
    this.toks = S5_TOK.map(([tx, bi, kind], i) => {
      const e = h('div', 'a', this.dark, tx);
      css(e, { left: 0, top: 0, font: '500 32px "JetBrains Mono", Pretendard', color: kind === 'ok' ? '#d8ecff' : '#ffd9a8', padding: '8px 16px', borderRadius: '10px',
        background: 'rgba(108,176,245,.12)', border: '1.5px solid rgba(108,176,245,.6)', whiteSpace: 'nowrap' });
      return { e, tx, bi, kind, i, w: e.getBoundingClientRect().width };
    });
    this.gateLbl = h('div', 'a', this.dark, '개인정보 가림'); css(this.gateLbl, { left: GATE - 90 + 'px', top: '236px', font: '600 26px Pretendard', color: '#9fc6ee', whiteSpace: 'nowrap' });
    this.node = h('div', 'a', this.dark, 'Claude API'); css(this.node, { left: NODE[0] - 110 + 'px', top: NODE[1] - 40 + 'px', width: '220px', height: '80px', borderRadius: '40px',
      font: '600 28px "JetBrains Mono", Pretendard', color: '#fff', textAlign: 'center', lineHeight: '80px', border: `2px solid ${C.sky}`, background: 'rgba(108,176,245,.15)' });
    // AI가 만든 매뉴얼 카드
    this.card = h('div', 'a', this.dark); css(this.card, { left: '1400px', top: '220px', width: '440px', height: '660px', background: '#fff', borderRadius: '18px', overflow: 'hidden' });
    const ch1 = h('div', 'a', this.card, '자료실'); css(ch1, { left: '28px', top: '26px', font: '800 36px Pretendard', color: C.ink });
    const bd = h('div', 'a', this.card, 'AI 생성'); css(bd, { right: '24px', top: '30px', font: '700 22px Pretendard', color: C.aiFg, background: C.aiBg, padding: '5px 14px', borderRadius: '16px' });
    this.cardLines = [];
    const rows = [['이 화면은', 0], ['파일 이름으로 자료를 찾고,', 1], ['새 자료를 올리는 화면입니다.', 1], ['주요 기능', 0], ['자료 찾기', 2], ['자료 올리기', 2], ['조작 방법', 0], ['1. 「파일 이름」에 입력합니다.', 3], ['2. 「자료 찾기」를 누릅니다.', 3], ['3. 결과 목록을 확인합니다.', 3]];
    this.typeRows = [];
    rows.forEach(([tx, kind], i) => {
      const y = 104 + i * 54;
      const e = h('div', 'a', this.card, tx);
      css(e, { left: '28px', top: y + 'px', font: kind === 0 ? '700 22px Pretendard' : kind === 2 ? '700 26px Pretendard' : '500 26px Pretendard', color: kind === 0 ? C.muted : C.ink, whiteSpace: 'nowrap' });
      if (kind === 3) { css(e, { font: '500 23px Pretendard' }); this.typeRows.push({ e, tx, i }); }
      this.cardLines.push(e);
    });
    this.note = h('div', 'a', this.dark, '설명을 위한 그림'); css(this.note, { right: '48px', bottom: '36px', font: '500 30px Pretendard', color: 'rgba(216,236,255,.55)' });
    this.heads = ['화면 구조만 읽어서', '개인정보는 가리고, 입력값은 보내지 않고', 'AI가 매뉴얼을 만듭니다.'].map(tx =>
      riseLine(this.dark, tx, { left: '120px', top: '64px', font: '800 60px Pretendard', color: '#fff', letterSpacing: '-0.035em', whiteSpace: 'nowrap' }));
    this.fill = h('div', 'a', el); css(this.fill, { background: '#fff', borderRadius: '18px', opacity: 0 });
  },
  render(lt, ctx) {
    const t = ctx.t, T0 = cue('scene.s5');
    const sc = prog(t, T0 + 0.02, 0.58, ease.inOutCubic);                 // 스캔: 32.0 박에 끝남
    const sx = sc * 1960 - 20;
    css(this.dark, { clipPath: `inset(0 ${100 - sc * 100}% 0 0)` });
    css(this.scan, { left: sx + 'px', opacity: sc > 0 && sc < 1 ? 1 : 0 });
    // 와이어프레임: 브라우저 자리에서 왼쪽으로 줄어 듦
    const shrink = prog(t, T0 + 1.0, 0.9, ease.inOutCubic);
    const s0 = lerp(1, 0.62, shrink), ox = lerp(WX, 120, shrink), oy = lerp(CY, 260, shrink);
    const map = (x, y) => [ox + x * K * s0, oy + y * K * s0];
    const g = this.g; g.clearRect(0, 0, 1920, 1080);
    g.save();
    g.strokeStyle = 'rgba(108,176,245,.75)'; g.lineWidth = 2; g.font = '500 18px "JetBrains Mono"'; g.fillStyle = 'rgba(108,176,245,.9)';
    const [fx0, fy0] = map(0, 0); g.strokeRect(fx0, fy0, 900 * K * s0, 720 * K * s0);
    S5_BOX.forEach(([x, y, w, hh, tag], i) => {
      const a = clamp((t - T0 - 0.25 - i * 0.05) / 0.3);
      const [X, Y] = map(x, y); g.globalAlpha = a;
      g.strokeRect(X, Y, w * K * s0, hh * K * s0); g.fillText(tag, X + 6, Y - 6);
    });
    // 패널 자리(없음)
    const pa = 1 - shrink; g.globalAlpha = pa * 0.8; g.setLineDash([8, 8]);
    g.strokeRect(PX, CY, PNW, CH); g.setLineDash([]); g.fillText('panel: 매뉴얼 없음', PX + 16, CY + 30);
    // 문
    const gate = prog(t, T0 + 1.6, 0.5, ease.swift);
    g.globalAlpha = gate; g.strokeStyle = 'rgba(255,217,168,.8)'; g.setLineDash([10, 10]); g.lineDashOffset = -t * 40;
    g.beginPath(); g.moveTo(GATE, 280); g.lineTo(GATE, 980); g.stroke(); g.setLineDash([]);
    g.restore();
    css(this.gateLbl, { opacity: gate });
    css(this.node, { opacity: prog(t, T0 + 1.8, 0.4), transform: `scale(${1 + 0.08 * Math.max(0, ...this.toks.map(k => k._hit ? Math.exp(-(t - k._hit) * 6) : 0))})` });
    // 토큰 흐름
    this.toks.forEach((k) => {
      const t0 = T0 + 2.0 + k.i * 0.3, tg = t0 + 0.75, tn = tg + 0.8;
      const [bx0, by0, bw] = S5_BOX[k.bi]; const [sx0, sy0] = map(bx0 + bw * 0.3, S5_BOX[k.bi][1]);
      const gy = 300 + k.i * 72, lx = GATE - k.w - 26;
      let x, y, op = 1, sc2 = 1;
      if (t < t0) { op = 0; x = sx0; y = sy0; }
      else if (t < tg) { const p = ease.outCubic((t - t0) / (tg - t0)); x = lerp(sx0, lx, p); y = lerp(sy0, gy, p); op = clamp((t - t0) / 0.15); }
      else if (k.kind === 'drop') { const d = t - tg; x = lx - 18 * Math.sin(Math.min(d, 0.3) / 0.3 * Math.PI) * Math.exp(-d * 4); y = gy + 260 * ease.inQuad(clamp((d - 0.35) / 0.6)); op = 1 - clamp((d - 0.4) / 0.5); }
      else { const p = ease.inOutCubic(clamp((t - tg) / (tn - tg))); x = lerp(lx, NODE[0] - 80, p); y = lerp(gy, NODE[1] - 20, p); sc2 = 1 - p * 0.6; op = 1 - clamp((t - tn + 0.15) / 0.15); }
      k._hit = t >= tn && k.kind !== 'drop' ? tn : 0;
      // 개인정보: 문을 지나며 글자가 ●로 뭉개짐
      if (k.kind === 'pii') {
        const m = clamp((t - (tg - 0.05)) / 0.35);
        const n = Math.floor(m * k.tx.length);
        k.e.textContent = k.tx.split('').map((c, j) => (j < n && /[0-9A-Za-z@.\-]/.test(c) ? '●' : c)).join('');
        css(k.e, { color: m > 0 ? '#9fb3c8' : '#ffd9a8', borderColor: m > 0 ? 'rgba(159,179,200,.6)' : 'rgba(255,217,168,.8)' });
      }
      if (k.kind === 'drop') css(k.e, { borderColor: 'rgba(255,217,168,.8)', textDecoration: t >= tg ? 'line-through' : 'none' });
      css(k.e, { opacity: op, transform: `translate(${x}px, ${y}px) scale(${sc2})`, transformOrigin: '0 50%' });
    });
    // 카드 조립
    const cp = prog(t, T0 + 5.2, 0.6, ease.outBack);
    css(this.card, { opacity: cp > 1e-3 ? 1 : 0, transform: `translateY(${(1 - cp) * 60}px) scale(${lerp(0.9, 1, cp)})` });
    this.cardLines.forEach((e, i) => { const p = stagger(t, T0 + 5.6, 0.09, 0.35, i); css(e, { opacity: p, transform: `translateX(${(1 - p) * 20}px)` }); });
    this.typeRows.forEach(({ e, tx }, j) => { const p = prog(t, T0 + 6.3 + j * 0.55, 0.5, ease.linear); e.textContent = tx.slice(0, Math.ceil(p * tx.length)); });
    const dz = prog(t, T0 + 5.0, 3.2, ease.inOutSine);
    css(this.dark, { transformOrigin: '1620px 550px', transform: `scale(${1 + 0.06 * dz})` });
    // 헤드라인
    riseRender(this.heads[0], t - T0, 0.75, 2.75, 0.03);
    riseRender(this.heads[1], t - T0, 3.0, 5.05, 0.025);
    riseRender(this.heads[2], t - T0, 5.3, 7.75, 0.03);
    css(this.note, { opacity: prog(t, T0 + 2.0, 0.4) * (1 - prog(t, T0 + 7.6, 0.3)) });
    // 카드가 화면을 채워 엔드카드 바탕이 됨
    const T1 = cue('scene.s6'), z = prog(t, T1 - 0.55, 0.55, ease.inExpo);
    css(this.fill, { opacity: z > 0 ? 1 : 0, left: lerp(1400, -20, z) + 'px', top: lerp(220, -20, z) + 'px', width: lerp(440, 1960, z) + 'px', height: lerp(660, 1120, z) + 'px', borderRadius: `${18 * (1 - z)}px` });
  } });

/* ───────── 6구간 40–48: 엔드카드 ───────── */
REEL.scene({ id: 's6', start: E('scene.s6'), end: 48,
  setup(el) {
    css(el, { background: '#fff' });
    this.cards = ['01', '04', '02'].map((n, i) => {
      const c = h('img', 'a', el); c.src = REAL(`${n}_panel.png`);
      css(c, { left: `${1180 + i * 150}px`, top: '230px', width: '320px', height: '576px', borderRadius: '14px', boxShadow: '0 24px 60px rgba(31,35,40,.22), 0 0 0 1px rgba(31,35,40,.1)' });
      return c;
    });
    // 이름: 2구간의 자모 조립을 되받는다
    this.pieces = []; let k = 0, nx = 150;
    [...'페이지 매뉴얼'].forEach((ch, ci) => {
      const m = h('div', 'a', el, ch === ' ' ? ' ' : ch); css(m, { font: '920 150px Pretendard', letterSpacing: '-0.04em', visibility: 'hidden' });
      const cw = m.getBoundingClientRect().width; m.remove();
      if (ch !== ' ') jamoRegions(ch).forEach(([a0, b0, c0, d0]) => {
        const pc = h('div', 'a', el, ch);
        css(pc, { left: nx + 'px', top: '300px', font: '920 150px Pretendard', lineHeight: 1.1, letterSpacing: '-0.04em', color: ci >= 4 ? C.accent : C.ink,
          clipPath: `inset(${b0 * 100}% ${(1 - c0) * 100}% ${(1 - d0) * 100}% ${a0 * 100}%)` });
        const side = rand(k, 11) < 0.5;
        this.pieces.push({ el: pc, k, dx: side ? (rand(k, 12) < 0.5 ? -1 : 1) * (380 + 200 * rand(k, 13)) : 0, dy: side ? 0 : -(360 + 200 * rand(k, 14)), slide: side });
        k++;
      });
      nx += cw;
    });
    this.sub = riseLine(el, '화면마다 역할·기능·조작 방법을.', { left: '156px', top: '500px', font: '600 44px Pretendard', color: C.muted, letterSpacing: '-0.02em', whiteSpace: 'nowrap' });
    this.chips = ['Chrome 확장', '사이드 패널', '작성 매뉴얼 + AI 생성'].map((tx, i) => { const c = h('div', 'a', el, tx);
      css(c, { left: 0, top: '600px', font: '700 30px Pretendard', color: C.accent, border: `2px solid ${C.accent}`, padding: '8px 22px', borderRadius: '30px', whiteSpace: 'nowrap', background: '#fff' }); return c; });
    let x = 156; this.chips.forEach(c => { css(c, { left: x + 'px' }); x += c.getBoundingClientRect().width + 14; });
    this.url = h('div', 'a', el, 'github.com/zhtmr/manual-extension'); css(this.url, { left: '156px', top: '720px', font: '500 40px "JetBrains Mono", Pretendard', color: C.ink, whiteSpace: 'nowrap' });
    this.ul = h('div', 'a', el); css(this.ul, { left: '156px', top: '778px', width: this.url.getBoundingClientRect().width + 'px', height: '4px', background: C.accent, transformOrigin: '0 50%' });
  },
  render(lt, ctx) {
    const t = ctx.t, T0 = cue('scene.s6');
    this.cards.forEach((c, i) => {
      const p = clamp((t - (T0 + 0.05 + i * 0.09)) / 0.55);
      const e = spring(t, T0 + 0.05 + i * 0.09, 2.6, 0.5);
      const rot = [-9, -1, 7][i], dy = [40, 0, 30][i];
      css(c, { opacity: p > 0 ? 1 : 0, transform: `translate(${noise(t * 0.35, i) * 7}px, ${(1 - e) * 700 + dy + noise(t * 0.35, i + 5) * 7}px) rotate(${rot * e + (1 - e) * 20}deg)` });
    });
    this.pieces.forEach((p) => {
      const L = T0 + p.k * 0.1 - 0.5 * F;
      const kk = t >= L ? 0 : p.slide ? 1 - ease.outExpo(clamp((t - (L - 3 * F)) / (10 * F))) : 1 - ease.inExpo(clamp((t - (L - 7 * F)) / (7 * F)));
      const q = t < L ? 1 : t < L + 2 * F ? 0.88 : lerp(0.88, 1, ease.outBack(clamp((t - L - 2 * F) / (5 * F))));
      css(p.el, { transform: `translate(${p.dx * kk}px, ${p.dy * kk}px) scale(${1 + (1 - q) * 0.35}, ${q})`, transformOrigin: '50% 100%', opacity: kk > 0.98 ? 0 : 1 });
    });
    riseRender(this.sub, t - T0, 1.55, null, 0.025);
    this.chips.forEach((c, i) => { const p = stagger(t - T0, 2.3, 0.12, 0.4, i, ease.outBack); css(c, { opacity: p > 1e-3 ? 1 : 0, top: `${600 + (1 - p) * 20}px` }); });
    const u = prog(t, T0 + 3.7, 0.5, ease.outQuart);
    css(this.url, { opacity: u, top: `${720 + (1 - u) * 14}px` });
    css(this.ul, { transform: `scaleX(${prog(t, T0 + 3.85, 0.6, ease.swift)})` });
  } });
