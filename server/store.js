'use strict';

/**
 * 知行 · 存储层
 *
 * 单一真源：一份 workspace.json（内存一份 + 整份原子覆盖写）。
 * 安全协议（从 inspiration 移植）：
 *   1) 写前把现有文件复制成 workspace.bak.json；
 *   2) 写 workspace.json.<pid>.tmp → fsync → rename（原子）；
 *   3) 所有写串行（writeChain），失败记 lastWriteError 并允许调用方回滚内存；
 *   4) 读失败回退 bak；启动时把陌生字段原样留证到 pre-upgrade/。
 * 另外：每日启动快照保留 5 份；按设置的小时间隔快照保留 24 份；回收站 30 天。
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const config = require('./config');
const { logError, dayKey } = require('./util');
const richtext = require('./lib/richtext');
const N = require('./models/notes');
const W = require('./models/work');

const KNOWN_KEYS = new Set([
  'version', 'savedAt', 'createdAt', 'meta', 'notes', 'projects', 'entries',
  'days', 'templates', 'attachments', 'settings',
]);

function blankWorkspace() {
  return {
    version: config.DB_VERSION,
    savedAt: 0,
    createdAt: Date.now(),
    meta: { nextSeq: 1, demoAt: 0, clearedAt: 0, lastSnapshotAt: 0, lastIntervalAt: 0 },
    notes: [],
    projects: [],
    entries: [],
    days: [],
    templates: [],
    attachments: [],
    settings: W.normalizeSettings({}),
  };
}

let db = blankWorkspace();
let writeChain = Promise.resolve();
let lastWriteError = null;
let booted = false;

const state = {
  get db() { return db; },
  get lastWriteError() { return lastWriteError; },
};

/* ------------------------------------------------------------ 目录与日志 */

function ensureDirs() {
  for (const dir of [config.DATA_DIR, config.MEDIA_DIR, config.SNAPSHOT_DIR, config.PRE_UPGRADE_DIR]) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* 忽略 */ }
  }
}

function safeName(s) {
  return String(s || 'snapshot').replace(/[^\w.-]+/g, '-').slice(0, 60);
}

/* ---------------------------------------------------------------- 快照 */

function listFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((name) => {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      return { name, size: st.size, mtime: st.mtimeMs };
    });
  } catch (_) { return []; }
}

function rotate(dir, keep, filter = () => true) {
  const files = listFiles(dir).filter((f) => filter(f.name)).sort((a, b) => b.mtime - a.mtime);
  for (const f of files.slice(keep)) {
    try { fs.unlinkSync(path.join(dir, f.name)); } catch (_) { /* 忽略 */ }
  }
  return files.length;
}

/** 每日启动快照：同一天只留最早一份，滚动保留 5 份 */
function snapshotOnBoot() {
  if (!fs.existsSync(config.DB_FILE)) return;
  const name = `workspace-${dayKey()}.json`;
  const target = path.join(config.SNAPSHOT_DIR, name);
  if (fs.existsSync(target)) return;
  try {
    fs.copyFileSync(config.DB_FILE, target);
    rotate(config.SNAPSHOT_DIR, config.SNAPSHOT_KEEP, (n) => /^workspace-\d{4}-\d{2}-\d{2}\.json$/.test(n));
  } catch (err) {
    logError('snapshot-boot', err);
  }
}

/** 生成一份快照（kind: boot | auto | manual | pre-restore | pre-import | pre-migrate） */
function createSnapshot(kind = 'manual', { keep = config.SNAPSHOT_INTERVAL_KEEP } = {}) {
  try {
    ensureDirs();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    let name = `workspace-${stamp}-${safeName(kind)}.json`;
    // 同一秒里连续存快照（例如连续导入）不能互相覆盖
    for (let i = 2; fs.existsSync(path.join(config.SNAPSHOT_DIR, name)); i += 1) {
      name = `workspace-${stamp}-${safeName(kind)}-${i}.json`;
    }
    fs.writeFileSync(path.join(config.SNAPSHOT_DIR, name), JSON.stringify(diskPayload(), null, 2), 'utf8');
    rotate(config.SNAPSHOT_DIR, keep, (n) => !/^workspace-\d{4}-\d{2}-\d{2}\.json$/.test(n));
    db.meta.lastSnapshotAt = Date.now();
    if (kind === 'auto') db.meta.lastIntervalAt = Date.now();
    return { name, createdAt: Date.now(), reason: kind };
  } catch (err) {
    logError('snapshot', err);
    return null;
  }
}

