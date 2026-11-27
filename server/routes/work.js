'use strict';

/**
 * 知行 · 路由：工作记录 / 项目 / 模板 / 日总结 / 回收站 / 附件
 *
 * 契约见 docs/API.md 第 2、3 节。
 * 约定：已处理返回 true（响应自己写），未匹配返回 false（不写响应）。
 * 所有写操作先改内存，再 store.commit(res, revert)；失败时 commit 已回 503，
 * 这里不要再写响应。
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const config = require('../config');
const store = require('../store');
const W = require('../models/work');
const images = require('../lib/images');
const { cleanText, sendJson, sendError, readBody, dayKey, logError } = require('../util');

const IMAGE_MAX = 12 * 1024 * 1024;
const FILE_MAX = 40 * 1024 * 1024;
const MAX_ATTACHMENTS = 12;

const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const TEXT_MIME = {
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
};
const TEXT_EXTS = Object.keys(TEXT_MIME);

/* ------------------------------------------------------------------ 基础工具 */

const db = () => store.db;
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function done(res, payload, status = 200) {
  sendJson(res, status, payload);
  return true;
}

function fail(res, status, message) {
  sendError(res, status, message);
  return true;
}

function isTruthyParam(value) {
  const text = String(value == null ? '' : value).toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

function readLimit(value) {
  if (value == null || value === '') return null;
  const num = Math.trunc(Number(value));
  if (!Number.isFinite(num) || num < 1) return null;
  return Math.min(num, 5000);
}

/** 请求体解析，失败时已经写好 4xx 响应。 */
async function readJson(req, res, limit) {
  try {
    return { ok: true, body: await readBody(req, limit) };
  } catch (err) {
    if (!res.writableEnded && !res.headersSent) {
      try {
        if (/太大/.test(String((err && err.message) || ''))) {
          sendError(res, 413, '内容太大了，精简一点再试');
        } else {
          sendError(res, 400, '请求内容解析失败，检查一下再提交');
        }
      } catch (_) {
        /* socket 已断开，无法回复 */
      }
    }
    return { ok: false };
  }
}

/* ------------------------------------------------------------------ 视图拼装 */

function projectBrief(projectId) {
  if (!projectId) return null;
  const project = db().projects.find((p) => p.id === projectId);
  if (!project) return null;
  return { id: project.id, name: project.name, color: project.color };
}

function attachmentsForEntry(entry) {
  const ids = new Set(entry.attachmentIds || []);
  return db()
    .attachments
    .filter((a) => ids.has(a.id) || (a.entryId && a.entryId === entry.id))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .map((a) => W.attachmentView(a));
}

function entryViewOf(entry) {
  return W.entryView(entry, {
    project: projectBrief(entry.projectId),
    attachments: attachmentsForEntry(entry),
  });
}

function projectViewOf(project) {
  let entryCount = 0;
  let minutes = 0;
  for (const entry of db().entries) {
    if (entry.projectId === project.id && !entry.deletedAt) {
      entryCount += 1;
      minutes += Number(entry.minutes) || 0;
    }
  }
  const noteCount = db().notes.filter((note) => note.projectId === project.id).length;
  return W.projectView(project, { entryCount, minutes, noteCount });
}

function cmpEntries(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1; // 日期降序
  const pa = Number(a.priority) || 0;
  const pb = Number(b.priority) || 0;
  if (pa !== pb) return pb - pa; // 同日优先级降序
  return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0); // 创建时间升序
}

function matchesEntry(entry, needle) {
  const haystack = [
    entry.title,
    entry.note,
    (entry.tags || []).join(' '),
    (entry.subtasks || []).map((s) => s.text).join(' '),
  ]
    .join('\n')
    .toLowerCase();
  return haystack.includes(needle);
}

function attachmentsOfEntries(entries) {
  const entryIds = new Set(entries.map((e) => e.id));
  const attachmentIds = new Set();
  for (const entry of entries) {
    for (const id of entry.attachmentIds || []) attachmentIds.add(id);
  }
  return db().attachments.filter(
    (a) => attachmentIds.has(a.id) || (a.entryId && entryIds.has(a.entryId)),
  );
}

/** 删除附件文件（先看还有没有别的附件共用同一个文件）。 */
async function removeAttachmentFiles(attachments) {
  for (const attachment of attachments) {
    if (!attachment || !attachment.rel) continue;
    const shared = db().attachments.some((a) => a !== attachment && a.rel === attachment.rel);
    if (!shared) await store.removeMedia(attachment.rel);
    if (attachment.thumbRel) {
      const thumbShared = db().attachments.some(
        (a) => a !== attachment && a.thumbRel === attachment.thumbRel,
      );
      if (!thumbShared) await store.removeMedia(attachment.thumbRel);
    }
  }
}

/* ------------------------------------------------------------------ 输入归一化 */

const ENTRY_FIELDS = [
  'date',
  'title',
  'projectId',
  'minutes',
  'status',
  'priority',
  'tags',
  'note',
  'subtasks',
  'attachmentIds',
];

function pickEntryFields(body) {
  const picked = {};
  for (const key of ENTRY_FIELDS) {
    if (has(body, key)) picked[key] = body[key];
  }
  // 兼容旧前端：hours → minutes
  if (!has(picked, 'minutes') && has(body, 'hours')) {
    const hours = Number(body.hours);
    if (Number.isFinite(hours)) picked.minutes = Math.round(hours * 60);
  }
  return picked;
}

