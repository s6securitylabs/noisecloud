import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnvelope, parseEnvelope, sha256Hex } from './envelope.mjs';

test('S6NC1 envelope round-trips plaintext with integrity metadata', () => {
  const input = Buffer.from('S6 DLP canary');
  const env = createEnvelope({ bytes: input, filename: 'canary.txt', mime: 'text/plain' });
  const out = parseEnvelope(env);
  assert.equal(out.verified, true);
  assert.equal(out.plaintext.toString(), 'S6 DLP canary');
  assert.equal(out.header.filename, 'canary.txt');
  assert.equal(out.header.plaintextSha256, sha256Hex(input));
  assert.equal(out.header.encrypted, false);
});

test('S6NC1 envelope supports AES-GCM passphrase encryption', () => {
  const input = Buffer.from('secret-ish lab canary');
  const env = createEnvelope({ bytes: input, filename: 'secret.txt', passphrase: 'correct horse battery staple' });
  assert.equal(env.includes(input), false);
  const out = parseEnvelope(env, 'correct horse battery staple');
  assert.equal(out.verified, true);
  assert.equal(out.plaintext.toString(), input.toString());
  assert.equal(out.header.encrypted, true);
  assert.equal(out.header.cipher.name, 'AES-256-GCM');
});

test('S6NC1 encrypted envelope rejects wrong passphrase', () => {
  const env = createEnvelope({ bytes: Buffer.from('payload'), passphrase: 'right' });
  assert.throws(() => parseEnvelope(env, 'wrong'));
});

test('S6NC1 envelope detects tampering', () => {
  const env = createEnvelope({ bytes: Buffer.from('payload') });
  env[env.length - 1] ^= 0xff;
  assert.throws(() => parseEnvelope(env), /SHA-256 mismatch|verification failed/);
});