/** 如果到了设置里的间隔，就自动存一份；没有记录就不存 */
function maybeAutoSnapshot() {
  try {
    const hours = Number(db.settings.snapshotHours);
    if (!hours) return null;
    const last = Number(db.meta.lastIntervalAt) || 0;
    if (Date.now() - last < hours * 36e5) return null;
    if (!db.entries.length && !db.notes.length) { db.meta.lastIntervalAt = Date.now(); return null; }
    return createSnapshot('auto');
  } catch (_) { return null; }
}

function listSnapshots() {
  ensureDirs();
  return listFiles(config.SNAPSHOT_DIR)
    .sort((a, b) => b.mtime - a.mtime)
    .map((f) => {
      const m = f.name.match(/^workspace-(?:(\d{4}-\d{2}-\d{2})|(.+?))\.json$/);
      const kind = /^workspace-\d{4}-\d{2}-\d{2}\.json$/.test(f.name)
        ? 'boot'
        : (m && m[2] ? (m[2].split('-').slice(3).join('-') || 'manual') : 'manual');
      const parts = f.name.replace(/^workspace-/, '').replace(/\.json$/, '').split('-');
      const reason = parts.length > 3 ? parts.slice(3).join('-') : kind;
      return { name: f.name, size: f.size, createdAt: f.mtime, kind, reason };
    });
}

function snapshotPath(name) {
  const base = path.basename(String(name || ''));
  if (!/^workspace-[\w.-]+\.json$/.test(base)) return null;
  const full = path.join(config.SNAPSHOT_DIR, base);
  return full.startsWith(config.SNAPSHOT_DIR + path.sep) ? full : null;
}

async function deleteSnapshot(name) {
  const full = snapshotPath(name);
  if (!full || !fs.existsSync(full)) return false;
  await fsp.unlink(full);
  return true;
}

/* -------------------------------------------------------- 陌生字段留证 */

function stashPreUpgrade(reason) {
  try {
    if (!fs.existsSync(config.DB_FILE)) return null;
    ensureDirs();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const target = path.join(config.PRE_UPGRADE_DIR, `workspace-${stamp}-${safeName(reason)}.json`);
    fs.copyFileSync(config.DB_FILE, target);
    const files = listFiles(config.PRE_UPGRADE_DIR).sort((a, b) => b.mtime - a.mtime);
    for (const f of files.slice(config.PRE_UPGRADE_KEEP)) {
      try { fs.unlinkSync(path.join(config.PRE_UPGRADE_DIR, f.name)); } catch (_) { /* 忽略 */ }
    }
    return target;
  } catch (err) {
    logError('pre-upgrade', err);
    return null;
  }
}

/* ------------------------------------------------------------ 归一化装载 */

function uniqueById(list, idOf = (x) => x.id) {
  const seen = new Set();
  return list.filter((x) => {
    if (!x) return false;
    if (seen.has(idOf(x))) return false;
    seen.add(idOf(x));
    return true;
  });
}

