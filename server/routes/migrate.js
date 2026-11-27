'use strict';

/**
 * 知行 · 迁移与维护路由
 *  - 旧「复盘 · Edge」数据（data/notes.json + uploads）无损迁入
 *  - 快照列表 / 手动快照 / 恢复 / 删除
 *  - 存储占用、清理（回收站 + 无引用媒体 + 快照轮转）
 * 契约见 docs/API.md 第 5、6 节。
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const store = require('../store');
const N = require('../models/notes');
const { sendJson, sendError, readBody, cleanText, logError } = require('../util');

const INSPIRATION_DIR = process.env.ZHIXING_INSPIRATION
  ? path.resolve(process.env.ZHIXING_INSPIRATION)
  : path.resolve(config.ROOT, '..', 'inspiration');
const INSPIRATION_DATA = path.join(INSPIRATION_DIR, 'data');
const INSPIRATION_DB = path.join(INSPIRATION_DATA, 'notes.json');
const INSPIRATION_UPLOADS = path.join(INSPIRATION_DATA, 'uploads');

function countFiles(dir) {
  let files = 0;
  let bytes = 0;
  const walk = (d) => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const ent of list) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else {
        files += 1;
        try { bytes += fs.statSync(full).size; } catch (_) { /* 忽略 */ }
      }
    }
  };
  walk(dir);
  return { files, bytes };
}

function readInspirationNotes() {
  if (!fs.existsSync(INSPIRATION_DB)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(INSPIRATION_DB, 'utf8'));
    return Array.isArray(raw) ? raw : raw.notes || [];
  } catch (err) {
    logError('migrate-inspiration', err);
    return null;
  }
}

function existingKeys() {
  const set = new Set();
  for (const n of store.db.notes) set.add(N.keyOf(n));
  return set;
}

/** 把旧程序的 /media/<相对路径> 文件复制到新程序的 data/media 下 */
function copyMedia(images, dryRun) {
  let copied = 0;
  const rels = new Set();
  for (const img of images || []) {
    const url = String(img && img.url || '');
    const m = url.match(/^\/media\/(.+)$/);
    if (!m) continue;
    const rel = m[1].split('?')[0];
    if (rel.includes('..')) continue;
    rels.add(rel);
  }
  for (const rel of rels) {
    const src = path.join(INSPIRATION_UPLOADS, rel);
    const dest = path.join(config.MEDIA_DIR, rel);
    if (!fs.existsSync(src)) continue;
    if (!dryRun) {
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
      } catch (err) { logError('migrate-media', err); }
    }
    copied += 1;
  }
  return copied;
}

async function migrateInspiration(res, dryRun) {
  const rawNotes = readInspirationNotes();
  if (!rawNotes) return sendError(res, 404, '没找到旧程序的数据文件（inspiration/data/notes.json）');
  const known = existingKeys();
  const fresh = [];
  let duplicates = 0;
  let empty = 0;
  const images = [];
  const invalids = [];

  for (const raw of rawNotes) {
    let note;
    try {
      note = N.normalizeNote(raw, Date.now());
    } catch (err) {
      invalids.push(String(raw && raw.seq || '?'));
      continue;
    }
    if (!note) continue;
    if (!(note.content && /[^\s<]/.test(note.content.replace(/<[^>]*>/g, ''))) && !(note.images || []).length && !note.think && !note.seen) {
      empty += 1;
      continue;
    }
    const key = N.keyOf(note);
    if (known.has(key)) { duplicates += 1; continue; }
    known.add(key);
    fresh.push(note);
    for (const img of note.images || []) images.push(img);
  }

  if (!dryRun && fresh.length) {
    store.createSnapshot('pre-migrate');
    const added = [];
    for (const note of fresh) {
      note.seq = store.db.meta.nextSeq;
      store.db.meta.nextSeq += 1;
      store.db.notes.push(note);
      added.push(note);
    }
    const copied = copyMedia(images, dryRun);
    if (!(await store.commit(res, () => {
      store.db.meta.nextSeq -= added.length;
      store.db.notes = store.db.notes.filter((n) => !added.includes(n));
    }))) return true;
    return sendJson(res, 200, {
      ok: true, dryRun, notes: rawNotes.length, imported: fresh.length,
      images: copied, duplicates, totalAfter: store.db.notes.length,
    }), true;
  }

  const copied = dryRun ? copyMedia(images, true) : 0;
  return sendJson(res, 200, {
    ok: true, dryRun, notes: rawNotes.length, imported: fresh.length,
    images: copied, duplicates, empty, invalids,
    totalAfter: dryRun ? store.db.notes.length + fresh.length : store.db.notes.length,
  }), true;
}

