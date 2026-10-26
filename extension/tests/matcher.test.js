import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findPage, dedupeKey, aiCacheKey, maskPath, hashPath, maskPii, containsPii } from '../src/shared/matcher.js';

const O = 'https://gw.example.com';
const page = (id, match) => ({ id, match });
const site = (pages, origins = [O], id = 'gw') => ({ schemaVersion: 1, site: { id, origins }, pages });
const idOf = (files, url) => findPage(files, url)?.page.id ?? null;

test('exact: 정규화한 pathname이 같아야 한다', () => {
  const f = [site([page('a', { type: 'exact', pattern: '/approval/inbox' })])];
  assert.equal(idOf(f, `${O}/approval/inbox`), 'a');
  assert.equal(idOf(f, `${O}/approval/inbox/`), 'a', '끝 / 무시');
  assert.equal(idOf(f, `${O}/approval/inbox/x`), null);
  assert.equal(idOf(f, `${O}/Approval/inbox`), null, '대소문자 구분');
});

test('exact 패턴 끝의 /도 정규화하고 루트 /는 그대로', () => {
  const f = [site([page('a', { type: 'exact', pattern: '/list/' }), page('root', { type: 'exact', pattern: '/' })])];
  assert.equal(idOf(f, `${O}/list`), 'a');
  assert.equal(idOf(f, `${O}/`), 'root');
  assert.equal(idOf(f, O), 'root');
});

test('glob: *는 한 세그먼트, **는 여러 세그먼트', () => {
  const f = [site([
    page('one', { type: 'glob', pattern: '/board/*' }),
    page('many', { type: 'glob', pattern: '/docs/**' }),
  ])];
  assert.equal(idOf(f, `${O}/board/123`), 'one');
  assert.equal(idOf(f, `${O}/board/123/edit`), null);
  assert.equal(idOf(f, `${O}/board`), null, '*는 빈 세그먼트에 맞지 않는다');
  assert.equal(idOf(f, `${O}/docs/a/b/c`), 'many');
  assert.equal(idOf(f, `${O}/docs/a`), 'many');
});

test('glob 패턴의 정규식 특수문자는 글자 그대로', () => {
  const f = [site([page('dot', { type: 'glob', pattern: '/file.do' })])];
  assert.equal(idOf(f, `${O}/file.do`), 'dot');
  assert.equal(idOf(f, `${O}/fileXdo`), null);
});

test('regex: pathname에 적용, 잘못된 정규식은 무시', () => {
  const warn = console.warn;
  const warned = [];
  console.warn = m => warned.push(m);
  try {
    const f = [site([
      page('bad', { type: 'regex', pattern: '([' }),
      page('rx', { type: 'regex', pattern: '^/item/\\d+$' }),
    ])];
    assert.equal(idOf(f, `${O}/item/42`), 'rx');
    assert.equal(idOf(f, `${O}/item/abc`), null);
    assert.ok(warned.length >= 1, '잘못된 정규식 경고');
  } finally {
    console.warn = warn;
  }
});

test('query: 지정한 값이 같아야 하고 "*"는 키 존재만 확인', () => {
  const f = [site([
    page('tab', { type: 'exact', pattern: '/list', query: { tab: 'done' } }),
    page('any', { type: 'exact', pattern: '/view', query: { id: '*' } }),
  ])];
  assert.equal(idOf(f, `${O}/list?tab=done`), 'tab');
  assert.equal(idOf(f, `${O}/list?x=1&tab=done`), 'tab');
  assert.equal(idOf(f, `${O}/list?tab=todo`), null);
  assert.equal(idOf(f, `${O}/list`), null);
  assert.equal(idOf(f, `${O}/view?id=7`), 'any');
  assert.equal(idOf(f, `${O}/view?id=`), 'any');
  assert.equal(idOf(f, `${O}/view`), null);
});

