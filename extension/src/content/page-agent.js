// 페이지 에이전트. ES 모듈이 아니다. 서비스 워커가 필요할 때 executeScript로 주입한다.
// 여러 번 주입되어도 한 번만 실행되도록 IIFE와 전역 플래그로 감싼다.
//
// 하는 일
//  - EXTRACT_PAGE: DOM이 잠잠해질 때까지 기다린 뒤 PageStructure(설계 ⑦)를 만든다.
//    입력·선택·텍스트영역의 값은 읽지 않는다(값 속성 자체에 접근하지 않는다). password·hidden 필드는 통째로 뺀다.
//    표 본문 셀, 일반 문단, select 옵션 텍스트, contenteditable 내용, 쿼리 문자열은 넣지 않는다.
//  - HIGHLIGHT / CLEAR_HIGHLIGHT: 페이지 요소의 스타일은 건드리지 않고, 문서 끝에 붙인 별도 오버레이로 표시한다.
(() => {
  if (window.__pageManualAgentLoaded) return;
  window.__pageManualAgentLoaded = true;

  // sync: src/shared/messages.js
  const MSG = Object.freeze({
    MANUAL_UPDATED: 'MANUAL_UPDATED',
    GET_CURRENT_MANUAL: 'GET_CURRENT_MANUAL',
    REFRESH_MANUAL: 'REFRESH_MANUAL',
    REGENERATE_MANUAL: 'REGENERATE_MANUAL',
    EXTRACT_PAGE: 'EXTRACT_PAGE',
    HIGHLIGHT: 'HIGHLIGHT',
    CLEAR_HIGHLIGHT: 'CLEAR_HIGHLIGHT',
  });

  // constants.js의 STRUCTURE_MAX_ITEMS, STRUCTURE_MAX_TEXT, DOM_SETTLE_*, HIGHLIGHT_AUTO_CLEAR_MS와 같은 값
  const maxItems = 50;
  const maxText = 120;
  const settleQuietMs = 300;
  const settleMaxMs = 2000;
  const highlightMs = 5000;
  const maxSelectors = 20;

  // 오버레이 host는 페이지 선택자(div, #id 등)가 잡지 않는 사용자 정의 태그로 만든다.
  const overlayTag = 'page-manual-overlay';

  // ---------- 개인정보 마스킹 (matcher.js의 maskPii·containsPii·maskPath와 같은 규칙) ----------

  // pii:begin — 이 블록은 src/shared/matcher.js와 src/content/page-agent.js에 글자 그대로 같아야 한다(테스트가 대조).
  // 개인정보 마스커(설계 ⑦ 강화, 리더 결정 r5·r6·r7 — r7 조정 이후 확장 중단).
  // 순서: 정규화 → 이메일 → 글자 사이 공백 주민번호형 → 주민번호형 → 카드 → 전화 → 계좌형 → 긴 숫자열.
  const piiMask = '***';
  // 보이지 않는 문자: soft hyphen, 결합 문자 표시 금지자, ZWSP·ZWNJ·ZWJ·LRM·RLM, 양방향 제어, word joiner 등, 한글 채움, 변형 선택자, BOM
  const piiInvisibleRe = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u206a-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;
  // 하이픈·대시류(하이픈, U+2010~U+2015)
  const piiDash = String.raw`\-\u2010-\u2015`;
  const piiSep = String.raw`[\s._${piiDash}]*`;
  const piiEmailRe = /[^\s@<>()[\]{}"',;:]+@[^\s@<>()[\]{}"',;:]+/g;
  // "9 0 0 1 0 1 - 1 2 3 4 5 6 7"처럼 글자 사이에 공백이 낀 주민번호형
  const piiSpacedRrnRe = new RegExp(String.raw`(?<!\d)(?:\d[ \t]+){5}\d[ \t]*[.${piiDash}]?[ \t]*(?:[\d*][ \t]+){6}[\d*](?!\d)`, 'g');
  const piiRrnRe = new RegExp(String.raw`(?<!\d)\d{6}${piiSep}[1-8*][\d*]{6}(?!\d)`, 'g');
  const piiCardRe = new RegExp(String.raw`(?<!\d)\d{4}([ \t.${piiDash}])\d{4}\1\d{4}\1\d{3,4}(?!\d)`, 'g');
  const piiPhoneRe = new RegExp(String.raw`(?<!\d)(?:\+\s*82[\s._${piiDash})]*\(?0?|\(?0)\d{1,2}\)?${piiSep}\d{3,4}${piiSep}\d{4}(?!\d)`, 'g');
  // 계좌형: 같은 구분자(하이픈·대시·공백 중 한 글자)로 이은 숫자 묶음 3개 이상(합계 10자리 이상이면 마스킹).
  // 구분자가 섞이면 이어 보지 않는다("2026-10-23 14:30" 보존). 마침표는 넣지 않는다(IP 주소 보존).
  const piiAccountRe = new RegExp(String.raw`(?<!\d)\d+([ \t${piiDash}])\d+(?:\1\d+)+(?!\d)`, 'g');
  const piiLongDigitsRe = /(?<!\d)\d{6,}(?!\d)/g;
  // 9자리 이하 숫자 뒤에 바로(또는 공백 한 칸 뒤에) 붙으면 업무 수치로 보고 남기는 단위
  const piiUnitRe = /^ ?(?:원|건|개|명|회|일|시간|분|초|바이트|KB|MB|%)/i;
  // "hong @ corp.com"처럼 양쪽이 이메일 모양일 때만 @ 앞뒤 공백을 붙인다("회의실 @ 3층"은 그대로)
  const piiSpacedAtRe = /([A-Za-z0-9._-]+)[ \t]*@[ \t]*(?=[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

  // 유니코드 십진 숫자(아랍-인도 숫자 등)를 ASCII로
  function piiDigitsToAscii(s) {
    return s.replace(/\p{Nd}/gu, ch => {
      const cp = ch.codePointAt(0);
      if (cp <= 0x39) return ch;
      let zero = cp;
      while (zero > cp - 9 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero -= 1;
      return String(cp - zero);
    });
  }

  // 검사 전 정규화: NFKC(전각 숫자·＠·－ 등) → 보이지 않는 문자 제거 → 숫자 ASCII화 → [at]·(at) → @, 이메일 모양일 때만 " @ " → @
  function piiNormalize(s) {
    let t = String(s ?? '').normalize('NFKC').replace(piiInvisibleRe, '');
    t = piiDigitsToAscii(t);
    t = t.replace(/\s*[[({]\s*(?:at|골뱅이)\s*[\])}]\s*/gi, '@').replace(piiSpacedAtRe, '$1@');
    return t;
  }

  function piiValidYmd(d) {
    const y = Number(d.slice(0, 4));
    const m = Number(d.slice(4, 6));
    const day = Number(d.slice(6, 8));
    return y >= 1900 && y <= 2099 && m >= 1 && m <= 12 && day >= 1 && day <= 31;
  }

  /** 문자열을 정규화하고 개인정보 패턴을 '***'로 바꾼다. */
  function maskPii(s) {
    return piiNormalize(s)
      .replace(piiEmailRe, piiMask)
      .replace(piiSpacedRrnRe, piiMask)
      .replace(piiRrnRe, piiMask)
      .replace(piiCardRe, piiMask)
      .replace(piiPhoneRe, piiMask)
      .replace(piiAccountRe, m => (m.replace(/\D/g, '').length >= 10 ? piiMask : m))
      .replace(piiLongDigitsRe, (m, offset, str) => {
        if (m.length <= 9 && piiUnitRe.test(str.slice(offset + m.length))) return m;
        if (m.length === 8 && piiValidYmd(m)) return m;
        return piiMask;
      });
  }

  /** 개인정보 패턴이 들어 있는가(마스킹으로 바뀌는 부분이 있는가). */
  function containsPii(s) {
    return maskPii(s) !== piiNormalize(s);
  }
  // pii:end

  // 공백 정리 → 개인정보 마스킹 → 120자. PageStructure의 모든 글자는 이 함수를 거친다(선택자 제외).
  const clip = s => {
    const t = maskPii(String(s ?? '').replace(/\s+/g, ' ').trim());
    return t.length > maxText ? t.slice(0, maxText) : t;
  };

  const isVisible = el => el.getClientRects().length > 0 && !el.closest(overlayTag);

  // ---------- 위험 영역 판정 ----------
  // 요소 자신이나 조상이 아래에 해당하면 그 요소는 어떤 항목으로도 수집하지 않는다.
  //  - 편집 영역(contenteditable true/""/plaintext-only, isContentEditable, role=textbox)
  //  - textarea, select, option(값·옵션 텍스트)
  //  - 표 본문(td, tbody, tfoot): 셀 글자와 행 안의 버튼·링크·제목·안내
  const editableSel = '[contenteditable]:not([contenteditable="false"]), [role="textbox"]';
  const valueSel = 'textarea, select, option';
  const tableBodySel = 'td, tbody, tfoot';
  const riskyZoneSel = `${editableSel}, ${valueSel}, ${tableBodySel}`;
  const riskyZoneNoTableSel = `${editableSel}, ${valueSel}`;
  // 글자를 읽을 때 자손에서 지우는 것
  const riskyDescendantSel = `${editableSel}, ${valueSel}, table, input, script, style, template, noscript`;

  /**
   * 요소 자신이나 조상이 위험 영역인가. allowTableHeader면 표 본문 판정을 빼고 본다
   * (thead가 없는 표의 머리글 행은 브라우저가 tbody 안에 둔다).
   */
  function inRiskyZone(el, { allowTableHeader = false } = {}) {
    if (!el || el.nodeType !== 1) return true;
    if (el.isContentEditable) return true;
    return !!el.closest(allowTableHeader ? riskyZoneNoTableSel : riskyZoneSel);
  }

  // 숨긴 요소(하위 전체를 뺀다): hidden 속성, aria-hidden="true", display:none, visibility:hidden/collapse, opacity:0
  function isHiddenEl(el) {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
    const cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || parseFloat(cs.opacity) === 0;
  }

  // font-size:0인 요소의 직접 글자는 화면에 보이지 않는다. 자식 요소는 자기 글자 크기로 다시 판정한다
  // (목록 공백을 없애려고 부모에 font-size:0을 주고 자식에서 되돌리는 레이아웃이 흔하다).
  const zeroFont = el => parseFloat(getComputedStyle(el).fontSize) === 0;

  // 원본 DOM을 걸으며 글자를 모은다. 위험 자손과 숨긴 자손(계산 스타일 기준)은 통째로 건너뛴다.
  function visibleText(root) {
    let out = '';
    const walk = node => {
      const ownTextHidden = zeroFont(node);
      for (const c of node.childNodes) {
        if (c.nodeType === 3) { if (!ownTextHidden) out += c.data; }
        else if (c.nodeType === 1) {
          if (c.tagName === 'BR') { out += ' '; continue; }
          if (c.matches(riskyDescendantSel) || isHiddenEl(c)) continue;
          walk(c);
        }
      }
    };
    walk(root);
    return out;
  }

  // 위험 영역이거나 숨긴 요소면 '', 아니면 위험·숨긴 자손을 뺀 글자(마스킹·120자)
  function safeText(el, opts) {
    if (inRiskyZone(el, opts) || isHiddenEl(el)) return '';
    return clip(visibleText(el));
  }

  // matcher.js의 maskPath·hashPath와 같은 규칙(숫자, UUID, YYYY-MM-DD, '@'·개인정보가 든 세그먼트 → *)
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };
  const maskPath = path => path.split('/')
    .map(seg => {
      if (!seg) return seg;
      const d = safeDecode(seg);
      return /^\d+$/.test(seg) || uuidRe.test(seg) || /^\d{4}-\d{2}-\d{2}$/.test(seg) || d.includes('@') || containsPii(d) ? '*' : seg;
    })
    .join('/');
  const trimSlash = p => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);

  function maskedUrl() {
    const { origin, pathname, hash } = location;
    let out = origin + maskPath(trimSlash(pathname));
    if (/^#!?\//.test(hash)) out += '#' + maskPath(trimSlash(hash.replace(/^#!?/, '').split('?')[0] || '/'));
    return out;
  }

  function pushLimited(arr, item) {
    if (arr.length < maxItems) arr.push(item);
  }

  // ---------- 선택자 ----------

  const cssEscape = s => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
  const attrSel = (name, v) => `[${name}="${String(v).replace(/["\\]/g, '\\$&')}"]`;
  const testAttrs = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-action'];

  function uniqueIn(doc, sel, el) {
    try {
      const all = doc.querySelectorAll(sel);
      return all.length === 1 && all[0] === el;
    } catch {
      return false;
    }
  }

  // 선택자 후보 값에 개인정보 패턴('@' 포함)이 있으면 그 후보는 쓰지 않는다.
  const piiFree = v => !String(v).includes('@') && !containsPii(v);

  // #id > [name] > [data-*](시험·자동화용 속성만) > [aria-label] > 짧은 클래스 경로.
  // 유일하고 개인정보가 없는 첫 후보. 없으면 ''.
  function selectorFor(el) {
    const doc = el.ownerDocument;
    const tag = el.tagName.toLowerCase();
    const id = el.getAttribute('id');
    if (id && piiFree(id)) {
      const s = `#${cssEscape(id)}`;
      if (uniqueIn(doc, s, el)) return s;
    }
    const name = el.getAttribute('name');
    if (name && piiFree(name)) {
      const s = `${tag}${attrSel('name', name)}`;
      if (uniqueIn(doc, s, el)) return s;
    }
    for (const a of testAttrs) {
      const v = el.getAttribute(a);
      if (v && piiFree(v)) {
        const s = `${tag}${attrSel(a, v)}`;
        if (uniqueIn(doc, s, el)) return s;
      }
    }
    const aria = el.getAttribute('aria-label');
    if (aria && piiFree(aria)) {
      const s = `${tag}${attrSel('aria-label', aria)}`;
      if (uniqueIn(doc, s, el)) return s;
    }
    // 짧은 클래스 경로: 자신 + 최대 2단계 조상, 각 단계는 태그와 클래스 2개까지
    const step = n => {
      const classes = [...n.classList].filter(c => /^[A-Za-z_-][\w-]*$/.test(c) && piiFree(c)).slice(0, 2);
      return n.tagName.toLowerCase() + classes.map(c => `.${cssEscape(c)}`).join('');
    };
    if (el.classList.length) {
      let sel = step(el);
      let cur = el.parentElement;
      for (let depth = 0; depth < 3; depth++) {
        if (uniqueIn(doc, sel, el)) return sel.length <= maxText && piiFree(sel) ? sel : '';
        if (!cur || cur === doc.documentElement) break;
        sel = `${step(cur)} > ${sel}`;
        cur = cur.parentElement;
      }
    }
    return '';
  }

  // ---------- 라벨 ----------

  function labelFor(el) {
    const doc = el.ownerDocument;
    const id = el.getAttribute('id');
    if (id) {
      const lab = doc.querySelector(`label[for="${String(id).replace(/["\\]/g, '\\$&')}"]`);
      const t = lab ? safeText(lab) : '';
      if (t) return t;
    }
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return clip(aria);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const refs = by.split(/\s+/).map(ref => doc.getElementById(ref)).filter(Boolean);
      // 가리키는 요소 중 하나라도 위험 영역(표 셀, textarea, select, 편집 영역)이면 이 라벨은 통째로 버린다.
      if (refs.length && !refs.some(r => inRiskyZone(r))) {
        const t = clip(refs.map(r => safeText(r)).filter(Boolean).join(' '));
        if (t) return t;
      }
    }
    const wrap = el.closest('label');
    if (wrap) {
      const t = safeText(wrap); // 컨트롤 자신(input·select·textarea)은 자손 제거로 빠진다
      if (t) return t;
    }
    return '';
  }

  // ---------- 구조 추출 ----------

  const excludedInputTypes = new Set(['hidden', 'password', 'button', 'submit', 'reset', 'image']);
  const buttonInputTypes = new Set(['button', 'submit', 'reset']);

  function inputType(el) {
    return (el.getAttribute('type') || 'text').toLowerCase();
  }

  // thead가 없는 표의 머리글 행: 첫 행의 모든 셀이 th이고 scope="row"가 아닐 때만
  function headerCells(t) {
    const thead = [...t.querySelectorAll(':scope > thead th')];
    if (thead.length) return { cells: thead, allowTableHeader: false };
    const first = t.rows[0];
    if (!first || first.parentElement?.tagName === 'TFOOT') return { cells: [], allowTableHeader: false };
    const cells = [...first.cells];
    const ok = cells.length > 0 && cells.every(c => c.tagName === 'TH' && (c.getAttribute('scope') || '').toLowerCase() !== 'row');
    return { cells: ok ? cells : [], allowTableHeader: true };
  }

  function extractStructure(doc = document) {
    const out = {
      url: maskedUrl(),
      title: clip(doc.title),
      headings: [],
      nav: [],
      buttons: [],
      fields: [],
      tables: [],
      notices: [],
    };

    for (const h of doc.querySelectorAll('h1, h2, h3')) {
      if (!isVisible(h)) continue;
      const text = safeText(h); // 위험 영역 안이면 ''
      if (text) pushLimited(out.headings, { level: Number(h.tagName[1]), text });
    }

    const navSeen = new Set();
    for (const a of doc.querySelectorAll('nav a, [role="navigation"] a, [role="menu"] a, [role="menu"] [role="menuitem"]')) {
      if (!isVisible(a)) continue;
      const text = safeText(a);
      if (text && !navSeen.has(text)) {
        navSeen.add(text);
        pushLimited(out.nav, text);
      }
    }

    const btnSeen = new Set();
    for (const el of doc.querySelectorAll('button, [role="button"], input')) {
      if (btnSeen.has(el) || !isVisible(el)) continue;
      btnSeen.add(el);
      // 표 본문 행·편집 영역 안의 버튼은 글자·aria-label·title 모두 쓰지 않는다.
      if (inRiskyZone(el)) continue;
      let text;
      if (el.tagName === 'INPUT') {
        if (!buttonInputTypes.has(inputType(el))) continue;
        // 버튼형 input의 표시 글자는 속성으로만 읽는다(입력값이 아니다).
        text = clip(el.getAttribute('value') || el.getAttribute('aria-label') || '');
      } else {
        text = safeText(el) || clip(el.getAttribute('aria-label') || el.getAttribute('title') || '');
      }
      if (text) pushLimited(out.buttons, { text, selector: selectorFor(el) });
    }

    for (const el of doc.querySelectorAll('input, textarea, select')) {
      if (!isVisible(el)) continue;
      // 컨트롤 자신은 textarea·select일 수 있으므로 조상(부모부터)과 편집 상태로 판정한다.
      if (el.isContentEditable || inRiskyZone(el.parentElement)) continue;
      let type;
      if (el.tagName === 'INPUT') {
        type = inputType(el);
        if (excludedInputTypes.has(type)) continue;
      } else {
        type = el.tagName.toLowerCase();
      }
      pushLimited(out.fields, {
        label: labelFor(el),
        type: clip(type),
        placeholder: clip(el.getAttribute('placeholder') || ''),
        selector: selectorFor(el),
      });
    }

    for (const t of doc.querySelectorAll('table')) {
      if (!isVisible(t) || inRiskyZone(t)) continue;
      const caption = t.caption ? safeText(t.caption) : '';
      const { cells, allowTableHeader } = headerCells(t);
      const headers = cells.slice(0, maxItems).map(th => safeText(th, { allowTableHeader })).filter(Boolean);
      if (caption || headers.length) pushLimited(out.tables, { caption, headers });
    }

    const noticeSeen = new Set();
    const noticeSel = '[role="alert"], [role="status"], [aria-live], .help, .hint, .notice, .guide, form small';
    for (const el of doc.querySelectorAll(noticeSel)) {
      if (!isVisible(el)) continue;
      const text = safeText(el); // textarea.help, td.notice, 편집 영역 notice는 ''
      if (text && !noticeSeen.has(text)) {
        noticeSeen.add(text);
        pushLimited(out.notices, text);
      }
    }
    return out;
  }

  // DOM이 settleQuietMs 동안 바뀌지 않거나 settleMaxMs가 지나면 끝난다.
  function waitForDomSettle() {
    return new Promise(resolve => {
      let quiet;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(quiet);
        clearTimeout(hardStop);
        observer.disconnect();
        resolve();
      };
      const observer = new MutationObserver(() => {
        clearTimeout(quiet);
        quiet = setTimeout(finish, settleQuietMs);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      quiet = setTimeout(finish, settleQuietMs);
      const hardStop = setTimeout(finish, settleMaxMs);
    });
  }

  // ---------- 하이라이트 ----------

  let overlay = null; // { host, root, boxes: [{ el, box }], timer, onMove }

  function clearHighlight() {
    if (!overlay) return;
    clearTimeout(overlay.timer);
    window.removeEventListener('scroll', overlay.onMove, true);
    window.removeEventListener('resize', overlay.onMove);
    overlay.host.remove();
    overlay = null;
  }

  function placeBoxes() {
    if (!overlay) return;
    for (const { el, box } of overlay.boxes) {
      const r = el.getBoundingClientRect();
      const s = box.style;
      s.left = `${r.left - 4}px`;
      s.top = `${r.top - 4}px`;
      s.width = `${r.width + 8}px`;
      s.height = `${r.height + 8}px`;
      s.display = r.width || r.height ? 'block' : 'none';
    }
  }

  function highlight(selectors) {
    clearHighlight();
    const list = Array.isArray(selectors) ? selectors.filter(s => typeof s === 'string' && s.trim()).slice(0, maxSelectors) : [];
    const found = [];
    for (const sel of list) {
      let el = null;
      try {
        el = document.querySelector(sel);
      } catch {
        continue; // 잘못된 선택자는 건너뛴다
      }
      if (el && isVisible(el) && !found.includes(el)) found.push(el);
    }
    if (!found.length) return 0;

    // 오버레이: 문서 끝에 붙인 사용자 정의 태그 요소. 페이지 CSS는 inline `all: initial !important`로 끊고
    // (inline !important가 페이지 스타일시트의 !important보다 우선한다) 필요한 속성만 다시 준다.
    // 상자는 그림자 DOM 안에 있어 페이지 CSS가 닿지 않는다. 스타일은 CSSOM으로만 준다(페이지 CSP 영향 없음).
    const host = document.createElement(overlayTag);
    const hs = host.style;
    const hostStyle = [
      ['all', 'initial'], ['display', 'block'], ['position', 'fixed'], ['inset', '0'], ['margin', '0'], ['padding', '0'],
      ['border', '0'], ['outline', '0'], ['opacity', '1'], ['visibility', 'visible'], ['transform', 'none'],
      ['filter', 'none'], ['clip-path', 'none'], ['pointer-events', 'none'], ['z-index', '2147483647'],
      ['width', 'auto'], ['height', 'auto'], ['contain', 'none'],
    ];
    for (const [prop, val] of hostStyle) hs.setProperty(prop, val, 'important');
    const root = host.attachShadow({ mode: 'closed' });
    const boxes = found.map(el => {
      const box = document.createElement('div');
      const s = box.style;
      s.position = 'fixed';
      s.boxSizing = 'border-box';
      s.border = '3px solid #f59e0b';
      s.borderRadius = '6px';
      s.background = 'rgba(245, 158, 11, 0.14)';
      s.boxShadow = '0 0 0 4px rgba(245, 158, 11, 0.28)';
      s.pointerEvents = 'none';
      root.append(box);
      return { el, box };
    });
    document.documentElement.appendChild(host); // 문서 끝(body 뒤)

    let frame = 0;
    const onMove = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        placeBoxes();
      });
    };
    overlay = { host, root, boxes, onMove, timer: setTimeout(clearHighlight, highlightMs) };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    found[0].scrollIntoView({ block: 'center' });
    placeBoxes();
    return found.length;
  }

  // ---------- 메시지 ----------

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    switch (message?.type) {
      case MSG.EXTRACT_PAGE:
        waitForDomSettle()
          .then(() => sendResponse(extractStructure()))
          .catch(e => sendResponse({ ok: false, error: { code: 'EXTRACT_FAILED', message: String(e?.message ?? e).slice(0, 120) } }));
        return true;
      case MSG.HIGHLIGHT: {
        let found = 0;
        try { found = highlight(message.selectors); } catch { found = 0; }
        sendResponse({ found });
        return false;
      }
      case MSG.CLEAR_HIGHLIGHT:
        clearHighlight();
        sendResponse({ ok: true });
        return false;
      default:
        return false;
    }
  });
})();
