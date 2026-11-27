'use strict';

/**
 * 知行 · 工作模型（项目 / 记录 / 日总结 / 模板 / 附件 / 偏好）
 * 字段沿用 Studio Log 的口径，时长以「分钟」为唯一存储单位，展示层再换算小时。
 */

const crypto = require('crypto');
const { cleanText, round1, numOrNull } = require('../util');

const STATUSES = ['active', 'paused', 'archived'];
const ENTRY_STATUSES = ['done', 'doing', 'blocked'];
const PRIORITIES = [0, 1, 2];
const THEMES = ['system', 'dark', 'light'];
const DENSITIES = ['cozy', 'compact'];
const ACCENTS = ['teal', 'ice', 'lime', 'amber', 'coral', 'steel', 'magenta'];
const START_VIEWS = ['today', 'calendar', 'notes', 'review', 'insights'];
const SNAPSHOT_HOURS = [0, 6, 12, 24, 72];

const PROJECT_COLORS = [
  '#5B7CFA', '#22C7B8', '#E8A23C', '#E4644B', '#7BC860', '#38BDF8',
  '#F472B6', '#A78BFA', '#14B8A6', '#F59E0B', '#84CC16', '#64748B',
];

const uid = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function pickColor(v, fallback = PROJECT_COLORS[0]) {
  return isHex(v) ? v.toLowerCase() : fallback;
}

function dateKey(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  if (t.getFullYear() !== y || t.getMonth() !== m - 1 || t.getDate() !== d) return null;
  return v;
}

function normalizeSubtasks(raw, { keepIds = true } = {}) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => {
      if (typeof s === 'string') {
        const text = cleanText(s, 200);
        return text ? { id: uid('s'), text, done: false } : null;
      }
      if (!s || typeof s !== 'object') return null;
      const text = cleanText(s.text, 200);
      if (!text) return null;
      return {
        id: keepIds && typeof s.id === 'string' && /^[\w-]{2,64}$/.test(s.id) ? s.id : uid('s'),
        text,
        done: Boolean(s.done),
      };
    })
    .filter(Boolean)
    .slice(0, 50);
}

