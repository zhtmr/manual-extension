import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidOrigin } from '../src/shared/settings.js';

test('isValidOrigin: https?://host[:port] 형식만', () => {
  for (const ok of ['https://gw.example.com', 'http://localhost:8787', 'http://10.0.0.5:8080', 'https://a.b', 'http://[::1]:8787']) {
    assert.equal(isValidOrigin(ok), true, ok);
  }
  for (const bad of [
    'https://gw.example.com/', 'https://gw.example.com/path', 'gw.example.com', 'ftp://gw.example.com',
    'https://user@gw.example.com', 'https://gw.example.com?x=1', 'https://gw.example.com#a', 'https://',
    'https://GW.example.com', 'http://localhost:80', ' https://gw.example.com', '', null, 42, undefined,
  ]) {
    assert.equal(isValidOrigin(bad), false, String(bad));
  }
});