test('hash: 해시 경로에 패턴 적용, pathname은 보지 않는다', () => {
  const f = [site([page('inbox', { type: 'exact', pattern: '/inbox', hash: true })])];
  assert.equal(idOf(f, `${O}/app#/inbox`), 'inbox');
  assert.equal(idOf(f, `${O}/other#/inbox`), 'inbox');
  assert.equal(idOf(f, `${O}/app#/inbox/`), 'inbox');
  assert.equal(idOf(f, `${O}/app`), null);
  assert.equal(idOf(f, `${O}/inbox`), null, 'hash 페이지는 pathname에 맞지 않는다');
  // 검증기와 같은 규칙: 해시뱅은 매칭에서 처리하지 않는다(설계 ⑤-2).
  assert.equal(idOf(f, `${O}/app#!/inbox`), null);
});

test('origin이 다르면 맞지 않는다', () => {
  const f = [site([page('a', { type: 'exact', pattern: '/' })])];
  assert.equal(idOf(f, 'http://gw.example.com/'), null, '스킴 다름');
  assert.equal(idOf(f, 'https://gw.example.com:8443/'), null, '포트 다름');
  assert.equal(idOf(f, 'https://other.example.com/'), null);
});

test('우선순위: exact > glob > regex', () => {
  const f = [site([
    page('rx', { type: 'regex', pattern: '^/orders/.*$' }),
    page('gl', { type: 'glob', pattern: '/orders/*' }),
    page('ex', { type: 'exact', pattern: '/orders/new' }),
  ])];
  assert.equal(idOf(f, `${O}/orders/new`), 'ex');
  assert.equal(idOf(f, `${O}/orders/5`), 'gl');
  assert.equal(idOf(f, `${O}/orders/5/x`), 'rx');
});

test('우선순위: 같은 종류면 긴 패턴, 그다음 쿼리 조건 수', () => {
  const f = [site([
    page('short', { type: 'glob', pattern: '/a/**' }),
    page('long', { type: 'glob', pattern: '/a/b/**' }),
    page('q0', { type: 'exact', pattern: '/q' }),
    page('q2', { type: 'exact', pattern: '/q', query: { x: '*', y: '*' } }),
    page('q1', { type: 'exact', pattern: '/q', query: { x: '*' } }),
  ])];
  assert.equal(idOf(f, `${O}/a/b/c`), 'long');
  assert.equal(idOf(f, `${O}/a/z`), 'short');
  assert.equal(idOf(f, `${O}/q?x=1&y=2`), 'q2');
  assert.equal(idOf(f, `${O}/q?x=1`), 'q1');
  assert.equal(idOf(f, `${O}/q`), 'q0');
});

test('완전 동률이면 먼저 나온 페이지(검증기와 같다)', () => {
  const f = [site([page('first', { type: 'glob', pattern: '/x/*' }), page('second', { type: 'glob', pattern: '/*/y' })])];
  assert.equal(idOf(f, `${O}/x/y`), 'first');
});

test('여러 사이트 파일 중 origin이 맞는 파일에서 찾고 siteId를 돌려준다', () => {
  const f = [
    site([page('a', { type: 'exact', pattern: '/' })], ['https://one.example.com'], 'one'),
    site([page('b', { type: 'exact', pattern: '/' })], ['https://two.example.com', 'http://two.local:8080'], 'two'),
  ];
  assert.deepEqual(findPage(f, 'http://two.local:8080/'), { siteId: 'two', page: f[1].pages[0] });
  assert.equal(findPage(f, 'https://one.example.com/').siteId, 'one');
});

test('잘못된 입력에도 예외 없이 null', () => {
  const f = [site([page('a', { type: 'exact', pattern: '/' }), { id: 'nomatch' }, null])];
  assert.equal(findPage(f, 'not a url'), null);
  assert.equal(findPage(null, `${O}/`), null);
  assert.equal(findPage([null, {}, { site: {} }], `${O}/`), null);
  assert.equal(idOf(f, `${O}/`), 'a');
  assert.equal(idOf(f, new URL(`${O}/`)), 'a', 'URL 객체도 받는다');
});

