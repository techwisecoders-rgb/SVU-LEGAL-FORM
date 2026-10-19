import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword, hmacSha256, randomToken, safeEqual, tokenHash, verifyPassword} from './security.js';

test('password hashes are salted and verify correctly', async () => {
  const first = await hashPassword('Strong-demo-password-239!');
  const second = await hashPassword('Strong-demo-password-239!');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('Strong-demo-password-239!', first), true);
  assert.equal(await verifyPassword('wrong-password', first), false);
});

test('opaque tokens hash deterministically without exposing the token', () => {
  const token = randomToken();
  assert.ok(token.length >= 40);
  assert.notEqual(tokenHash(token), token);
  assert.equal(tokenHash(token), tokenHash(token));
});

test('constant-time equality rejects unequal values and HMAC output is stable', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(hmacSha256('secret', 'body'), hmacSha256('secret', 'body'));
  assert.equal(hmacSha256('secret', 'body') === hmacSha256('secret', 'other'), false);
});