const PROJECT_FIELDS = [
  'name',
  'color',
  'status',
  'note',
  'weeklyGoalHours',
  'startDate',
  'dueDate',
  'progress',
];

function pickProjectFields(body) {
  const picked = {};
  for (const key of PROJECT_FIELDS) {
    if (has(body, key)) picked[key] = body[key];
  }
  if (!has(picked, 'weeklyGoalHours') && has(body, 'weeklyTarget')) {
    picked.weeklyGoalHours = body.weeklyTarget;
  }
  return picked;
}

const TEMPLATE_FIELDS = ['name', 'title', 'projectId', 'minutes', 'tags', 'subtasks'];

function pickTemplateFields(body) {
  const picked = {};
  for (const key of TEMPLATE_FIELDS) {
    if (has(body, key)) picked[key] = body[key];
  }
  if (!has(picked, 'minutes') && has(body, 'hours')) {
    const hours = Number(body.hours);
    if (Number.isFinite(hours)) picked.minutes = Math.round(hours * 60);
  }
  return picked;
}

function normalizeEntryForWrite(raw, base) {
  const parent = base || {};
  const fallbackMinutes = Number.isFinite(Number(parent.minutes))
    ? Number(parent.minutes)
    : db().settings.defaultMinutes;
  const entry = W.normalizeEntry(raw, Date.now(), {
    date: parent.date || dayKey(),
    minutes: fallbackMinutes,
  });
  if (!entry) return null;
  if (entry.projectId && !db().projects.some((p) => p.id === entry.projectId)) {
    entry.projectId = null;
  }
  return entry;
}

/**
 * 把 entry.attachmentIds 设成 ids，并同步附件元数据里的 entryId。
 * 返回回滚函数（只还原附件元数据；entry 自己的字段由调用方 restorer 还原）。
 */
function bindAttachments(entry, ids) {
  const wanted = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== 'string' || wanted.includes(id) || wanted.length >= MAX_ATTACHMENTS) continue;
    if (db().attachments.some((a) => a.id === id)) wanted.push(id);
  }
  const restorers = [];
  for (const attachment of db().attachments) {
    if (attachment.entryId === entry.id && !wanted.includes(attachment.id)) {
      restorers.push(store.restorer(attachment));
      attachment.entryId = null;
    }
  }
  for (const id of wanted) {
    const attachment = db().attachments.find((a) => a.id === id);
    if (attachment && attachment.entryId !== entry.id) {
      restorers.push(store.restorer(attachment));
      attachment.entryId = entry.id;
    }
  }
  entry.attachmentIds = wanted;
  return () => {
    for (const restore of restorers) restore();
  };
}

function badBodyDate(body) {
  return has(body, 'date') && body.date != null && body.date !== '' && !W.dateKey(body.date);
}

/* ------------------------------------------------------------------ 附件文件 */

async function saveBuffer(buf, ext) {
  const dir = images.monthDir();
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20);
  const filename = `${hash}.${ext}`;
  const abs = path.join(config.MEDIA_DIR, dir, filename);
  const rel = `${dir}/${filename}`;
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  try {
    await fsp.access(abs);
  } catch (_) {
    await fsp.writeFile(abs, buf);
  }
  return rel;
}

async function saveUpload(buf, info) {
  if (info.image && buf.length <= images.MAX_IMAGE) {
    return images.saveImage(config.MEDIA_DIR, buf);
  }
  return saveBuffer(buf, info.ext);
}

function extByName(name, allowed) {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
  return ext && allowed.includes(ext) ? ext : null;
}

function safeFileName(raw) {
  let name = cleanText(raw, 80);
  name = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  name = name.replace(/^\.+/, '').trim();
  return name.slice(0, 80) || '附件';
}

function looksPrintable(sample) {
  if (!sample.length) return true;
  const step = Math.max(1, Math.floor(sample.length / 2048));
  let total = 0;
  let bad = 0;
  for (let i = 0; i < sample.length; i += step) {
    total += 1;
    const code = sample[i];
    if (code < 7 || (code > 13 && code < 32)) bad += 1;
  }
  return total === 0 || bad / total < 0.05;
}