test('dedupeKey: #section 앵커 무시, #/a와 #!/a 구분, 쿼리 순서 무관, 끝 / 무시', () => {
  assert.equal(dedupeKey(`${O}/page#section`), dedupeKey(`${O}/page`));
  assert.equal(dedupeKey(`${O}/page#`), dedupeKey(`${O}/page`));
  assert.notEqual(dedupeKey(`${O}/app#/a`), dedupeKey(`${O}/app#/b`));
  assert.notEqual(dedupeKey(`${O}/app#/a`), dedupeKey(`${O}/app#!/a`));
  assert.notEqual(dedupeKey(`${O}/app#/a`), dedupeKey(`${O}/app`));
  assert.equal(dedupeKey(`${O}/l?b=2&a=1`), dedupeKey(`${O}/l?a=1&b=2`));
  assert.equal(dedupeKey(`${O}/l?a=2&a=1`), dedupeKey(`${O}/l?a=1&a=2`));
  assert.notEqual(dedupeKey(`${O}/l?a=1`), dedupeKey(`${O}/l?a=2`));
  assert.equal(dedupeKey(`${O}/list/`), dedupeKey(`${O}/list`));
  assert.equal(dedupeKey(`${O}/`), `${O}/`);
  assert.notEqual(dedupeKey(`${O}/List`), dedupeKey(`${O}/list`), '대소문자 유지');
  assert.equal(dedupeKey(`${O}/l?b=2&a=1#/x`), `${O}/l?a=1&b=2#/x`);
});

test('hashPath: #/a/b, #!/a/b → /a/b, 아니면 /', () => {
  assert.equal(hashPath(`${O}/app#/a/b`), '/a/b');
  assert.equal(hashPath(`${O}/app#!/a/b`), '/a/b');
  assert.equal(hashPath(`${O}/app#/a/b/`), '/a/b');
  assert.equal(hashPath(`${O}/app#/a?x=1`), '/a', '해시 안의 쿼리 제외');
  assert.equal(hashPath(`${O}/app#/`), '/');
  assert.equal(hashPath(`${O}/app#section`), '/');
  assert.equal(hashPath(`${O}/app`), '/');
  assert.equal(hashPath('bad url'), '/');
});

test('maskPath: 숫자, UUID, 날짜 세그먼트를 *로', () => {
  assert.equal(maskPath('/board/123'), '/board/*');
  assert.equal(maskPath('/doc/550e8400-e29b-41d4-a716-446655440000/edit'), '/doc/*/edit');
  assert.equal(maskPath('/doc/550E8400-E29B-41D4-A716-446655440000'), '/doc/*');
  assert.equal(maskPath('/report/2026-10-23'), '/report/*');
  assert.equal(maskPath('/v2/item12/abc'), '/v2/item12/abc', '섞인 세그먼트는 그대로');
  assert.equal(maskPath('/'), '/');
  assert.equal(maskPath(''), '');
});

test('aiCacheKey: 같은 패턴의 상세 페이지는 같은 키, 쿼리 무시, 해시 라우트별로 다른 키', () => {
  assert.equal(aiCacheKey('http://localhost:8787/notice/101'), 'http://localhost:8787/notice/*');
  assert.equal(aiCacheKey('http://localhost:8787/notice/101'), aiCacheKey('http://localhost:8787/notice/102'));
  assert.equal(aiCacheKey(`${O}/list?page=2&q=SECRET`), `${O}/list`);
  assert.equal(aiCacheKey(`${O}/list/`), `${O}/list`);
  assert.equal(aiCacheKey(`${O}/app#/inbox`), `${O}/app#/inbox`);
  assert.notEqual(aiCacheKey(`${O}/app#/inbox`), aiCacheKey(`${O}/app#/settings`));
  assert.equal(aiCacheKey(`${O}/app#!/mail/77`), `${O}/app#/mail/*`);
  assert.equal(aiCacheKey(`${O}/app#!/inbox`), aiCacheKey(`${O}/app#/inbox`));
  assert.equal(aiCacheKey(`${O}/app#section`), `${O}/app`, '앵커는 넣지 않는다');
  assert.equal(aiCacheKey(`${O}/`), `${O}/`);
  assert.equal(aiCacheKey('bad'), null);
});

