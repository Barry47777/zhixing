'use strict';

/**
 * 知行 · 服务端通用工具：文本清洗、数字规约、HTTP 响应、静态/媒体服务。
 * 零第三方依赖。
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const cleanText = (v, max = 8000) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max);

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

/** 数字规约：空 / 非有限 / 越界 → null */
function numOrNull(v, { min = -1e12, max = 1e12, digits = 2 } = {}) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** R 倍数：盈亏 ÷ 单笔风险；risk 必须为正，结果钳制 ±100 */
function computeR(pnl, risk) {
  if (typeof pnl !== 'number' || !Number.isFinite(pnl)) return null;
  if (typeof risk !== 'number' || !Number.isFinite(risk) || risk <= 0) return null;
  const r = pnl / risk;
  if (!Number.isFinite(r)) return null;
  return round2(Math.max(-100, Math.min(100, r)));
}

const pad2 = (n) => String(n).padStart(2, '0');

/** 本地日期 YYYY-MM-DD（与日历归属一致，不用 UTC） */
function dayKey(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}

function dayStart(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) return null;
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function daysBetween(a, b) {
  const ms = Math.abs((dayStart(b) || 0) - (dayStart(a) || 0));
  return Math.round(ms / 864e5);
}

/** 追加一条本机错误日志；日志自身失败不抛 */
function logError(scope, err) {
  const line = `${new Date().toISOString()} [${scope}] ${err && err.stack ? err.stack : err}\n`;
  try {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
    fs.appendFileSync(config.ERROR_LOG, line, 'utf8');
  } catch (_) { /* 忽略 */ }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf8'),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendError(res, status, message, extra) {
  return sendJson(res, status, { ok: false, error: message, ...(extra || {}) });
}

/** 读 JSON 请求体，限制字节数 */
function readBody(req, limit = config.MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体太大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        const v = JSON.parse(raw);
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('请求体必须是 JSON 对象');
        resolve(v);
      } catch (e) {
        reject(new Error(`JSON 解析失败：${e.message}`));
      }
    });
    req.on('error', reject);
  });
}

function sendDownload(res, { filename, type, body, extraHeaders = {} }) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(buf);
}

/** 静态文件：dist 优先，其次 public；只允许两个根下的路径 */
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = rel.replace(/\/+$/, '') || '/index.html';
  if (rel.includes('..')) return sendError(res, 400, 'bad path');
  const roots = [config.DIST_DIR, config.PUBLIC_DIR];
  for (const root of roots) {
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) continue;
    try {
      const stat = fs.statSync(file);
      if (stat.isFile()) return sendFile(req, res, file, stat, false);
      // 目录：尝试 index.html
      const index = path.join(file, 'index.html');
      if (fs.existsSync(index)) {
        const s2 = fs.statSync(index);
        return sendFile(req, res, index, s2, false);
      }
    } catch (_) { /* 尝试下一个根 */ }
  }
  // SPA 回退：任何未命中的非资源路径回 index.html
  const fallback = path.join(config.DIST_DIR, 'index.html');
  if (fs.existsSync(fallback)) {
    const s = fs.statSync(fallback);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': s.size, 'Cache-Control': 'no-store' });
    fs.createReadStream(fallback).pipe(res);
    return;
  }
  return sendError(res, 404, 'not found');
}

function sendFile(req, res, file, stat, immutable) {
  const ext = path.extname(file).toLowerCase();
  const type = config.MIME[ext] || 'application/octet-stream';
  const etag = `W/"${stat.size}-${Math.round(stat.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    return res.end();
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
}

/** /media/<rel> → data/media/<rel>，防路径穿越 */
function serveMedia(req, res, pathname) {
  const rel = decodeURIComponent(pathname.replace(/^\/media\//, ''));
  if (!rel || rel.includes('..') || rel.includes('\\')) return sendError(res, 400, 'bad path');
  const file = path.join(config.MEDIA_DIR, rel);
  if (!file.startsWith(config.MEDIA_DIR + path.sep)) return sendError(res, 400, 'bad path');
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return sendError(res, 404, 'not found');
    return sendFile(req, res, file, stat, true);
  } catch (_) {
    return sendError(res, 404, 'not found');
  }
}

/** 在内存对象上做「可回滚」修改：返回 restore */
function snapshotObject(target) {
  const before = structuredClone(target);
  const keys = new Set(Object.keys(target));
  return function restore() {
    for (const k of Object.keys(target)) if (!(k in before)) delete target[k];
    Object.assign(target, structuredClone(before));
    return keys;
  };
}

module.exports = {
  cleanText,
  round1,
  round2,
  numOrNull,
  computeR,
  dayKey,
  dayStart,
  daysBetween,
  logError,
  sendJson,
  sendError,
  readBody,
  sendDownload,
  serveStatic,
  serveMedia,
  sendFile,
  snapshotObject,
};