/** 以内容判断类型，不信任前端给的扩展名。 */
function sniffFile(buf, name, claimedMime) {
  const imageExt = images.sniffExt(buf);
  if (imageExt) {
    return { ext: imageExt, mime: IMAGE_MIME[imageExt] || `image/${imageExt}`, image: true };
  }
  const startsWith = (sig) => buf.length >= sig.length && buf.slice(0, sig.length).equals(sig);
  if (buf.slice(0, 5).toString('latin1') === '%PDF-') {
    return { ext: 'pdf', mime: 'application/pdf', image: false };
  }
  if (startsWith(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    if (buf.includes(Buffer.from('word/document.xml'))) {
      return {
        ext: 'docx',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        image: false,
      };
    }
    if (buf.includes(Buffer.from('xl/workbook.xml'))) {
      return {
        ext: 'xlsx',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        image: false,
      };
    }
    if (buf.includes(Buffer.from('ppt/presentation.xml'))) {
      return {
        ext: 'pptx',
        mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        image: false,
      };
    }
    return { ext: 'zip', mime: 'application/zip', image: false };
  }
  if (startsWith(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    const ext = extByName(name, ['doc', 'xls', 'ppt']) || 'bin';
    const mime =
      ext === 'doc'
        ? 'application/msword'
        : ext === 'xls'
          ? 'application/vnd.ms-excel'
          : ext === 'ppt'
            ? 'application/vnd.ms-powerpoint'
            : 'application/octet-stream';
    return { ext, mime, image: false };
  }
  const sample = buf.slice(0, 8192);
  const claimedIsImage = String(claimedMime || '').toLowerCase().startsWith('image/');
  if (!claimedIsImage && !sample.includes(0) && looksPrintable(sample)) {
    const ext = extByName(name, TEXT_EXTS) || 'txt';
    return { ext, mime: TEXT_MIME[ext] || 'text/plain; charset=utf-8', image: false };
  }
  return { ext: 'bin', mime: 'application/octet-stream', image: false };
}

/** 通用 data URI 解析：图片和普通文件都支持。 */
function parseAnyDataUri(uri) {
  if (typeof uri !== 'string') return null;
  const matched = /^data:([^,]*),([\s\S]*)$/.exec(uri.trim());
  if (!matched) return null;
  const meta = matched[1] || '';
  const payload = matched[2] || '';
  const isBase64 = /;base64(?:$|;)/i.test(meta);
  try {
    if (isBase64) {
      const cleaned = payload.replace(/\s+/g, '');
      if (!cleaned) return null;
      const buf = Buffer.from(cleaned, 'base64');
      return buf.length ? buf : null;
    }
    const buf = Buffer.from(decodeURIComponent(payload), 'utf8');
    return buf.length ? buf : null;
  } catch (_) {
    return null;
  }
}

function uploadErrorText(err) {
  const message = String((err && err.message) || '');
  return message && message.length <= 40 ? message : '附件保存失败';
}

/* ------------------------------------------------------------------ 工作记录 */

function listEntries(res, get) {
  const rawDate = get('date');
  const rawFrom = get('from');
  const rawTo = get('to');
  const date = rawDate ? W.dateKey(rawDate) : null;
  const from = rawFrom ? W.dateKey(rawFrom) : null;
  const to = rawTo ? W.dateKey(rawTo) : null;
  if (rawDate && !date) return fail(res, 400, '日期不对');
  if (rawFrom && !from) return fail(res, 400, '日期不对');
  if (rawTo && !to) return fail(res, 400, '日期不对');

  const projectIdRaw = get('projectId');
  const needle = cleanText(get('q'), 100).toLowerCase();
  const includeDeleted = isTruthyParam(get('includeDeleted'));
  const limit = readLimit(get('limit'));

  let list = db().entries.filter((entry) => includeDeleted || !entry.deletedAt);
  if (date) {
    list = list.filter((entry) => entry.date === date);
  } else {
    if (from) list = list.filter((entry) => entry.date >= from);
    if (to) list = list.filter((entry) => entry.date <= to);
  }
  if (projectIdRaw != null && projectIdRaw !== '') {
    if (projectIdRaw === 'none' || projectIdRaw === 'null') {
      list = list.filter((entry) => !entry.projectId);
    } else {
      list = list.filter((entry) => entry.projectId === projectIdRaw);
    }
  }
  if (needle) list = list.filter((entry) => matchesEntry(entry, needle));

  list = list.slice().sort(cmpEntries);
  const total = list.length;
  if (limit) list = list.slice(0, limit);

  return done(res, { ok: true, entries: list.map(entryViewOf), total });
}

async function createEntry(req, res) {
  const parsed = await readJson(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body || {};
  if (badBodyDate(body)) return fail(res, 400, '日期不对');

  const entry = normalizeEntryForWrite(pickEntryFields(body), { date: dayKey() });
  if (!entry) return fail(res, 400, '标题不能为空');

  const restoreAttachments = bindAttachments(entry, entry.attachmentIds);
  db().entries.push(entry);
  const revert = () => {
    restoreAttachments();
    const index = db().entries.indexOf(entry);
    if (index >= 0) db().entries.splice(index, 1);
  };
  if (!(await store.commit(res, revert))) return true;
  return done(res, { ok: true, entry: entryViewOf(entry) }, 201);
}

async function patchEntry(req, res, id) {
  const entry = db().entries.find((e) => e.id === id);
  if (!entry) return fail(res, 404, '这条记录不在了');

  const parsed = await readJson(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body || {};
  if (badBodyDate(body)) return fail(res, 400, '日期不对');

  const merged = { ...entry, ...pickEntryFields(body) };
  const next = normalizeEntryForWrite(merged, entry);
  if (!next) return fail(res, 400, '标题不能为空');
  next.deletedAt = entry.deletedAt;

  const restoreEntry = store.restorer(entry);
  Object.assign(entry, next);
  const restoreAttachments = bindAttachments(entry, entry.attachmentIds);
  const revert = () => {
    restoreAttachments();
    restoreEntry();
  };
  if (!(await store.commit(res, revert))) return true;
  return done(res, { ok: true, entry: entryViewOf(entry) });
}

async function deleteEntry(res, id) {
  const entry = db().entries.find((e) => e.id === id);
  if (!entry) return fail(res, 404, '这条记录不在了');
  const restore = store.restorer(entry);
  entry.deletedAt = Date.now();
  entry.updatedAt = entry.deletedAt;
  if (!(await store.commit(res, restore))) return true;
  return done(res, { ok: true, id: entry.id, deletedAt: entry.deletedAt });
}

async function restoreEntry(res, id) {
  const entry = db().entries.find((e) => e.id === id);
  if (!entry) return fail(res, 404, '这条记录不在了');
  const restore = store.restorer(entry);
  entry.deletedAt = null;
  entry.updatedAt = Date.now();
  if (!(await store.commit(res, restore))) return true;
  return done(res, { ok: true, entry: entryViewOf(entry) });
}

async function purgeEntry(res, id) {
  const entry = db().entries.find((e) => e.id === id);
  if (!entry) return fail(res, 404, '这条记录不在了');

  const attachments = attachmentsOfEntries([entry]);
  const attachmentIds = new Set(attachments.map((a) => a.id));
  const oldEntries = db().entries;
  const oldAttachments = db().attachments;
  const oldNotes = db().notes;

  db().entries = oldEntries.filter((e) => e.id !== id);
  db().attachments = oldAttachments.filter((a) => !attachmentIds.has(a.id));
  db().notes = oldNotes.map((note) => (note.entryId === id ? { ...note, entryId: null } : note));
  const revert = () => {
    db().entries = oldEntries;
    db().attachments = oldAttachments;
    db().notes = oldNotes;
  };
  if (!(await store.commit(res, revert))) return true;

  await removeAttachmentFiles(attachments);
  return done(res, { ok: true, id });
}

async function copyEntries(req, res) {
  const parsed = await readJson(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body || {};
  const from = W.dateKey(body.from);
  const to = W.dateKey(body.to);
  if (!from || !to) return fail(res, 400, '日期不对');

  const now = Date.now();
  const copies = [];
  for (const source of db().entries) {
    if (source.date !== from || source.deletedAt) continue;
    const copy = W.normalizeEntry(
      {
        date: to,
        title: source.title,
        projectId: source.projectId,
        minutes: source.minutes,
        status: source.status === 'done' ? 'doing' : source.status,
        priority: source.priority,
        tags: source.tags,
        note: source.note,
        subtasks: (source.subtasks || []).map((s) => ({ text: s.text, done: s.done })),
        attachmentIds: [],
        createdAt: now,
      },
      now,
      { date: to },
    );
    if (copy) copies.push(copy);
  }

  db().entries.push(...copies);
  const revert = () => {
    for (const copy of copies) {
      const index = db().entries.indexOf(copy);
      if (index >= 0) db().entries.splice(index, 1);
    }
  };
  if (!(await store.commit(res, revert))) return true;
  return done(res, { ok: true, copied: copies.length });
}

async function moveEntry(req, res) {
  const parsed = await readJson(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body || {};
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return fail(res, 400, '参数不对');
  const date = W.dateKey(body.date);
  if (!date) return fail(res, 400, '日期不对');

  const entry = db().entries.find((e) => e.id === id);
  if (!entry) return fail(res, 404, '这条记录不在了');
  const restore = store.restorer(entry);
  entry.date = date;
  entry.updatedAt = Date.now();
  if (!(await store.commit(res, restore))) return true;
  return done(res, { ok: true, entry: entryViewOf(entry) });
}

/* ------------------------------------------------------------------ 日总结 */

function listDays(res, get) {
  const rawFrom = get('from');
  const rawTo = get('to');
  const from = rawFrom ? W.dateKey(rawFrom) : null;
  const to = rawTo ? W.dateKey(rawTo) : null;
  if (rawFrom && !from) return fail(res, 400, '日期不对');
  if (rawTo && !to) return fail(res, 400, '日期不对');

  let list = db().days.slice();
  if (from) list = list.filter((row) => row.date >= from);
  if (to) list = list.filter((row) => row.date <= to);
  list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return done(res, { ok: true, days: list });
}

async function putDay(req, res, dateParam) {
  const date = W.dateKey(dateParam);
  if (!date) return fail(res, 400, '日期不对');

  const parsed = await readJson(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body || {};
  const summary = cleanText(body.summary, 4000);
  const existing = db().days.find((row) => row.date === date);

  if (!summary) {
    if (!existing) return done(res, { ok: true, day: null });
    const oldDays = db().days;
    db().days = oldDays.filter((row) => row.date !== date);
    if (!(await store.commit(res, () => { db().days = oldDays; }))) return true;
    return done(res, { ok: true, day: null });
  }

  if (existing) {
    const restore = store.restorer(existing);
    existing.summary = summary;
    existing.updatedAt = Date.now();
    if (!(await store.commit(res, restore))) return true;
    return done(res, { ok: true, day: existing });
  }

  const row = { date, summary, updatedAt: Date.now() };
  db().days.push(row);
  const revert = () => {
    const index = db().days.indexOf(row);
    if (index >= 0) db().days.splice(index, 1);
  };
  if (!(await store.commit(res, revert))) return true;
  return done(res, { ok: true, day: row });
}

/* ------------------------------------------------------------------ 项目 */

function listProjects(res, get) {
  const includeArchived = isTruthyParam(get('includeArchived'));
  let list = db().projects.slice();
  if (!includeArchived) list = list.filter((project) => project.status !== 'archived');
  list.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || (a.createdAt || 0) - (b.createdAt || 0));
  return done(res, { ok: true, projects: list.map(projectViewOf) });
}

async function createProject(req, res) {
  const parsed = await readJson(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body || {};

  const project = W.normalizeProject(pickProjectFields(body));
  if (!project) return fail(res, 400, '项目得有名字');
  const maxOrder = db().projects.reduce((max, p) => Math.max(max, Number(p.order) || 0), -1);
  project.order = maxOrder + 1;

  db().projects.push(project);
  const revert = () => {
    const index = db().projects.indexOf(project);
    if (index >= 0) db().projects.splice(index, 1);
  };
  if (!(await store.commit(res, revert))) return true;
  return done(res, { ok: true, project: projectViewOf(project) }, 201);
}

async function patchProject(req, res, id) {
  const project = db().projects.find((p) => p.id === id);
  if (!project) return fail(res, 404, '项目不在了');

  const parsed = await readJson(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body || {};

  const merged = { ...project, ...pickProjectFields(body) };
  const next = W.normalizeProject(merged);
  if (!next) return fail(res, 400, '项目得有名字');

  const restore = store.restorer(project);
  Object.assign(project, next);
  if (!(await store.commit(res, restore))) return true;
  return done(res, { ok: true, project: projectViewOf(project) });
}

/**
 * 把项目下的记录、笔记、模板迁到 targetId（null 表示未分类），然后移除项目。
 * 记录永不丢，返回迁移条数。
 */
function transferProject(sourceId, targetId) {
  const now = Date.now();
  const oldProjects = db().projects;
  const oldEntries = db().entries;
  const oldNotes = db().notes;
  const oldTemplates = db().templates;

  let movedEntries = 0;
  let movedNotes = 0;

  const projects = oldProjects.filter((project) => project.id !== sourceId);
  const entries = oldEntries.map((entry) => {
    if (entry.projectId !== sourceId) return entry;
    movedEntries += 1;
    return { ...entry, projectId: targetId, updatedAt: now };
  });
  const notes = oldNotes.map((note) => {
    if (note.projectId !== sourceId) return note;
    movedNotes += 1;
    return { ...note, projectId: targetId };
  });
  const templates = oldTemplates.map((tpl) =>
    tpl.projectId === sourceId ? { ...tpl, projectId: targetId } : tpl,
  );

  db().projects = projects;
  db().entries = entries;
  db().notes = notes;
  db().templates = templates;

  return {
    movedEntries,
    movedNotes,
    revert: () => {
      db().projects = oldProjects;
      db().entries = oldEntries;
      db().notes = oldNotes;
      db().templates = oldTemplates;
    },
  };
}

async function deleteProject(res, id, get) {
  const project = db().projects.find((p) => p.id === id);
  if (!project) return fail(res, 404, '项目不在了');

  let transferTo = null;
  const raw = get('transferTo');
  if (raw != null && raw !== '' && raw !== 'none' && raw !== 'null') {
    const target = db().projects.find((p) => p.id === raw);
    if (!target) return fail(res, 400, '迁移目标项目不在了');
    if (target.id === project.id) return fail(res, 400, '不能迁移到自己身上');
    transferTo = target.id;
  }

  const result = transferProject(project.id, transferTo);
  if (!(await store.commit(res, result.revert))) return true;
  return done(res, {
    ok: true,
    id: project.id,
    movedEntries: result.movedEntries,
    movedNotes: result.movedNotes,
  });
}

async function mergeProject(req, res, id) {
  const source = db().projects.find((p) => p.id === id);
  if (!source) return fail(res, 404, '项目不在了');

  const parsed = await readJson(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body || {};
  const targetId = typeof body.targetId === 'string' ? body.targetId : '';
  if (!targetId) return fail(res, 400, '参数不对');
  const target = db().projects.find((p) => p.id === targetId);
  if (!target) return fail(res, 400, '目标项目不在了');
  if (target.id === source.id) return fail(res, 400, '不能合并到自己');

  const result = transferProject(source.id, target.id);
  if (!(await store.commit(res, result.revert))) return true;
  return done(res, {
    ok: true,
    id: source.id,
    targetId: target.id,
    movedEntries: result.movedEntries,
    movedNotes: result.movedNotes,
  });
}

async function reorderProjects(req, res) {
  const parsed = await readJson(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body || {};
  if (!Array.isArray(body.ids)) return fail(res, 400, '排序参数不对');

  const restorers = [];
  body.ids.forEach((id, index) => {
    if (typeof id !== 'string') return;
    const project = db().projects.find((p) => p.id === id);
    if (!project) return;
    if (Number(project.order) !== index) {
      restorers.push(store.restorer(project));
      project.order = index;
      project.updatedAt = Date.now();
    }
  });
  if (!restorers.length) return done(res, { ok: true });
  if (!(await store.commit(res, () => { for (const restore of restorers) restore(); }))) return true;
  return done(res, { ok: true });
}

/* ------------------------------------------------------------------ 模板 */

function listTemplates(res) {
  const list = db().templates.slice().sort(
    (a, b) => (Number(b.useCount) || 0) - (Number(a.useCount) || 0) || (b.createdAt || 0) - (a.createdAt || 0),
  );
  return done(res, { ok: true, templates: list });
}

async function createTemplate(req, res) {
  const parsed = await readJson(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body || {};

  const template = W.normalizeTemplate(pickTemplateFields(body));
  if (!template) return fail(res, 400, '模板要有名字和标题');
  if (template.projectId && !db().projects.some((p) => p.id === template.projectId)) {
    template.projectId = null;
  }

  db().templates.push(template);
  const revert = () => {
    const index = db().templates.indexOf(template);
    if (index >= 0) db().templates.splice(index, 1);
  };
  if (!(await store.commit(res, revert))) return true;
  return done(res, { ok: true, template }, 201);
}

async function patchTemplate(req, res, id) {
  const template = db().templates.find((t) => t.id === id);
  if (!template) return fail(res, 404, '模板不在了');

  const parsed = await readJson(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body || {};

  const merged = { ...template, ...pickTemplateFields(body) };
  const next = W.normalizeTemplate(merged);
  if (!next) return fail(res, 400, '模板要有名字和标题');
  if (next.projectId && !db().projects.some((p) => p.id === next.projectId)) {
    next.projectId = null;
  }

  const restore = store.restorer(template);
  Object.assign(template, next);
  if (!(await store.commit(res, restore))) return true;
  return done(res, { ok: true, template });
}

async function deleteTemplate(res, id) {
  const template = db().templates.find((t) => t.id === id);
  if (!template) return fail(res, 404, '模板不在了');
  const oldTemplates = db().templates;
  db().templates = oldTemplates.filter((t) => t.id !== id);
  if (!(await store.commit(res, () => { db().templates = oldTemplates; }))) return true;
  return done(res, { ok: true, id });
}

async function useTemplate(req, res, id) {
  const template = db().templates.find((t) => t.id === id);
  if (!template) return fail(res, 404, '模板不在了');

  const parsed = await readJson(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body || {};
  if (badBodyDate(body)) return fail(res, 400, '日期不对');
  const date = W.dateKey(body.date) || dayKey();

  const entry = normalizeEntryForWrite(
    {
      date,
      title: template.title || template.name,
      projectId: template.projectId,
      minutes: template.minutes,
      status: 'doing',
      tags: template.tags,
      subtasks: (template.subtasks || []).map((text) =>
        typeof text === 'string' ? { text, done: false } : text,
      ),
    },
    { date },
  );
  if (!entry) return fail(res, 400, '模板内容不完整');

  const restoreTemplate = store.restorer(template);
  template.useCount = (Number(template.useCount) || 0) + 1;
  db().entries.push(entry);
  const revert = () => {
    restoreTemplate();
    const index = db().entries.indexOf(entry);
    if (index >= 0) db().entries.splice(index, 1);
  };
  if (!(await store.commit(res, revert))) return true;
  return done(res, { ok: true, entry: entryViewOf(entry), template }, 201);
}

/* ------------------------------------------------------------------ 回收站 */

function getTrash(res) {
  const list = db()
    .entries
    .filter((entry) => entry.deletedAt)
    .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  return done(res, {
    ok: true,
    entries: list.map(entryViewOf),
    expiresInDays: config.TRASH_DAYS,
  });
}

async function emptyTrash(res) {
  const trashed = db().entries.filter((entry) => entry.deletedAt);
  if (!trashed.length) return done(res, { ok: true, purged: 0 });

  const attachments = attachmentsOfEntries(trashed);
  const entryIds = new Set(trashed.map((entry) => entry.id));
  const attachmentIds = new Set(attachments.map((a) => a.id));
  const oldEntries = db().entries;
  const oldAttachments = db().attachments;
  const oldNotes = db().notes;

  db().entries = oldEntries.filter((entry) => !entryIds.has(entry.id));
  db().attachments = oldAttachments.filter((a) => !attachmentIds.has(a.id));
  db().notes = oldNotes.map((note) =>
    note.entryId && entryIds.has(note.entryId) ? { ...note, entryId: null } : note,
  );
  const revert = () => {
    db().entries = oldEntries;
    db().attachments = oldAttachments;
    db().notes = oldNotes;
  };
  if (!(await store.commit(res, revert))) return true;

  await removeAttachmentFiles(attachments);
  return done(res, { ok: true, purged: trashed.length });
}

/* ------------------------------------------------------------------ 附件 */

async function uploadAttachment(req, res) {
  const parsed = await readJson(req, res, config.MAX_IMPORT);
  if (!parsed.ok) return true;
  const body = parsed.body || {};

  const buf = parseAnyDataUri(body.data);
  if (!buf) return fail(res, 400, '附件内容是空的');

  const info = sniffFile(buf, body.name, body.mime);
  if (info.image && buf.length > IMAGE_MAX) return fail(res, 400, '图片太大了（上限 12MB）');
  if (!info.image && buf.length > FILE_MAX) return fail(res, 400, '文件太大了（上限 40MB）');

  let entry = null;
  if (body.entryId) {
    entry = db().entries.find((e) => e.id === body.entryId);
    if (!entry) return fail(res, 400, '这条记录不在了');
    if ((entry.attachmentIds || []).length >= MAX_ATTACHMENTS) {
      return fail(res, 400, '一条记录最多挂 12 个附件');
    }
  }

  let thumbRel = null;
  if (typeof body.thumb === 'string' && body.thumb) {
    const thumbBuf = images.parseDataUri(body.thumb);
    if (thumbBuf && images.sniffExt(thumbBuf)) {
      try {
        thumbRel = await images.saveImage(config.MEDIA_DIR, thumbBuf);
      } catch (_) {
        thumbRel = null;
      }
    }
  }

  let rel;
  try {
    rel = await saveUpload(buf, info);
  } catch (err) {
    if (thumbRel) await store.removeMedia(thumbRel);
    return fail(res, 400, uploadErrorText(err));
  }

  const date = W.dateKey(body.date) || (entry && entry.date) || dayKey();
  const attachment = W.normalizeAttachment({
    entryId: entry ? entry.id : null,
    date,
    name: safeFileName(body.name),
    mime: info.mime,
    size: buf.length,
    rel,
    thumbRel,
    w: body.w,
    h: body.h,
    createdAt: Date.now(),
  });
  if (!attachment) {
    await store.removeMedia(rel);
    if (thumbRel) await store.removeMedia(thumbRel);
    return fail(res, 400, '附件保存失败');
  }

  db().attachments.push(attachment);
  const restoreEntry = entry ? store.restorer(entry) : null;
  if (entry) {
    entry.attachmentIds = [...(entry.attachmentIds || []), attachment.id].slice(0, MAX_ATTACHMENTS);
  }
  const revert = () => {
    if (restoreEntry) restoreEntry();
    const index = db().attachments.indexOf(attachment);
    if (index >= 0) db().attachments.splice(index, 1);
  };
  if (!(await store.commit(res, revert))) {
    await store.removeMedia(rel);
    if (thumbRel) await store.removeMedia(thumbRel);
    return true;
  }
  return done(res, { ok: true, attachment: W.attachmentView(attachment) }, 201);
}

async function bindEntryAttachments(req, res, id) {
  const entry = db().entries.find((e) => e.id === id);
  if (!entry) return fail(res, 404, '这条记录不在了');

  const parsed = await readJson(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body || {};
  if (!Array.isArray(body.ids)) return fail(res, 400, '参数不对');

  const merged = [...(entry.attachmentIds || [])];
  for (const attachmentId of body.ids) {
    if (typeof attachmentId !== 'string' || merged.includes(attachmentId)) continue;
    if (db().attachments.some((a) => a.id === attachmentId)) merged.push(attachmentId);
  }
  if (merged.length > MAX_ATTACHMENTS) return fail(res, 400, '一条记录最多挂 12 个附件');

  const restoreEntry = store.restorer(entry);
  const restoreAttachments = bindAttachments(entry, merged);
  const revert = () => {
    restoreAttachments();
    restoreEntry();
  };
  if (!(await store.commit(res, revert))) return true;
  return done(res, { ok: true, entry: entryViewOf(entry) });
}

/**
 * 软删：从记录上摘掉、元数据保留、文件保留，方便之后 purge 找到文件。
 * （模型没有附件 deletedAt，用 entryId=null 表示已解绑。）
 */
async function deleteAttachment(res, id) {
  const attachment = db().attachments.find((a) => a.id === id);
  if (!attachment) return fail(res, 404, '附件不在了');

  const restoreAttachment = store.restorer(attachment);
  const bound = db().entries.filter((entry) => (entry.attachmentIds || []).includes(id));
  const restoreEntries = bound.map((entry) => store.restorer(entry));
  for (const entry of bound) entry.attachmentIds = entry.attachmentIds.filter((x) => x !== id);
  attachment.entryId = null;

  const revert = () => {
    for (const restore of restoreEntries) restore();
    restoreAttachment();
  };
  if (!(await store.commit(res, revert))) return true;
  return done(res, { ok: true, id });
}

async function purgeAttachment(res, id) {
  const attachment = db().attachments.find((a) => a.id === id);
  if (!attachment) return fail(res, 404, '附件不在了');

  const bound = db().entries.filter((entry) => (entry.attachmentIds || []).includes(id));
  const restoreEntries = bound.map((entry) => store.restorer(entry));
  for (const entry of bound) entry.attachmentIds = entry.attachmentIds.filter((x) => x !== id);

  const oldAttachments = db().attachments;
  db().attachments = oldAttachments.filter((a) => a.id !== id);
  const revert = () => {
    for (const restore of restoreEntries) restore();
    db().attachments = oldAttachments;
  };
  if (!(await store.commit(res, revert))) return true;

  await removeAttachmentFiles([attachment]);
  return done(res, { ok: true, id });
}

function getAttachment(req, res, id, get) {
  const attachment = db().attachments.find((a) => a.id === id);
  if (!attachment) return fail(res, 404, '附件不在了');

  const rel = String(attachment.rel || '');
  const root = path.resolve(config.MEDIA_DIR);
  const full = path.resolve(root, rel);
  if (!rel || rel.includes('\u0000') || !full.startsWith(root + path.sep)) {
    return fail(res, 400, '附件路径不对');
  }
  let stat;
  try {
    stat = fs.statSync(full);
  } catch (_) {
    return fail(res, 404, '附件文件不在了');
  }
  if (!stat.isFile()) return fail(res, 404, '附件文件不在了');

  const download = isTruthyParam(get('download'));
  const name = safeFileName(attachment.name);
  const asciiName = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const disposition = `${download ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  const type = String(attachment.mime || '').replace(/[\r\n]/g, '').slice(0, 120) || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Content-Disposition': disposition,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(full)
    .on('error', (err) => {
      logError('work-attachment-stream', err);
      try {
        res.destroy();
      } catch (_) {
        /* ignore */
      }
    })
    .pipe(res);
  return true;
}

/* ------------------------------------------------------------------ 路由分发 */

function pathSegs(pathname) {
  let raw = typeof pathname === 'string' ? pathname : String(pathname || '/');
  const queryIndex = raw.indexOf('?');
  const qs = queryIndex >= 0 ? raw.slice(queryIndex + 1) : '';
  if (queryIndex >= 0) raw = raw.slice(0, queryIndex);
  const segs = raw
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch (_) {
        return segment;
      }
    });
  return { segs, qs };
}

function makeQueryGetter(query, qs) {
  if (query && typeof query.get === 'function') {
    return (name) => {
      const value = query.get(name);
      return value == null ? null : String(value);
    };
  }
  if (query && typeof query === 'object' && !Array.isArray(query)) {
    return (name) => {
      const value = query[name];
      if (value == null) return null;
      return String(Array.isArray(value) ? value[0] : value);
    };
  }
  const params = new URLSearchParams(typeof query === 'string' && query ? query : qs || '');
  return (name) => params.get(name);
}

async function dispatchWork(req, res, method, segs, get) {
  const area = segs[2];
  const len = segs.length;

  if (area === 'entries') {
    if (len === 3) {
      if (method === 'GET') return listEntries(res, get);
      if (method === 'POST') return createEntry(req, res);
      return false;
    }
    if (len === 4 && segs[3] === 'copy') {
      return method === 'POST' ? copyEntries(req, res) : false;
    }
    if (len === 4 && segs[3] === 'move') {
      return method === 'POST' ? moveEntry(req, res) : false;
    }
    if (len === 4) {
      if (method === 'PATCH') return patchEntry(req, res, segs[3]);
      if (method === 'DELETE') return deleteEntry(res, segs[3]);
      return false;
    }
    if (len === 5 && segs[4] === 'restore') {
      return method === 'POST' ? restoreEntry(res, segs[3]) : false;
    }
    if (len === 5 && segs[4] === 'purge') {
      return method === 'DELETE' ? purgeEntry(res, segs[3]) : false;
    }
    if (len === 5 && segs[4] === 'attachments') {
      return method === 'POST' ? bindEntryAttachments(req, res, segs[3]) : false;
    }
    return false;
  }

  if (area === 'days') {
    if (len === 3 && method === 'GET') return listDays(res, get);
    if (len === 4 && method === 'PUT') return putDay(req, res, segs[3]);
    return false;
  }

  if (area === 'projects') {
    if (len === 3) {
      if (method === 'GET') return listProjects(res, get);
      if (method === 'POST') return createProject(req, res);
      return false;
    }
    if (len === 4 && segs[3] === 'reorder') {
      return method === 'POST' ? reorderProjects(req, res) : false;
    }
    if (len === 5 && segs[4] === 'merge') {
      return method === 'POST' ? mergeProject(req, res, segs[3]) : false;
    }
    if (len === 4) {
      if (method === 'PATCH') return patchProject(req, res, segs[3]);
      if (method === 'DELETE') return deleteProject(res, segs[3], get);
      return false;
    }
    return false;
  }

  if (area === 'templates') {
    if (len === 3) {
      if (method === 'GET') return listTemplates(res);
      if (method === 'POST') return createTemplate(req, res);
      return false;
    }
    if (len === 5 && segs[4] === 'use') {
      return method === 'POST' ? useTemplate(req, res, segs[3]) : false;
    }
    if (len === 4) {
      if (method === 'PATCH') return patchTemplate(req, res, segs[3]);
      if (method === 'DELETE') return deleteTemplate(res, segs[3]);
      return false;
    }
    return false;
  }

  if (area === 'trash') {
    if (len === 3 && method === 'GET') return getTrash(res);
    if (len === 4 && segs[3] === 'empty' && method === 'POST') return emptyTrash(res);
    return false;
  }

  return false;
}

async function dispatchAttachments(req, res, method, segs, get) {
  const len = segs.length;
  if (len === 2) return method === 'POST' ? uploadAttachment(req, res) : false;
  if (len === 4 && segs[3] === 'purge') {
    return method === 'DELETE' ? purgeAttachment(res, segs[2]) : false;
  }
  if (len === 3) {
    if (method === 'GET') return getAttachment(req, res, segs[2], get);
    if (method === 'DELETE') return deleteAttachment(res, segs[2]);
    return false;
  }
  return false;
}

async function dispatch(req, res, pathname, query) {
  const { segs, qs } = pathSegs(pathname);
  if (segs[0] !== 'api') return false;
  const method = String(req.method || 'GET').toUpperCase();
  const get = makeQueryGetter(query, qs);
  if (segs[1] === 'work') return dispatchWork(req, res, method, segs, get);
  if (segs[1] === 'attachments') return dispatchAttachments(req, res, method, segs, get);
  return false;
}

module.exports = async function handle(req, res, pathname, query) {
  try {
    return await dispatch(req, res, pathname, query);
  } catch (err) {
    logError('work-routes', err);
    if (!res.writableEnded && !res.headersSent) {
      try {
        sendError(res, 500, '服务器出了点问题，稍后再试');
      } catch (_) {
        /* ignore */
      }
    }
    return true;
  }
};