test('maskPii / containsPii: 이메일·주민번호형·전화번호·6자리 이상 숫자', () => {
  assert.equal(maskPii('메일 hong.gd@corp.co.kr 로'), '메일 *** 로');
  assert.equal(maskPii('900101-1234567'), '***');
  assert.equal(maskPii('주민 900101 - 1234567'), '주민 ***');
  for (const p of ['010-1234-5678', '01012345678', '02-345-6789', '031)123-4567', '+82-10-9876-5432', '+82 2 345 6789', '010.1234.5678']) {
    assert.equal(maskPii(`전화 ${p} 끝`), '전화 *** 끝', p);
  }
  assert.equal(maskPii('사번 123456'), '사번 ***');
  assert.equal(maskPii('2026-10-23 수량 12345 v1.2.3'), '2026-10-23 수량 12345 v1.2.3', '날짜·5자리 숫자·버전은 그대로');
  assert.equal(maskPii(''), '');
  assert.equal(maskPii(undefined), '');
  assert.equal(containsPii('emp-1234567'), true);
  assert.equal(containsPii('a@b.io'), true);
  assert.equal(containsPii('btn-save-2026'), false);
  assert.equal(containsPii(null), false);
});

test('maskPath: 이메일(인코딩 포함)·개인정보가 든 세그먼트도 *', () => {
  assert.equal(maskPath('/users/hong.gildong@corp.com/profile'), '/users/*/profile');
  assert.equal(maskPath('/users/hong%40corp.com'), '/users/*');
  assert.equal(maskPath('/users/hong.gildong@corp'), '/users/*', 'TLD가 없어도 @가 있으면');
  assert.equal(maskPath('/tel/010-1234-5678'), '/tel/*');
  assert.equal(maskPath('/emp/emp1234567/edit'), '/emp/*/edit');
  assert.equal(maskPath('/v2/item12/abc'), '/v2/item12/abc');
  assert.equal(maskPath('/bad%E0%A4%A'), '/bad%E0%A4%A', '잘못된 인코딩도 예외 없이');
  assert.equal(aiCacheKey(`${O}/users/kim@corp.com/orders/1`), `${O}/users/*/orders/*`);
});

test('page-agent.js의 개인정보 블록(pii:begin~pii:end)이 matcher.js와 글자 그대로 같다', () => {
  const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
  const block = src => {
    const s = src.indexOf('// pii:begin');
    const e = src.indexOf('// pii:end');
    assert.ok(s >= 0 && e > s, 'pii 블록 표식이 없습니다');
    return src.slice(s, e).split('\n').map(l => l.trim());
  };
  const a = block(read('../src/shared/matcher.js'));
  const b = block(read('../src/content/page-agent.js'));
  assert.ok(a.length > 20);
  assert.deepEqual(b, a);
});

