// 옵션 페이지(모듈 6): API 키, 모델, AI 허용 사이트, 작성 매뉴얼 사이트 권한, AI 캐시, 개발 정보.
// 메시지는 쓰지 않는다. 서비스 워커는 결정할 때마다 storage를 읽으므로 바뀐 설정이 바로 반영된다.
// 렌더링은 textContent·DOM API만 쓴다. API 키는 화면에 마지막 4자만 보이고 로그에 남기지 않는다.
import { DEFAULT_MODEL, SUGGESTED_MODELS } from '../shared/constants.js';
import { getSettings, saveSettings, getApiKey, addAiOrigin, removeAiOrigin, isValidOrigin } from '../shared/settings.js';
import { clearAiCache, listCacheKeys } from '../background/ai-manual.js';
import { loadManuals, loadManualDir, shouldLoadDevManuals } from '../background/manual-store.js';

const $ = id => document.getElementById(id);
const storage = chrome.storage.local;

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'className') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'onClick') el.addEventListener('click', v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

function say(id, text, kind = 'info') {
  const el = $(id);
  el.textContent = text;
  el.dataset.kind = kind;
}

const hasPermission = origin => chrome.permissions.contains({ origins: [`${origin}/*`] }).catch(() => false);

// ---------- API 키 ----------

async function renderKey() {
  const key = await getApiKey();
  $('keyStatus').textContent = key ? `저장된 키: …${key.slice(-4)}` : '저장된 키가 없습니다.';
  $('keyDelete').disabled = !key;
}

$('keyForm').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('keyInput');
  const key = input.value.trim();
  if (!key) return say('keyMsg', 'API 키를 입력하세요.', 'error');
  if (/\s/.test(key) || key.length < 20) return say('keyMsg', 'API 키 형식이 올바르지 않습니다.', 'error');
  await storage.set({ apiKey: key });
  input.value = '';
  say('keyMsg', '저장했습니다.', 'ok');
  renderKey();
});

$('keyDelete').addEventListener('click', async () => {
  await storage.remove('apiKey');
  say('keyMsg', '키를 삭제했습니다.', 'ok');
  renderKey();
});

// ---------- 모델 ----------

async function renderModel() {
  const { model } = await getSettings();
  $('modelInput').value = model;
  $('modelList').replaceChildren(...SUGGESTED_MODELS.map(m => h('option', { value: m })));
}

$('modelForm').addEventListener('submit', async e => {
  e.preventDefault();
  const model = $('modelInput').value.trim();
  if (!/^[a-z0-9][a-z0-9.\-]{2,79}$/i.test(model)) return say('modelMsg', '모델 ID 형식이 올바르지 않습니다.', 'error');
  await saveSettings({ model });
  say('modelMsg', `${model}로 저장했습니다.`, 'ok');
});

$('modelReset').addEventListener('click', async () => {
  await saveSettings({ model: DEFAULT_MODEL });
  await renderModel();
  say('modelMsg', `기본값(${DEFAULT_MODEL})으로 되돌렸습니다.`, 'ok');
});

// ---------- 작성 매뉴얼 origin ----------

let authoredOriginsCache = null;
async function authoredOrigins() {
  if (!authoredOriginsCache) {
    const files = await loadManuals();
    authoredOriginsCache = [...new Set(files.flatMap(f => f.site?.origins ?? []))];
  }
  return authoredOriginsCache;
}

// ---------- AI 허용 사이트 ----------

async function renderSites() {
  const { aiAllowedOrigins } = await getSettings();
  const list = $('siteList');
  if (!aiAllowedOrigins.length) {
    list.replaceChildren(h('li', { className: 'empty', text: '허용한 사이트가 없습니다.' }));
    return;
  }
  const rows = await Promise.all(aiAllowedOrigins.map(async origin => {
    const granted = await hasPermission(origin);
    return h('li', { className: 'item' },
      h('span', { className: 'origin', text: origin }),
      h('span', { className: `pill ${granted ? 'ok' : 'warn'}`, text: granted ? '접근 허용됨' : '접근 권한 없음' }),
      h('button', { type: 'button', className: 'button small secondary', text: '삭제', onClick: () => removeSite(origin) }));
  }));
  list.replaceChildren(...rows);
}