function normalizeWorkspace(raw, now = Date.now()) {
  const fix = (v) => (Array.isArray(v) ? v : []);
  const projects = uniqueById(fix(raw.projects).map((p) => W.normalizeProject(p, now)).filter(Boolean))
    .sort((a, b) => (a.order - b.order) || (a.createdAt - b.createdAt));
  const projectIds = new Set(projects.map((p) => p.id));

  const entries = uniqueById(fix(raw.entries).map((e) => {
    const n = W.normalizeEntry(e, now, { date: e && e.date });
    if (n) {
      // 保留持久化的时间戳与软删
      n.createdAt = Number(e.createdAt) || n.createdAt;
      n.updatedAt = Number(e.updatedAt) || n.createdAt;
      n.deletedAt = Number(e.deletedAt) || null;
    }
    return n;
  }).filter(Boolean));
  for (const e of entries) if (e.projectId && !projectIds.has(e.projectId)) e.projectId = null;
  const entryIds = new Set(entries.map((e) => e.id));

  const attachments = uniqueById(fix(raw.attachments).map((a) => W.normalizeAttachment(a, now)).filter(Boolean))
    .filter((a) => !a.entryId || entryIds.has(a.entryId));
  const attachmentIds = new Set(attachments.map((a) => a.id));
  for (const e of entries) e.attachmentIds = e.attachmentIds.filter((id) => attachmentIds.has(id));

  const days = fix(raw.days).map((d) => W.normalizeDayLog(d, now)).filter(Boolean).filter((d) => d.summary);
  const templates = uniqueById(fix(raw.templates).map((t) => W.normalizeTemplate(t, now)).filter(Boolean));
  for (const t of templates) if (t.projectId && !projectIds.has(t.projectId)) t.projectId = null;

  const notes = fix(raw.notes).map((n) => {
    const note = N.normalizeNote(n, now);
    note.createdAt = Number(n.createdAt) || note.createdAt;
    note.updatedAt = Number(n.updatedAt) || note.createdAt;
    // 已结即冻结；修订列表保留
    if (note.result && note.result.outcome) note.frozen = true;
    if (note.projectId && !projectIds.has(note.projectId)) note.projectId = null;
    if (note.entryId && !entryIds.has(note.entryId)) note.entryId = null;
    return note;
  }).filter((n) => {
    if (!richtext.htmlToText(n.content) && !n.seen && !n.think && !(n.images || []).length) return false;
    return true;
  });

  // 序号：幂等补号、撞号重发，nextSeq 取 max+1
  const seqs = new Set();
  let nextSeq = Math.max(1, Math.trunc(Number(raw.meta && raw.meta.nextSeq) || 1));
  for (const n of notes) {
    if (!n.seq || seqs.has(n.seq)) { n.seq = nextSeq; nextSeq += 1; }
    seqs.add(n.seq);
    nextSeq = Math.max(nextSeq, n.seq + 1);
  }

  // 承接关系切环
  N.sanitizeDerived(notes);

  const settings = W.normalizeSettings(raw.settings);
  const meta = {
    nextSeq,
    demoAt: Number(raw.meta && raw.meta.demoAt) || 0,
    clearedAt: Number(raw.meta && raw.meta.clearedAt) || 0,
    lastSnapshotAt: Number(raw.meta && raw.meta.lastSnapshotAt) || 0,
    lastIntervalAt: Number(raw.meta && raw.meta.lastIntervalAt) || 0,
  };

  return {
    version: config.DB_VERSION,
    savedAt: Number(raw.savedAt) || 0,
    createdAt: Number(raw.createdAt) || now,
    meta,
    notes,
    projects,
    entries,
    days,
    templates,
    attachments,
    settings,
  };
}

function readJson(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch (_) { return null; }
}

/** 启动装载：主文件 → 备份 → 空库；陌生字段先留证 */
async function load() {
  ensureDirs();
  snapshotOnBoot();

  let raw = readJson(config.DB_FILE);
  if (!raw) {
    raw = readJson(config.BACKUP_FILE);
    if (raw) logError('load', new Error('主数据损坏，已回退 workspace.bak.json'));
    // 全新安装没有数据文件是正常情况，不写成错误日志
    // else logError('load', new Error('没有可读的数据文件，使用空工作区'));
  }
  raw = raw || {};

  const unknown = Object.keys(raw).filter((k) => !KNOWN_KEYS.has(k));
  if (unknown.length) stashPreUpgrade(`unknown-${unknown.slice(0, 4).join('_')}`);

  db = normalizeWorkspace(raw);
  await purgeExpiredTrash({ persistAfter: false });
  booted = true;

  // 首次装载后统一落一次盘（把归一化结果写实，并生成 bak）
  if (!fs.existsSync(config.DB_FILE)) await persist();
  else await persist(); // 归一化修补也写回，保证下次启动稳定

  maybeAutoSnapshot();
  return db;
}

/* ------------------------------------------------------------ 落盘 */

function diskPayload() {
  return {
    version: config.DB_VERSION,
    savedAt: Date.now(),
    createdAt: db.createdAt,
    meta: db.meta,
    settings: db.settings,
    notes: db.notes,
    projects: db.projects,
    entries: db.entries,
    days: db.days,
    templates: db.templates,
    attachments: db.attachments,
  };
}

