import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createEnvelope, parseEnvelope, sha256Hex } from './envelope.mjs';

const workRoot = process.env.S6NC_WORKDIR || '/work';
const maxUploadBytes = Number(process.env.S6NC_MAX_UPLOAD_BYTES || 2 * 1024 * 1024);
const maxVideoBytes = Number(process.env.S6NC_MAX_VIDEO_BYTES || 50 * 1024 * 1024);
mkdirSync(workRoot, { recursive: true });

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}
function json(res, status, body) {
  send(res, status, JSON.stringify(body, null, 2) + '\n', { 'Content-Type': 'application/json; charset=utf-8' });
}
function sanitizeFilename(name, fallback = 'payload.bin') {
  const clean = String(name || fallback).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return clean || fallback;
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > limit) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function parseMultipart(req, body) {
  const contentType = req.headers['content-type'] || '';
  const match = /boundary=(?:(?:"([^"]+)")|([^;]+))/i.exec(contentType);
  if (!match) throw Object.assign(new Error('multipart boundary missing'), { status: 400 });
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const parts = [];
  let offset = 0;
  while (true) {
    const start = body.indexOf(boundary, offset);
    if (start < 0) break;
    const next = body.indexOf(boundary, start + boundary.length);
    if (next < 0) break;
    let part = body.subarray(start + boundary.length, next);
    if (part.subarray(0, 2).toString() === '--') break;
    if (part.subarray(0, 2).toString() === '\r\n') part = part.subarray(2);
    if (part.subarray(part.length - 2).toString() === '\r\n') part = part.subarray(0, part.length - 2);
    const sep = part.indexOf(Buffer.from('\r\n\r\n'));
    if (sep >= 0) {
      const rawHeaders = part.subarray(0, sep).toString('utf8');
      const data = part.subarray(sep + 4);
      const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(rawHeaders)?.[1] || '';
      const name = /name="([^"]+)"/i.exec(disposition)?.[1] || '';
      const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] || '';
      const type = /content-type:\s*([^\r\n]+)/i.exec(rawHeaders)?.[1]?.trim() || 'application/octet-stream';
      parts.push({ name, filename, type, data });
    }
    offset = next;
  }
  return parts;
}
function field(parts, name) {
  return parts.find(p => p.name === name)?.data.toString('utf8') || '';
}
function filePart(parts) {
  return parts.find(p => p.name === 'file' && p.data.length);
}
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: opts.input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Object.assign(new Error(`${cmd} timed out`), { status: 504, stdout, stderr }));
    }, opts.timeoutMs || 180000);
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`${cmd} exited ${code}`), { status: 500, stdout, stderr }));
    });
    if (opts.input) child.stdin.end(opts.input);
  });
}
async function runNccEncode(input, output, cwd) {
  await run('/usr/local/bin/ncc', [], { cwd, input: `1\n${input}\n${output}\n\n5\n`, timeoutMs: 240000 });
}
async function runNccDecode(input, output, cwd) {
  await run('/usr/local/bin/ncc', [], { cwd, input: `3\n${input}\n${output}\n\n5\n`, timeoutMs: 240000 });
}
async function videoDuration(file) {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', file], { timeoutMs: 30000 });
    const n = Number(stdout.trim());
    return Number.isFinite(n) && n > 0 ? Math.min(Math.max(n, 1), 300) : 10;
  } catch {
    return 10;
  }
}
async function makeSlideshowSideband(carrier, output, cwd) {
  const duration = await videoDuration(carrier);
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=30:duration=${duration}`,
    '-i', carrier,
    '-filter_complex', '[1:v]scale=640:360[carrier];[0:v][carrier]hstack=inputs=2[v]',
    '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
  ], { cwd, timeoutMs: 240000 });
}
async function extractSideband(input, output, cwd) {
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-vf', 'crop=iw/2:ih:iw/2:0,scale=640:360', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', output,
  ], { cwd, timeoutMs: 180000 });
}
async function encode(req, res) {
  const body = await readBody(req, maxUploadBytes + 1024 * 1024);
  const parts = parseMultipart(req, body);
  const file = filePart(parts);
  if (!file) return json(res, 400, { ok: false, error: 'file field required' });
  if (file.data.length > maxUploadBytes) return json(res, 413, { ok: false, error: `file limit is ${maxUploadBytes} bytes` });
  const passphrase = field(parts, 'passphrase');
  const coverMode = field(parts, 'coverMode') || 'noise';
  const id = randomUUID();
  const dir = path.join(workRoot, id);
  mkdirSync(dir, { recursive: true });
  try {
    const inputName = sanitizeFilename(file.filename, 'payload.bin');
    const envelope = createEnvelope({ bytes: file.data, filename: inputName, mime: file.type, passphrase, metadata: { tool: 'S6 NoiseCloud Next', coverMode } });
    const envelopePath = path.join(dir, `${inputName}.s6nc1`);
    const carrierPath = path.join(dir, `${inputName}.carrier.mp4`);
    const finalPath = path.join(dir, `${inputName}.s6nc-v2.mp4`);
    writeFileSync(envelopePath, envelope);
    await runNccEncode(envelopePath, carrierPath, dir);
    if (coverMode === 'slideshow-sideband') await makeSlideshowSideband(carrierPath, finalPath, dir);
    else writeFileSync(finalPath, readFileSync(carrierPath));
    const mp4 = readFileSync(finalPath);
    if (mp4.length > maxVideoBytes) return json(res, 413, { ok: false, error: `generated MP4 exceeds ${maxVideoBytes} byte download limit`, outputBytes: mp4.length });
    const meta = { ok: true, version: 'S6NC1', encrypted: Boolean(passphrase), coverMode, inputName, inputBytes: file.data.length, inputSha256: sha256Hex(file.data), envelopeBytes: envelope.length, outputBytes: mp4.length, outputSha256: sha256Hex(mp4) };
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${inputName}.s6nc-v2.mp4"`,
      'Cache-Control': 'no-store',
      'X-S6NC-Meta': Buffer.from(JSON.stringify(meta)).toString('base64url'),
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(mp4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
async function decode(req, res) {
  const body = await readBody(req, maxVideoBytes + 1024 * 1024);
  const parts = parseMultipart(req, body);
  const file = filePart(parts);
  if (!file) return json(res, 400, { ok: false, error: 'file field required' });
  if (file.data.length > maxVideoBytes) return json(res, 413, { ok: false, error: `video limit is ${maxVideoBytes} bytes` });
  const passphrase = field(parts, 'passphrase');
  const coverMode = field(parts, 'coverMode') || 'auto';
  const id = randomUUID();
  const dir = path.join(workRoot, id);
  mkdirSync(dir, { recursive: true });
  try {
    const uploadPath = path.join(dir, 'upload.mp4');
    const carrierPath = path.join(dir, 'carrier.mp4');
    const envelopePath = path.join(dir, 'recovered.s6nc1');
    writeFileSync(uploadPath, file.data);
    let decodePath = uploadPath;
    if (coverMode === 'slideshow-sideband' || coverMode === 'auto') {
      try {
        await extractSideband(uploadPath, carrierPath, dir);
        decodePath = carrierPath;
      } catch {
        if (coverMode === 'slideshow-sideband') throw new Error('failed to extract slideshow sideband');
      }
    }
    await runNccDecode(decodePath, envelopePath, dir);
    if (!existsSync(envelopePath)) throw Object.assign(new Error('NoiseCloud did not recover an S6NC1 envelope'), { status: 422 });
    const parsed = parseEnvelope(readFileSync(envelopePath), passphrase);
    const filename = sanitizeFilename(parsed.header.filename, 's6nc-recovered.bin');
    res.writeHead(200, {
      'Content-Type': parsed.header.mime || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-S6NC-Verified': String(parsed.verified),
      'X-S6NC-Filename': encodeURIComponent(filename),
      'X-S6NC-Plaintext-SHA256': parsed.header.plaintextSha256,
      'X-S6NC-Recovered-Bytes': String(parsed.plaintext.length),
      'X-S6NC-Encrypted': String(Boolean(parsed.header.encrypted)),
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(parsed.plaintext);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  try {
    if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/api/noisecloud-v2/healthz')) return json(res, 200, { ok: true, service: 's6-noisecloud-next', version: 'S6NC1' });
    if (req.method === 'POST' && url.pathname === '/api/noisecloud-v2/encode') return await encode(req, res);
    if (req.method === 'POST' && url.pathname === '/api/noisecloud-v2/decode') return await decode(req, res);
    return json(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    return json(res, err.status || 500, { ok: false, error: err.message, stdout: err.stdout?.slice(-1600), stderr: err.stderr?.slice(-1600) });
  }
});
server.listen(8080, '0.0.0.0', () => console.log('S6 NoiseCloud Next lab listening on 8080'));