function normalizeTags(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(/[\s,，、]+/);
  return [...new Set(list.map((t) => cleanText(t, 24).replace(/^#+/, '')).filter(Boolean))].slice(0, 8);
}

function normalizeProject(raw, now = Date.now()) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const name = cleanText(p.name, 40);
  if (!name) return null;
  const progress = numOrNull(p.progress, { min: 0, max: 100, digits: 0 });
  const weekly = numOrNull(p.weeklyGoalHours, { min: 0, max: 80, digits: 1 });
  return {
    id: typeof p.id === 'string' && /^[\w-]{2,64}$/.test(p.id) ? p.id : uid('p'),
    name,
    color: pickColor(p.color),
    status: STATUSES.includes(p.status) ? p.status : 'active',
    note: cleanText(p.note, 400),
    weeklyGoalHours: weekly == null ? 8 : weekly,
    startDate: dateKey(p.startDate),
    dueDate: dateKey(p.dueDate),
    progress: progress == null ? 0 : Math.round(progress),
    order: Number.isFinite(Number(p.order)) ? Number(p.order) : 0,
    createdAt: Number(p.createdAt) || now,
    updatedAt: now,
  };
}

function normalizeEntry(raw, now = Date.now(), defaults = {}) {
  const e = raw && typeof raw === 'object' ? raw : {};
  const title = cleanText(e.title, 80);
  if (!title) return null;
  const date = dateKey(e.date) || dateKey(defaults.date) || null;
  if (!date) return null;
  const minutes = numOrNull(e.minutes, { min: 0, max: 24 * 60, digits: 0 });
  return {
    id: typeof e.id === 'string' && /^[\w-]{2,64}$/.test(e.id) ? e.id : uid('e'),
    date,
    title,
    projectId: typeof e.projectId === 'string' && /^[\w-]{2,64}$/.test(e.projectId) ? e.projectId : null,
    minutes: minutes == null ? (Number(defaults.minutes) || 120) : Math.round(minutes),
    status: ENTRY_STATUSES.includes(e.status) ? e.status : 'done',
    priority: PRIORITIES.includes(Number(e.priority)) ? Number(e.priority) : 0,
    tags: normalizeTags(e.tags),
    note: cleanText(e.note, 4000),
    subtasks: normalizeSubtasks(e.subtasks),
    attachmentIds: Array.isArray(e.attachmentIds)
      ? [...new Set(e.attachmentIds.filter((x) => typeof x === 'string' && /^[\w-]{2,64}$/.test(x)))].slice(0, 12)
      : [],
    deletedAt: Number(e.deletedAt) || null,
    createdAt: Number(e.createdAt) || now,
    updatedAt: now,
  };
}

function normalizeDayLog(raw, now = Date.now()) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const date = dateKey(d.date);
  if (!date) return null;
  const summary = cleanText(d.summary, 4000);
  return { date, summary, updatedAt: now };
}

function normalizeTemplate(raw, now = Date.now()) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const name = cleanText(t.name, 20);
  const title = cleanText(t.title, 80);
  if (!name || !title) return null;
  const minutes = numOrNull(t.minutes, { min: 0, max: 24 * 60, digits: 0 });
  return {
    id: typeof t.id === 'string' && /^[\w-]{2,64}$/.test(t.id) ? t.id : uid('t'),
    name,
    title,
    projectId: typeof t.projectId === 'string' && /^[\w-]{2,64}$/.test(t.projectId) ? t.projectId : null,
    minutes: minutes == null ? 60 : Math.round(minutes),
    tags: normalizeTags(t.tags),
    subtasks: normalizeSubtasks(t.subtasks).map((s) => s.text),
    useCount: Number(t.useCount) || 0,
    createdAt: Number(t.createdAt) || now,
  };
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const SETTINGS_DEFAULTS = {
  theme: 'dark',
  accent: 'teal',
  density: 'cozy',
  fontScale: 1,
  weekStart: 1,
  dailyGoalHours: 6,
  defaultProjectId: null,
  defaultMinutes: 120,
  reduceMotion: false,
  showWeekNumbers: false,
  snapshotHours: 12,
  attachmentLimitMB: 200,
  startView: 'today',
  welcomeDone: false,
};

function normalizeSettings(raw, base = SETTINGS_DEFAULTS) {
  const s = { ...base, ...(raw && typeof raw === 'object' ? raw : {}) };
  const fontScale = numOrNull(s.fontScale, { min: 0.85, max: 1.25, digits: 2 });
  const goal = numOrNull(s.dailyGoalHours, { min: 1, max: 24, digits: 1 });
  const defMinutes = numOrNull(s.defaultMinutes, { min: 15, max: 720, digits: 0 });
  const limit = numOrNull(s.attachmentLimitMB, { min: 50, max: 2048, digits: 0 });
  return {
    theme: THEMES.includes(s.theme) ? s.theme : SETTINGS_DEFAULTS.theme,
    accent: ACCENTS.includes(s.accent) ? s.accent : SETTINGS_DEFAULTS.accent,
    density: DENSITIES.includes(s.density) ? s.density : SETTINGS_DEFAULTS.density,
    fontScale: fontScale == null ? 1 : fontScale,
    weekStart: Number(s.weekStart) === 0 ? 0 : 1,
    dailyGoalHours: goal == null ? 6 : goal,
    defaultProjectId: typeof s.defaultProjectId === 'string' && /^[\w-]{2,64}$/.test(s.defaultProjectId)
      ? s.defaultProjectId : null,
    defaultMinutes: defMinutes == null ? 120 : Math.round(defMinutes),
    reduceMotion: Boolean(s.reduceMotion),
    showWeekNumbers: Boolean(s.showWeekNumbers),
    snapshotHours: SNAPSHOT_HOURS.includes(Number(s.snapshotHours)) ? Number(s.snapshotHours) : 12,
    attachmentLimitMB: limit == null ? 200 : Math.round(limit),
    startView: START_VIEWS.includes(s.startView) ? s.startView : 'today',
    welcomeDone: Boolean(s.welcomeDone),
  };
}

/** 归一化一个附件条目（文件本身在 media/ 下，由 media 模块管理） */
function normalizeAttachment(raw, now = Date.now()) {
  const a = raw && typeof raw === 'object' ? raw : {};
  if (typeof a.rel !== 'string' || !a.rel || a.rel.includes('..')) return null;
  return {
    id: typeof a.id === 'string' && /^[\w-]{2,64}$/.test(a.id) ? a.id : uid('a'),
    entryId: typeof a.entryId === 'string' && /^[\w-]{2,64}$/.test(a.entryId) ? a.entryId : null,
    date: dateKey(a.date),
    name: cleanText(a.name, 80) || '附件',
    mime: cleanText(a.mime, 100) || 'application/octet-stream',
    size: Math.max(0, Math.trunc(Number(a.size) || 0)),
    rel: a.rel,
    thumbRel: typeof a.thumbRel === 'string' && !a.thumbRel.includes('..') ? a.thumbRel : null,
    w: Math.max(0, Math.trunc(Number(a.w) || 0)),
    h: Math.max(0, Math.trunc(Number(a.h) || 0)),
    createdAt: Number(a.createdAt) || now,
  };
}

const attachmentView = (a) => ({
  id: a.id,
  entryId: a.entryId,
  date: a.date,
  name: a.name,
  mime: a.mime,
  size: a.size,
  url: `/media/${a.rel}`,
  thumbUrl: a.thumbRel ? `/media/${a.thumbRel}` : null,
  w: a.w,
  h: a.h,
  createdAt: a.createdAt,
});

const projectView = (p, extra = {}) => ({ ...p, ...extra });
const entryView = (e, extra = {}) => ({ ...e, hours: round1((e.minutes || 0) / 60), ...extra });

module.exports = {
  STATUSES,
  ENTRY_STATUSES,
  PRIORITIES,
  THEMES,
  DENSITIES,
  ACCENTS,
  PROJECT_COLORS,
  uid,
  dateKey,
  normalizeSubtasks,
  normalizeTags,
  normalizeProject,
  normalizeEntry,
  normalizeDayLog,
  normalizeTemplate,
  normalizeSettings,
  normalizeAttachment,
  attachmentView,
  projectView,
  entryView,
  clamp,
  SETTINGS_DEFAULTS,
};