// QA r6 attack2.json(scratchpad scripts/attack2.json) 21+21종. 리더 결정과 충돌하는 두 기대값은 아래에 주석으로 바꿨다.
const BYPASS = [
  ['B01 전각 주민번호', '９００１０１－１２３４５６７', ['９００１０１', '１２３４５６７', '900101', '1234567']],
  ['B02 전각 전화', '０１０－１２３４－５６７８', ['１２３４－５６７８', '1234-5678']],
  ['B03 하이픈 앞뒤 공백 전화', '010 - 1234 - 5678', ['1234 - 5678', '1234']],
  ['B04 괄호 지역번호 전화', '(02) 123-4567', ['123-4567']],
  ['B05 밑줄 전화', '010_1234_5678', ['1234_5678']],
  ['B06 엔대시 전화', '010–1234–5678', ['1234–5678']],
  ['B07 ZWSP 전화', '010​1234​5678', ['1234​5678', '12345678']],
  ['B08 카드번호', '1234-5678-9012-3456', ['9012-3456']],
  ['B09 계좌번호', '123-45-67890', ['123-45-67890', '67890']],
  ['B10 전각 @ 이메일', 'hong＠corp.com', ['hong＠corp', 'hong@corp', 'hong']],
  ['B11 TLD 없는 이메일', 'hong@corp', ['hong@corp', 'hong']],
  ['B12 한글 도메인 이메일', '홍길동@회사.한국', ['홍길동@', '홍길동']],
  ['B13 공백 낀 이메일', 'hong @ corp.com', ['hong @ corp', 'hong']],
  ['B14 [at] 이메일', 'hong[at]corp.com', ['hong[at]corp', 'hong']],
  ['B15 +82 전화', '+82 10 1234 5678', ['1234 5678']],
  ['B16 마침표 주민번호', '900101.1234567', ['900101', '1234567']],
  ['B17 공백 주민번호', '900101 1234567', ['900101', '1234567']],
  ['B18 뒷자리 1자리+별표 주민번호', '900101-1******', ['900101']],
  ['B19 휴대폰 붙여쓰기', '01012345678', ['01012345678']],
  ['B20 유선 하이픈', '02-123-4567', ['123-4567']],
  ['B21 아랍-인도 숫자', '٩٠٠١٠١-١٢٣٤٥٦٧', ['٩٠٠١٠١', '900101']],
];
const KEEP = [
  ['F01 날짜 하이픈', '2026-10-23', '2026-10-23'],
  ['F02 날짜 점', '2026.10.23', '2026.10.23'],
  ['F03 날짜 한글', '2026년 10월 23일', '2026년 10월 23일'],
  ['F04 날짜 붙여쓰기', '기준일 20261023', '20261023'],
  ['F05 금액 쉼표', '1,234,567원', '1,234,567원'],
  ['F06 금액 쉼표 없음', '1234567원', '1234567원'],
  ['F07 금액 원화', '₩12,000', '₩12,000'],
  ['F09 문서번호', 'DOC-2026-0001', 'DOC-2026-0001'],
  ['F10 공문 번호', '제2026-123호', '제2026-123호'],
  ['F11 근무 시간', '09:00~18:00', '09:00~18:00'],
  ['F12 내선', '내선 1234', '내선 1234'],
  ['F13 버전', 'v1.2.3', 'v1.2.3'],
  ['F14 대표번호', '1588-1234', '1588-1234'],
  ['F15 최대 건수', '최대 100000건', '100000건'],
  ['F16 우편번호', '우편번호 06236', '06236'],
  ['F17 주문번호', '주문 1001', '주문 1001'],
  ['F18 기간', '2026-01-01 ~ 2026-12-31', '2026-01-01 ~ 2026-12-31'],
  ['F19 시각', '2026-10-23 14:30:00', '2026-10-23 14:30:00'],
  ['F20 용량', '최대 10485760바이트', '10485760'],
];

for (const [name, input, forbidden] of BYPASS) {
  test(`마스커 미탐 회귀 ${name}`, () => {
    const out = maskPii(`문의: ${input} 참고`);
    for (const f of forbidden) assert.ok(!out.includes(f), `${JSON.stringify(f)}가 남아 있습니다: ${JSON.stringify(out)}`);
    assert.ok(out.includes('***'), out);
    assert.equal(containsPii(input), true);
  });
}

for (const [name, input, kept] of KEEP) {
  test(`마스커 오탐 회귀 ${name}`, () => {
    const out = maskPii(input);
    assert.ok(out.includes(kept), `${JSON.stringify(kept)}가 지워졌습니다: ${JSON.stringify(out)}`);
    assert.ok(!out.includes('***'), out);
  });
}