// 권한 요청은 제출 처리 안에서 다른 await 없이 바로 부른다(사용자 제스처).
$('siteForm').addEventListener('submit', e => {
  e.preventDefault();
  const origin = $('siteInput').value.trim().replace(/\/+$/, '');
  if (!isValidOrigin(origin)) {
    say('siteMsg', 'http(s)://주소 또는 http(s)://주소:포트 형식으로 입력하세요(경로·쿼리 없이, 소문자). 예: https://gw.example.com', 'error');
    return;
  }
  chrome.permissions.request({ origins: [`${origin}/*`] })
    .then(async granted => {
      if (!granted) return say('siteMsg', '사이트 접근을 허용하지 않아 추가하지 않았습니다.', 'error');
      await addAiOrigin(origin);
      $('siteInput').value = '';
      say('siteMsg', `${origin}을 추가했습니다.`, 'ok');
      renderSites();
    })
    .catch(() => say('siteMsg', '권한을 요청하지 못했습니다.', 'error'));
});

async function removeSite(origin) {
  await removeAiOrigin(origin);
  const removed = await clearAiCache(storage, origin);
  // 작성 매뉴얼 사이트이면 하이라이트 권한까지 잃지 않도록 권한은 남긴다.
  const keepPermission = (await authoredOrigins()).includes(origin);
  if (!keepPermission) await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => false);
  say('siteMsg', `${origin}을 삭제했습니다(캐시 ${removed}건 삭제${keepPermission ? ', 작성 매뉴얼 사이트라 접근 권한은 유지' : ''}).`, 'ok');
  renderSites();
  renderCache();
}

// ---------- 작성 매뉴얼 사이트 권한 ----------

async function renderAuthored() {
  const origins = await authoredOrigins();
  const list = $('authoredList');
  $('authoredGrant').disabled = !origins.length;
  if (!origins.length) {
    list.replaceChildren(h('li', { className: 'empty', text: '불러온 작성 매뉴얼이 없습니다.' }));
    return;
  }
  const rows = await Promise.all(origins.map(async origin => {
    const granted = await hasPermission(origin);
    return h('li', { className: 'item' },
      h('span', { className: 'origin', text: origin }),
      h('span', { className: `pill ${granted ? 'ok' : 'warn'}`, text: granted ? '접근 허용됨' : '접근 권한 없음' }));
  }));
  list.replaceChildren(...rows);
}

$('authoredGrant').addEventListener('click', () => {
  // authoredOriginsCache는 화면을 그릴 때 채워 두었으므로 여기서는 await 없이 바로 요청한다.
  const origins = authoredOriginsCache ?? [];
  if (!origins.length) return;
  chrome.permissions.request({ origins: origins.map(o => `${o}/*`) })
    .then(granted => {
      say('authoredMsg', granted ? '접근을 허용했습니다.' : '접근을 허용하지 않았습니다.', granted ? 'ok' : 'error');
      renderAuthored();
    })
    .catch(() => say('authoredMsg', '권한을 요청하지 못했습니다.', 'error'));
});

// ---------- AI 캐시 ----------

async function renderCache() {
  const n = (await listCacheKeys(storage)).length;
  $('cacheStatus').textContent = `저장된 AI 매뉴얼 ${n}건`;
  $('cacheClear').disabled = n === 0;
}

$('cacheClear').addEventListener('click', async () => {
  const n = await clearAiCache(storage);
  say('cacheMsg', `AI 캐시 ${n}건을 지웠습니다.`, 'ok');
  renderCache();
});

// ---------- 개발 정보 ----------

// 개발 원본 빌드 + 개발 설치에서만 보인다. 배포물(압축 해제 설치 포함)에서는 manuals-dev를 읽지 않고 절을 건너뛴다.
async function renderDev() {
  if (!(await shouldLoadDevManuals())) return;
  const fetchJson = async path => {
    const res = await fetch(chrome.runtime.getURL(path));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  const files = async dir => {
    try { return ((await fetchJson(`${dir}/index.json`)).sites ?? []).map(s => `${dir}/${s.file}`); } catch { return []; }
  };
  const demo = await loadManualDir('manuals-dev', fetchJson, { optional: true });
  const rows = [
    ['데모 매뉴얼', demo.length ? `로드됨(${demo.map(f => `${f.site.id}: ${f.pages.length}페이지`).join(', ')})` : '없음'],
    ['매뉴얼 파일', [...await files('manuals'), ...await files('manuals-dev')].join(', ') || '없음'],
    ['확장 버전', chrome.runtime.getManifest().version],
  ];
  $('devInfo').replaceChildren(...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));
  $('devSection').hidden = false;
}

// ---------- 시작 ----------

renderKey();
renderModel();
renderSites();
renderAuthored();
renderCache();
renderDev();

// 다른 곳(패널의 AI 허용 등)에서 설정이 바뀌면 다시 그린다.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('apiKey' in changes) renderKey();
  if ('settings' in changes) renderSites();
  if (Object.keys(changes).some(k => k.startsWith('ai:'))) renderCache();
});
