'use strict';
/**
 * 图片存取 —— 只认 png / jpg / webp / gif，靠文件头字节判断，不信任前端给的扩展名。
 * 落盘位置：data/uploads/YYYY-MM/<sha1 前 20 位>.<ext>
 * 同内容的图只存一份（内容寻址），删便签时再回收没人引用的文件。
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const MAX_IMAGE = 8 * 1024 * 1024;   // 单张 8MB（前端会先压缩，正常 100~300KB）

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

function sniffExt(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 4).toString('ascii') === 'GIF8') return 'gif';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

const monthDir = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * @param {string} uploadsDir
 * @param {Buffer} buf
 * @returns {Promise<string>} 形如 /2026-11/ab12cd34.webp 的相对路径
 */
async function saveImage(uploadsDir, buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new Error('图片内容为空');
  if (buf.length > MAX_IMAGE) throw new Error(`图片超过 ${MAX_IMAGE / 1024 / 1024}MB`);
  const ext = sniffExt(buf);
  if (!ext) throw new Error('只支持 png / jpg / webp / gif');

  const dir = monthDir();
  const name = `${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20)}.${ext}`;
  const rel = `${dir}/${name}`;
  const abs = path.join(uploadsDir, dir, name);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  // 内容寻址：同图已存在就不用重写
  try {
    await fsp.access(abs);
  } catch (_) {
    await fsp.writeFile(abs, buf);
  }
  return rel;
}

/** 把 md 里的 data:image/...;base64,xxx 解出来 */
function parseDataUri(uri) {
  const m = /^data:(image\/[a-z+]+);base64,([\s\S]+)$/i.exec(uri.trim());
  if (!m) return null;
  return Buffer.from(m[2].replace(/\s/g, ''), 'base64');
}

/** 读回来（导出内嵌 base64 用），失败返回 null */
async function readImage(uploadsDir, url) {
  const rel = String(url || '').replace(/^\/media\//, '');
  if (!rel || rel.includes('..')) return null;
  try {
    return await fsp.readFile(path.join(uploadsDir, rel));
  } catch (_) {
    return null;
  }
}

/** 导出流程是同步拼字符串，这里给一个同步读取（带小缓存） */
const cache = new Map();
function readImageSync(uploadsDir, url) {
  const rel = String(url || '').replace(/^\/media\//, '');
  if (!rel || rel.includes('..')) return null;
  if (cache.has(rel)) return cache.get(rel);
  let buf = null;
  try {
    buf = fs.readFileSync(path.join(uploadsDir, rel));
  } catch (_) {
    buf = null;
  }
  if (cache.size > 200) cache.clear();
  cache.set(rel, buf);
  return buf;
}

const existsSync = (uploadsDir, url) => Boolean(readImageSync(uploadsDir, url));

const toDataUri = (buf, ext) => `data:${MIME[ext] || 'image/webp'};base64,${buf.toString('base64')}`;

const extOf = (url) => path.extname(String(url || '')).slice(1).toLowerCase();

/** 删图：只删没有便签再引用的文件 */
async function gcImages(uploadsDir, urls, stillUsed) {
  for (const url of new Set(urls)) {
    if (!url || stillUsed.has(url)) continue;
    const rel = String(url).replace(/^\/media\//, '');
    if (!rel || rel.includes('..')) continue;
    await fsp.unlink(path.join(uploadsDir, rel)).catch(() => {});
  }
}

module.exports = {
  MAX_IMAGE,
  MIME,
  sniffExt,
  saveImage,
  readImage,
  readImageSync,
  existsSync,
  parseDataUri,
  toDataUri,
  extOf,
  gcImages,
  monthDir,
};