test('마스커 리더 결정: 문서번호 속 6자리 이상 숫자와 계좌형(3묶음 이상·10자리 이상)은 마스킹', () => {
  // F08: QA 목록은 보존을 기대했지만 리더 결정("문서번호 속 긴 숫자는 계속 마스킹")을 따른다.
  assert.equal(maskPii('결재-2026-000123'), '결재-2026-***');
  // F21: B09와 같은 문자열이라 둘 다 만족할 수 없다. 계좌형 규칙(리더 결정)을 따른다.
  assert.equal(maskPii('예: 123-45-67890'), '예: ***');
});

test('마스커 단위·날짜 보존 경계', () => {
  for (const u of ['원', '건', '개', '명', '회', '일', '시간', '분', '초', '바이트', 'KB', 'MB', 'kb', '%']) {
    assert.equal(maskPii(`1234567${u}`), `1234567${u}`, u);
  }
  assert.equal(maskPii('1234567 원'), '1234567 원', '단위 앞 공백 한 칸은 허용(리더 결정 r7)');
  assert.equal(maskPii('1234567  원'), '***  원', '공백 두 칸은 단위로 보지 않는다');
  assert.equal(maskPii('20261332'), '***', '없는 날짜(13월)는 마스킹');
  assert.equal(maskPii('19991231'), '19991231');
  assert.equal(maskPii('사번 123456'), '사번 ***');
  assert.equal(maskPii('1234 5678 9012 3456'), '***', '공백 카드번호');
  assert.equal(maskPii('2026-10-23-1'), '2026-10-23-1', '날짜+일련번호(9자리)는 계좌형 아님');
});

// QA r7 attack2.json 추가분(B22~B41, K24~K38)과 리더 결정 r7 조정. B42(한글 숫자 전화)는 범위 밖(리더 결정).
const BYPASS_R7 = [
  ['B22 리더결정 결재번호', '결재-2026-000123', ['000123']],
  ['B23 리더결정 계좌형 예시', '예: 123-45-67890', ['67890']],
  ['B24 점 구분 카드', '1234.5678.9012.3456', ['9012.3456']],
  ['B25 공백 구분 카드', '1234 5678 9012 3456', ['9012 3456']],
  ['B26 공백 전화', '010 1234 5678', ['1234 5678']],
  ['B27 (at)(dot) 이메일', 'hong(at)corp(dot)com', ['hong']],
  ['B28 키릴 문자 이메일', 'hоng@corp.com', ['corp.com']],
  ['B29 수학 굵은 숫자 전화', '𝟎𝟏𝟎-𝟏𝟐𝟑𝟒-𝟓𝟔𝟕𝟖', ['𝟓𝟔𝟕𝟖', '5678']],
  ['B30 위첨자 숫자 주민', '⁹⁰⁰¹⁰¹-¹²³⁴⁵⁶⁷', ['⁴⁵⁶⁷', '4567']],
  ['B31 글자 사이 공백 주민', '9 0 0 1 0 1 - 1 2 3 4 5 6 7', ['5 6 7', '9 0 0']],
  ['B32 + 없는 82 전화', '82-10-1234-5678', ['1234-5678']],
  ['B33 +82 (0) 전화', '+82 (0)10-1234-5678', ['1234-5678']],
  ['B34 점·공백 전화', '010. 1234. 5678', ['1234. 5678']],
  ['B35 3-3-6 계좌', '110-123-456789', ['110-123']],
  ['B36 여권번호', 'M12345678', ['12345678']],
  ['B37 엔대시 주민', '900101–1234567', ['1234567']],
  ['B38 하이픈 앞뒤 공백 주민', '900101 - 1234567', ['1234567']],
  ['B39 유닛 위장 계좌', '110123456789원', ['110123456789']],
  ['B40 유닛 위장 휴대폰', '01012345678원', ['01012345678']],
  ['B41 공백 끼운 숫자열 계좌', '1101 2345 6789', ['6789']],
];
const KEEP_R7 = [
  ['K24 단위 앞 공백', '최대 100000 건', '100000 건'],
  ['K25 날짜 슬래시', '2026/10/23', '2026/10/23'],
  ['K26 날짜 범위', '2026-10-23 ~ 2026-10-31', '2026-10-31'],
  ['K27 IP 주소', '192.168.100.200', '192.168.100.200'],
  ['K28 대표번호2', '1544-1234', '1544-1234'],
  ['K29 회의실 @', '회의실 @ 3층', '회의실 @ 3층'],
  ['K30 멘션 안내', '@담당자 로 알림', '@담당자'],
  ['K31 소수 금리', '연 3.123456%', '3.123456%'],
  ['K32 퍼센트', '99.999999%', '99.999999%'],
  ['K33 표준번호', 'ISO 27001', 'ISO 27001'],
  ['K34 개정일 숫자', '개정 20261231', '20261231'],
  ['K35 시각 범위', '09:00-18:00', '09:00-18:00'],
  ['K36 날짜 점 공백', '2026. 10. 23.', '2026. 10. 23.'],
  ['K37 원문자', '① 신청 ② 승인', '신청'],
  ['K38 전각 괄호 안내', '（필수）항목', '필수'],
  ['F19 시각(혼합 구분자는 계좌형 아님)', '2026-10-23 14:30:00', '2026-10-23 14:30:00'],
  ['R7 교육 @ 장소', '교육 @ 3층 대회의실', '교육 @ 3층 대회의실'],
  ['R7 공백 날짜', '2026 10 23', '2026 10 23'],
];