async function writeOnce(json) {
  const tmp = `${config.DB_FILE}.${process.pid}.tmp`;
  try {
    if (fs.existsSync(config.DB_FILE)) {
      try { await fsp.copyFile(config.DB_FILE, config.BACKUP_FILE); } catch (_) { /* 备份失败不阻塞 */ }
    }
    const fh = await fsp.open(tmp, 'w');
    try {
      await fh.writeFile(json, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, config.DB_FILE);
    lastWriteError = null;
    db.savedAt = Date.now();
    return true;
  } catch (err) {
    lastWriteError = err.message;
    logError('persist', err);
    try { await fsp.unlink(tmp); } catch (_) { /* 忽略 */ }
    return false;
  }
}

function persist() {
  const json = JSON.stringify(diskPayload(), null, 2);
  writeChain = writeChain.then(() => writeOnce(json));
  return writeChain;
}

function sendWriteFail(res) {
  return require('./util').sendJson(res, 503, {
    ok: false,
    writeFailed: true,
    error: '没能写进磁盘，这次改动已经撤回（未生效）。请检查磁盘空间或文件权限；详细原因见 data/errors.log。',
  });
}

/**
 * 提交一次内存改动：落盘失败时执行 revert 并回 503。
 * 用法：if (!(await commit(res, () => { ...回滚... }))) return;
 */
async function commit(res, revert) {
  const ok = await persist();
  if (ok) return true;
  try { if (revert) revert(); } catch (err) { logError('revert', err); }
  sendWriteFail(res);
  return false;
}

/** 给对象做可回滚快照（原地修改用） */
function restorer(target) {
  const before = structuredClone(target);
  return function restore() {
    for (const k of Object.keys(target)) if (!(k in before)) delete target[k];
    Object.assign(target, structuredClone(before));
  };
}

/** 给数组做可回滚快照：返回 { list, restore() } */
function listRestorer(list) {
  const before = structuredClone(list);
  return function restore() {
    list.length = 0;
    list.push(...structuredClone(before));
  };
}

/* ------------------------------------------------------------ 回收站 */

async function purgeExpiredTrash({ persistAfter = true } = {}) {
  const cutoff = Date.now() - config.TRASH_DAYS_MS;
  const expired = db.entries.filter((e) => e.deletedAt && e.deletedAt < cutoff);
  if (!expired.length) return 0;
  const ids = new Set(expired.map((e) => e.id));
  for (const e of expired) await purgeEntryFiles(e);
  db.entries = db.entries.filter((e) => !ids.has(e.id));
  db.attachments = db.attachments.filter((a) => !(a.entryId && ids.has(a.entryId)));
  db.notes = db.notes.map((n) => (n.entryId && ids.has(n.entryId) ? { ...n, entryId: null } : n));
  if (persistAfter) await persist();
  return expired.length;
}

async function removeMedia(rel) {
  if (!rel || rel.includes('..')) return false;
  const full = path.join(config.MEDIA_DIR, rel);
  if (!full.startsWith(config.MEDIA_DIR + path.sep)) return false;
  try { await fsp.unlink(full); return true; } catch (_) { return false; }
}

async function purgeEntryFiles(entry) {
  const atts = db.attachments.filter((a) => a.entryId === entry.id || entry.attachmentIds.includes(a.id));
  for (const a of atts) {
    await removeMedia(a.rel);
    if (a.thumbRel) await removeMedia(a.thumbRel);
  }
}

/* ------------------------------------------------------------ 媒体引用与 GC */

function usedMediaRels() {
  const used = new Set();
  for (const n of db.notes) for (const img of n.images || []) {
    const rel = String(img.url || '').replace(/^\/media\//, '');
    if (rel) used.add(rel);
  }
  for (const a of db.attachments) {
    used.add(a.rel);
    if (a.thumbRel) used.add(a.thumbRel);
  }
  return used;
}

async function gcMedia() {
  const used = usedMediaRels();
  let removed = 0;
  let bytes = 0;
  async function walk(dir) {
    let names = [];
    try { names = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const d of names) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) await walk(full);
      else {
        const rel = path.relative(config.MEDIA_DIR, full).split(path.sep).join('/');
        if (!used.has(rel)) {
          try {
            const st = await fsp.stat(full);
            bytes += st.size;
            await fsp.unlink(full);
            removed += 1;
          } catch (_) { /* 忽略 */ }
        }
      }
    }
  }
  await walk(config.MEDIA_DIR);
  return { removed, bytes };
}

