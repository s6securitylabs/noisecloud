import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';

export const MAGIC = Buffer.from('S6NC1\n', 'ascii');
export const DEFAULT_KDF_ITERATIONS = 210000;

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

function b64(buf) {
  return Buffer.from(buf).toString('base64');
}

function unb64(value) {
  return Buffer.from(value, 'base64');
}

function deriveKey(passphrase, salt, iterations = DEFAULT_KDF_ITERATIONS) {
  if (!passphrase) throw new Error('passphrase required');
  return pbkdf2Sync(passphrase, salt, iterations, 32, 'sha256');
}

export function createEnvelope({ bytes, filename = 'payload.bin', mime = 'application/octet-stream', passphrase = '', metadata = {} }) {
  const input = Buffer.from(bytes);
  const plaintextSha256 = sha256Hex(input);
  let payload = input;
  const header = {
    magic: 'S6NC1',
    version: 1,
    createdAt: new Date().toISOString(),
    filename: String(filename || 'payload.bin').slice(0, 180),
    mime: String(mime || 'application/octet-stream').slice(0, 120),
    plaintextBytes: input.length,
    plaintextSha256,
    encrypted: Boolean(passphrase),
    cipher: null,
    kdf: null,
    metadata,
  };

  if (passphrase) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = deriveKey(passphrase, salt);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify({ magic: header.magic, version: header.version, plaintextSha256 }), 'utf8'));
    payload = Buffer.concat([cipher.update(input), cipher.final()]);
    header.cipher = { name: 'AES-256-GCM', iv: b64(iv), tag: b64(cipher.getAuthTag()) };
    header.kdf = { name: 'PBKDF2-SHA256', iterations: DEFAULT_KDF_ITERATIONS, salt: b64(salt) };
  }

  header.envelopePayloadBytes = payload.length;
  header.envelopePayloadSha256 = sha256Hex(payload);
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(headerBytes.length, 0);
  return Buffer.concat([MAGIC, len, headerBytes, payload]);
}

export function parseEnvelope(envelopeBytes, passphrase = '') {
  const data = Buffer.from(envelopeBytes);
  if (data.length < MAGIC.length + 4 || !data.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('not an S6NC1 envelope');
  }
  const headerLen = data.readUInt32BE(MAGIC.length);
  const headerStart = MAGIC.length + 4;
  const payloadStart = headerStart + headerLen;
  if (headerLen <= 0 || payloadStart > data.length) throw new Error('invalid S6NC1 header length');
  const header = JSON.parse(data.subarray(headerStart, payloadStart).toString('utf8'));
  let payload = data.subarray(payloadStart);
  if (sha256Hex(payload) !== header.envelopePayloadSha256) throw new Error('S6NC1 envelope payload SHA-256 mismatch');

  let plaintext;
  if (header.encrypted) {
    if (!passphrase) throw new Error('passphrase required for encrypted S6NC1 envelope');
    const key = deriveKey(passphrase, unb64(header.kdf.salt), header.kdf.iterations);
    const decipher = createDecipheriv('aes-256-gcm', key, unb64(header.cipher.iv));
    decipher.setAAD(Buffer.from(JSON.stringify({ magic: header.magic, version: header.version, plaintextSha256: header.plaintextSha256 }), 'utf8'));
    decipher.setAuthTag(unb64(header.cipher.tag));
    plaintext = Buffer.concat([decipher.update(payload), decipher.final()]);
  } else {
    plaintext = Buffer.from(payload);
  }

  const recoveredSha256 = sha256Hex(plaintext);
  const verified = recoveredSha256 === header.plaintextSha256 && plaintext.length === header.plaintextBytes;
  if (!verified) throw new Error('S6NC1 plaintext verification failed');
  return { header, plaintext, verified, recoveredSha256 };
}