for (const [name, input, forbidden] of BYPASS_R7) {
  test(`마스커 r7 미탐 회귀 ${name}`, () => {
    const out = maskPii(`안내 ${input} 끝`);
    for (const f of forbidden) assert.ok(!out.includes(f) && !out.includes(f.normalize('NFKC')), `${JSON.stringify(f)}가 남아 있습니다: ${JSON.stringify(out)}`);
    assert.ok(out.includes('***'), out);
  });
}

for (const [name, input, kept] of KEEP_R7) {
  test(`마스커 r7 오탐 회귀 ${name}`, () => {
    const out = maskPii(input);
    assert.ok(out.includes(kept), `${JSON.stringify(kept)}가 지워졌습니다: ${JSON.stringify(out)}`);
    assert.ok(!out.includes('***'), out);
  });
}

test('마스커 r7 리더 결정: 단위 예외는 9자리 이하, 공백 한 칸까지', () => {
  assert.equal(maskPii('123456789원'), '123456789원', '9자리는 보존');
  assert.equal(maskPii('1234567890원'), '***원', '10자리는 마스킹');
  assert.equal(maskPii('110123456789원'), '***원');
  assert.equal(maskPii('최대 100000 건'), '최대 100000 건');
  assert.equal(maskPii('최대 100000  건'), '최대 ***  건', '공백 두 칸은 단위로 보지 않는다');
  assert.equal(maskPii('1234567 KB'), '1234567 KB');
});

test('마스커 r7 리더 결정: " @ " 정규화는 양쪽이 이메일 모양일 때만', () => {
  assert.equal(maskPii('hong @ corp.com'), '***');
  assert.equal(maskPii('hong.gd @corp.co.kr 로 문의'), '*** 로 문의');
  assert.equal(maskPii('회의실 @ 3층'), '회의실 @ 3층');
  assert.equal(maskPii('가격 @ 1000원'), '가격 @ 1000원');
  assert.equal(maskPii('team @ meeting'), 'team @ meeting', '도메인에 점이 없으면 붙이지 않는다');
});

test('pii 블록 소스에 보이지 않는 문자·대시 원문자가 없다(이스케이프로만 표기)', () => {
  for (const p of ['../src/shared/matcher.js', '../src/content/page-agent.js']) {
    const src = readFileSync(new URL(p, import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('// pii:begin'), src.indexOf('// pii:end'));
    assert.doesNotMatch(block, /[­​-‏‐-–―⁠﻿]/, p);
  }
});