/* ------------------------------------------------------------ 容量与清理 */

async function dirUsage(dir) {
  let bytes = 0;
  let files = 0;
  async function walk(d) {
    let names = [];
    try { names = await fsp.readdir(d, { withFileTypes: true }); } catch (_) { return; }
    for (const x of names) {
      const full = path.join(d, x.name);
      if (x.isDirectory()) await walk(full);
      else {
        try { const st = await fsp.stat(full); bytes += st.size; files += 1; } catch (_) { /* 忽略 */ }
      }
    }
  }
  await walk(dir);
  return { bytes, files };
}

async function storageInfo() {
  const data = await dirUsage(config.DATA_DIR);
  const media = await dirUsage(config.MEDIA_DIR);
  return {
    dataDir: config.DATA_DIR,
    bytes: data.bytes,
    files: data.files,
    mediaBytes: media.bytes,
    mediaFiles: media.files,
    notes: db.notes.length,
    entries: db.entries.filter((e) => !e.deletedAt).length,
    attachments: db.attachments.length,
  };
}

async function cleanup() {
  const purgedEntries = await purgeExpiredTrash({ persistAfter: false });
  const media = await gcMedia();
  rotate(config.SNAPSHOT_DIR, config.SNAPSHOT_INTERVAL_KEEP, (n) => !/^workspace-\d{4}-\d{2}-\d{2}\.json$/.test(n));
  rotate(config.PRE_UPGRADE_DIR, config.PRE_UPGRADE_KEEP, () => true);
  await persist();
  return {
    purgedEntries,
    removedFiles: media.removed,
    snapshots: listSnapshots().length,
  };
}

/* ------------------------------------------------------------ 快照恢复 */

async function restoreSnapshot(name) {
  const full = snapshotPath(name);
  if (!full || !fs.existsSync(full)) return { ok: false, error: '快照不存在' };
  const raw = readJson(full);
  if (!raw) return { ok: false, error: '快照文件损坏' };
  createSnapshot('pre-restore');
  const prev = db;
  const next = normalizeWorkspace(raw);
  db = next;
  if (!(await persist())) {
    db = prev;
    return { ok: false, error: '没能写进磁盘，已保留原来的数据' };
  }
  return { ok: true, restored: name, notes: db.notes.length, entries: db.entries.length };
}

/* ------------------------------------------------------------ 替换工作区（导入） */

async function replaceAll(nextRaw, { kind = 'pre-import' } = {}) {
  createSnapshot(kind);
  const prev = db;
  const next = normalizeWorkspace(nextRaw);
  db = next;
  if (!(await persist())) {
    db = prev;
    return { ok: false, error: '没能写进磁盘，已经保留原来的数据' };
  }
  return { ok: true, notes: db.notes.length, entries: db.entries.length, projects: db.projects.length };
}

function exportRaw({ includeAttachments = false } = {}) {
  const payload = diskPayload();
  if (!includeAttachments) return payload;
  const media = {};
  for (const a of db.attachments) {
    try {
      media[a.rel] = fs.readFileSync(path.join(config.MEDIA_DIR, a.rel)).toString('base64');
      if (a.thumbRel) media[a.thumbRel] = fs.readFileSync(path.join(config.MEDIA_DIR, a.thumbRel)).toString('base64');
    } catch (_) { /* 文件缺失就跳过 */ }
  }
  return { ...payload, media };
}

module.exports = {
  state,
  get db() { return db; },
  get lastWriteError() { return lastWriteError; },
  get booted() { return booted; },
  blankWorkspace,
  ensureDirs,
  load,
  normalizeWorkspace,
  persist,
  commit,
  sendWriteFail,
  restorer,
  listRestorer,
  createSnapshot,
  listSnapshots,
  deleteSnapshot,
  restoreSnapshot,
  maybeAutoSnapshot,
  purgeExpiredTrash,
  purgeEntryFiles,
  gcMedia,
  cleanup,
  storageInfo,
  exportRaw,
  replaceAll,
  removeMedia,
  usedMediaRels,
  diskPayload,
};