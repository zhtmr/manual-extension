import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MSG } from '../src/shared/messages.js';

const agentSrc = readFileSync(new URL('../src/content/page-agent.js', import.meta.url), 'utf8');
const messagesSrc = readFileSync(new URL('../src/shared/messages.js', import.meta.url), 'utf8');

// validate_extension.mjs와 같은 방식으로 `KEY: 'VALUE'` 항목을 읽는다.
const parseConsts = src => Object.fromEntries(
  [...src.matchAll(/\b([A-Z][A-Z_]*)\s*:\s*['"]([A-Za-z_]+)['"]/g)].map(m => [m[1], m[2]]),
);

test('MSG는 얼어 있고 모든 키의 값이 키와 같다', () => {
  assert.ok(Object.isFrozen(MSG));
  assert.ok(Object.keys(MSG).length > 0);
  for (const [k, v] of Object.entries(MSG)) assert.equal(v, k);
});

test('MSG는 설계 문서 ④의 메시지 집합과 같다', () => {
  assert.deepEqual(Object.keys(MSG).sort(), [
    'CLEAR_HIGHLIGHT', 'EXTRACT_PAGE', 'GET_CURRENT_MANUAL', 'HIGHLIGHT',
    'MANUAL_UPDATED', 'REFRESH_MANUAL', 'REGENERATE_MANUAL',
  ]);
});

test('messages.js에는 MSG 외의 대문자 상수 항목이 없다', () => {
  assert.deepEqual(parseConsts(messagesSrc), { ...MSG });
});

test('page-agent.js에 sync 주석과 MSG 복사본이 있고 messages.js와 같다', () => {
  const at = agentSrc.indexOf('// sync: src/shared/messages.js');
  assert.ok(at >= 0, 'sync 주석이 없습니다');
  const block = agentSrc.slice(at).match(/Object\.freeze\(\{([\s\S]*?)\}\)/);
  assert.ok(block, 'sync 주석 뒤에 Object.freeze({...}) 복사본이 없습니다');
  assert.deepEqual(parseConsts(block[1]), { ...MSG });
  // 파일 전체에서도 복사본 외의 대문자 키 문자열 항목이 없어야 한다(검사기가 복사본으로 읽는다).
  assert.deepEqual(parseConsts(agentSrc), { ...MSG });
});

test('page-agent.js는 IIFE + 중복 주입 플래그로 감싸져 있고 .value를 쓰지 않는다', () => {
  assert.match(agentSrc, /window\.__pageManualAgentLoaded/);
  assert.match(agentSrc.trim(), /^(\/\/[^\n]*\n)*\(\(\) => \{[\s\S]*\}\)\(\);$/);
  assert.doesNotMatch(agentSrc, /\.value\b/);
  assert.doesNotMatch(agentSrc, /^\s*(import|export)\s/m);
});