async function handle(req, res, pathname, query) {
  if (pathname === '/api/migrate/inspect' && req.method === 'GET') {
    const notes = readInspirationNotes();
    const media = fs.existsSync(INSPIRATION_UPLOADS) ? countFiles(INSPIRATION_UPLOADS) : { files: 0, bytes: 0 };
    let lastModified = 0;
    try { lastModified = fs.statSync(INSPIRATION_DB).mtimeMs; } catch (_) { /* 没有就没有 */ }
    return sendJson(res, 200, {
      ok: true,
      inspiration: {
        found: notes != null,
        path: INSPIRATION_DIR,
        notes: notes ? notes.length : 0,
        mediaFiles: media.files,
        lastModified,
      },
      studioLog: {
        found: false,
        hint: '旧程序 Studio Log 的数据存在浏览器 IndexedDB 里。请在旧程序里打开「设置 → 数据安全 → 导出 JSON」，再到本页导入即可。',
      },
      target: { notes: store.db.notes.length, media: countFiles(config.MEDIA_DIR).files },
    }), true;
  }

  if (pathname === '/api/migrate/inspiration' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { sendError(res, 400, e.message); return true; }
    return migrateInspiration(res, body.dryRun !== false);
  }

  if (pathname === '/api/snapshots' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, snapshots: store.listSnapshots(), keep: config.SNAPSHOT_INTERVAL_KEEP }), true;
  }

  if (pathname === '/api/snapshots' && req.method === 'POST') {
    let body = {};
    try { body = await readBody(req); } catch (e) { sendError(res, 400, e.message); return true; }
    const reason = cleanText(body.reason, 40).replace(/[\s/\\]+/g, '-');
    const snapshot = store.createSnapshot(reason ? `manual-${reason}` : 'manual');
    if (!snapshot) return sendError(res, 500, '快照没能写进磁盘，请检查磁盘空间');
    return sendJson(res, 201, { ok: true, snapshot: { ...snapshot, reason: reason || 'manual' } }), true;
  }

  const snapRestore = pathname.match(/^\/api\/snapshots\/([^/]+)\/restore$/);
  if (snapRestore && req.method === 'POST') {
    const name = decodeURIComponent(snapRestore[1]);
    const result = await store.restoreSnapshot(name);
    if (!result.ok) return sendError(res, String(result.error).includes('磁盘') ? 503 : 404, result.error);
    return sendJson(res, 200, { ok: true, ...result }), true;
  }

  const snapItem = pathname.match(/^\/api\/snapshots\/([^/]+)$/);
  if (snapItem && req.method === 'DELETE') {
    const name = decodeURIComponent(snapItem[1]);
    const done = await store.deleteSnapshot(name);
    if (!done) return sendError(res, 404, '快照不存在');
    return sendJson(res, 200, { ok: true, deleted: name }), true;
  }

  if (pathname === '/api/storage' && req.method === 'GET') {
    const info = await store.storageInfo();
    let diskFree = null;
    try {
      const st = fs.statfsSync(config.DATA_DIR);
      diskFree = st.bavail * st.bsize;
    } catch (_) { /* 平台不支持就留空 */ }
    return sendJson(res, 200, {
      ok: true,
      ...info,
      diskFree,
      quotaHint: diskFree != null && diskFree < 200 * 1024 * 1024
        ? '磁盘剩余不足 200MB，建议先导出一份备份再继续。'
        : '数据都在本机，记得定期导出一份备份（设置 → 数据安全）。',
      settings: {
        snapshotHours: store.db.settings.snapshotHours,
        attachmentLimitMB: store.db.settings.attachmentLimitMB,
      },
      lastSavedAt: store.db.savedAt || 0,
    }), true;
  }

  if (pathname === '/api/cleanup' && req.method === 'POST') {
    const result = await store.cleanup();
    if (store.lastWriteError) return sendError(res, 503, '清理完成，但结果没能写进磁盘', { cleanup: result });
    return sendJson(res, 200, { ok: true, ...result }), true;
  }

  return false;
}

module.exports = { handle, INSPIRATION_DIR };