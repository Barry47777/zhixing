/**
 * 知行 · 浏览器版数据层
 * 内存 db + IndexedDB 持久化（替代服务端 store.js 的原子文件写入）
 */

import { normalizeZone, normalizeStage, normalizeGrowth } from './lib/constants.js';

const DB_VERSION = 2;
const STORE = 'kv';
const KEY = 'workspace';
const uid = (p: string) => `${p}_${(globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/-/g, '').slice(0, 16)}`;

export interface Workspace {
  version: number;
  savedAt: number;
  createdAt: number;
  meta: { nextSeq: number; demoAt: number; clearedAt: number; lastSnapshotAt: number; lastIntervalAt: number };
  settings: any;
  notes: any[];
  projects: any[];
  entries: any[];
  days: any[];
  templates: any[];
  attachments: any[];
}

const SETTINGS_DEFAULTS: any = {
  theme: 'dark', accent: 'teal', density: 'cozy', fontScale: 1, weekStart: 1,
  dailyGoalHours: 6, defaultProjectId: null, defaultMinutes: 120,
  reduceMotion: false, showWeekNumbers: false, snapshotHours: 12,
  attachmentLimitMB: 200, startView: 'today', welcomeDone: false,
};

export function normalizeSettings(raw: any, base = SETTINGS_DEFAULTS): any {
  const out = { ...base };
  if (!raw || typeof raw !== 'object') return out;
  if (['dark', 'light', 'system'].includes(raw.theme)) out.theme = raw.theme;
  if (typeof raw.accent === 'string') out.accent = raw.accent;
  if (['cozy', 'compact'].includes(raw.density)) out.density = raw.density;
  out.fontScale = clamp(num(raw.fontScale, 1), 0.8, 1.4);
  out.weekStart = [0, 1].includes(raw.weekStart) ? raw.weekStart : 1;
  out.dailyGoalHours = clamp(num(raw.dailyGoalHours, 6), 0, 24);
  out.defaultProjectId = typeof raw.defaultProjectId === 'string' ? raw.defaultProjectId : null;
  out.defaultMinutes = clamp(num(raw.defaultMinutes, 120), 5, 480);
  out.reduceMotion = !!raw.reduceMotion;
  out.showWeekNumbers = !!raw.showWeekNumbers;
  out.snapshotHours = clamp(num(raw.snapshotHours, 12), 1, 720);
  out.attachmentLimitMB = clamp(num(raw.attachmentLimitMB, 200), 1, 2000);
  if (typeof raw.startView === 'string') out.startView = raw.startView;
  out.welcomeDone = !!raw.welcomeDone;
  return out;
}

export function blankWorkspace(): Workspace {
  return {
    version: DB_VERSION,
    savedAt: 0,
    createdAt: Date.now(),
    meta: { nextSeq: 1, demoAt: 0, clearedAt: 0, lastSnapshotAt: 0, lastIntervalAt: 0 },
    settings: normalizeSettings({}),
    notes: [],
    projects: [],
    entries: [],
    days: [],
    templates: [],
    attachments: [],
  };
}

let db: Workspace = blankWorkspace();
let booted = false;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('zhixing-web', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<Workspace | null> {
  try {
    const d = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as Workspace) || null);
      req.onerror = () => reject(req.error);
    });
  } catch (_) {
    return null;
  }
}

let saveChain: Promise<void> = Promise.resolve();
async function idbSet(data: Workspace): Promise<void> {
  const d = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(data, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 串行持久化，保证写入顺序 */
export function persist(): Promise<void> {
  db.savedAt = Date.now();
  const snapshot = JSON.parse(JSON.stringify(db)) as Workspace;
  saveChain = saveChain.then(() => idbSet(snapshot)).catch((err) => {
    console.error('[知行] 保存失败', err);
  });
  return saveChain;
}

export function getDb(): Workspace { return db; }
export function replaceDb(next: Workspace) { db = normalizeWorkspace(next); }
export function isBooted() { return booted; }

export async function load(): Promise<void> {
  if (booted) return;
  const raw = await idbGet();
  db = raw ? normalizeWorkspace(raw) : blankWorkspace();
  booted = true;
  if (!raw) {
    const { seedDemo } = await import('./demo');
    seedDemo({
      db,
      uid,
      normalizeProject,
      normalizeEntry,
      normalizeDayLog,
      normalizeTemplate,
      normalizeNote,
    });
    await persist();
  }
}

// ---------------------------------------------------------------- 规范化

function num(v: any, def = 0) { const n = Number(v); return Number.isFinite(n) ? n : def; }
function cleanText(v: any) { return typeof v === 'string' ? v.trim() : ''; }
function dateKey(v: any) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = v ? new Date(v) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function clamp(v: number, a: number, b: number) { return Math.min(b, Math.max(a, v)); }

function normalizeProject(raw: any, now = Date.now()) {
  return {
    id: raw.id || uid('p'),
    name: cleanText(raw.name) || '未命名项目',
    color: /^#[0-9a-f]{6}$/i.test(raw.color || '') ? raw.color : '#5b8def',
    status: ['active', 'paused', 'done', 'archived'].includes(raw.status) ? raw.status : 'active',
    note: cleanText(raw.note),
    weeklyGoalHours: clamp(num(raw.weeklyGoalHours), 0, 200),
    startDate: raw.startDate ? dateKey(raw.startDate) : null,
    dueDate: raw.dueDate ? dateKey(raw.dueDate) : null,
    progress: clamp(num(raw.progress), 0, 100),
    order: num(raw.order, now),
    createdAt: num(raw.createdAt, now),
    updatedAt: num(raw.updatedAt, now),
  };
}

function normalizeEntry(raw: any, now = Date.now(), defaults: any = {}) {
  const subtasks = Array.isArray(raw.subtasks)
    ? raw.subtasks.map((s: any) => ({ id: s.id || uid('s'), text: cleanText(s.text), done: !!s.done })).filter((s: any) => s.text)
    : [];
  return {
    id: raw.id || uid('e'),
    date: dateKey(raw.date || defaults.date),
    title: cleanText(raw.title) || '未命名记录',
    projectId: raw.projectId || null,
    minutes: clamp(num(raw.minutes, num(defaults.minutes, 0)), 0, 24 * 60),
    status: ['todo', 'doing', 'done', 'skipped'].includes(raw.status) ? raw.status : 'done',
    priority: clamp(num(raw.priority), 0, 3),
    tags: Array.isArray(raw.tags) ? [...new Set(raw.tags.filter((t: any) => typeof t === 'string' && t.trim()).map((t: string) => t.trim().slice(0, 30)))].slice(0, 20) : [],
    note: typeof raw.note === 'string' ? raw.note : '',
    subtasks,
    attachmentIds: Array.isArray(raw.attachmentIds) ? raw.attachmentIds.filter((x: any) => typeof x === 'string') : [],
    deletedAt: raw.deletedAt ? num(raw.deletedAt) : null,
    createdAt: num(raw.createdAt, now),
    updatedAt: num(raw.updatedAt, now),
  };
}

function normalizeDayLog(raw: any, now = Date.now()) {
  return { date: dateKey(raw.date), summary: typeof raw.summary === 'string' ? raw.summary : '', updatedAt: num(raw.updatedAt, now) };
}

function normalizeTemplate(raw: any, now = Date.now()) {
  return {
    id: raw.id || uid('t'),
    name: cleanText(raw.name) || '未命名模板',
    title: cleanText(raw.title) || '未命名记录',
    projectId: raw.projectId || null,
    minutes: clamp(num(raw.minutes), 0, 24 * 60),
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t: any) => typeof t === 'string') : [],
    subtasks: Array.isArray(raw.subtasks) ? raw.subtasks.filter((s: any) => typeof s === 'string') : [],
    useCount: num(raw.useCount),
    createdAt: num(raw.createdAt, now),
  };
}

function normalizeNote(raw: any, now = Date.now(), seq = 1) {
  const zone = normalizeZone(raw.zone) || 'inspiration';
  const content = typeof raw.content === 'string' ? raw.content : '';
  return {
    id: raw.id || uid('n'),
    seq: num(raw.seq, seq),
    zone,
    type: ['review', 'strategy', 'insight', 'idea'].includes(raw.type) ? raw.type : 'idea',
    stage: normalizeStage(raw.stage, zone),
    content,
    seen: typeof raw.seen === 'string' ? raw.seen : '',
    think: typeof raw.think === 'string' ? raw.think : '',
    bet: raw.bet && typeof raw.bet === 'object' ? {
      conf: raw.bet.conf == null ? null : clamp(num(raw.bet.conf), 0, 100),
      horizon: ['short', 'mid', 'long'].includes(raw.bet.horizon) ? raw.bet.horizon : null,
      invalid: !!raw.bet.invalid,
    } : { conf: null, horizon: null, invalid: false },
    did: ['acted', 'skipped', 'none'].includes(raw.did) ? raw.did : 'none',
    skipReason: typeof raw.skipReason === 'string' ? raw.skipReason : '',
    trade: raw.trade && typeof raw.trade === 'object' ? { ...raw.trade } : null,
    result: raw.result && typeof raw.result === 'object' ? { outcome: raw.result.outcome || '', note: raw.result.note || '', at: num(raw.result.at, now) } : null,
    callRight: raw.callRight || null,
    after: raw.after && typeof raw.after === 'object' ? { text: raw.after.text || '', at: num(raw.after.at, now) } : null,
    growth: normalizeGrowth(raw.growth),
    growthAt: raw.growthAt ? num(raw.growthAt) : null,
    triage: raw.triage === 'filed' ? 'filed' : 'inbox',
    derivedFrom: raw.derivedFrom || null,
    projectId: raw.projectId || null,
    entryId: raw.entryId || null,
    frozen: !!raw.frozen,
    revisions: Array.isArray(raw.revisions) ? raw.revisions.slice(-30) : [],
    review: raw.review && typeof raw.review === 'object' ? { ...raw.review } : null,
    legacy: !!raw.legacy,
    images: Array.isArray(raw.images) ? raw.images.filter((i: any) => i && typeof i.url === 'string').map((i: any) => ({ url: i.url, w: num(i.w), h: num(i.h) })) : [],
    comments: Array.isArray(raw.comments) ? raw.comments.filter((c: any) => c && typeof c.text === 'string').map((c: any) => ({ id: c.id || uid('c'), text: c.text, at: num(c.at, now) })).slice(-300) : [],
    tags: Array.isArray(raw.tags) ? [...new Set(raw.tags.filter((t: any) => typeof t === 'string' && t.trim()).map((t: string) => t.trim().slice(0, 30)))].slice(0, 20) : [],
    pinned: !!raw.pinned,
    createdAt: num(raw.createdAt, now),
    updatedAt: num(raw.updatedAt, now),
  };
}

function normalizeAttachment(raw: any, now = Date.now()) {
  return {
    id: raw.id || uid('a'),
    entryId: raw.entryId || null,
    date: raw.date ? dateKey(raw.date) : null,
    name: cleanText(raw.name) || '附件',
    mime: cleanText(raw.mime) || 'application/octet-stream',
    size: num(raw.size),
    data: typeof raw.data === 'string' ? raw.data : '',
    thumb: typeof raw.thumb === 'string' ? raw.thumb : '',
    w: num(raw.w),
    h: num(raw.h),
    createdAt: num(raw.createdAt, now),
  };
}

export function normalizeWorkspace(raw: any): Workspace {
  const base = blankWorkspace();
  if (!raw || typeof raw !== 'object') return base;
  const now = Date.now();
  const projects = (Array.isArray(raw.projects) ? raw.projects : []).map((p: any) => normalizeProject(p, now)).sort((a: any, b: any) => a.order - b.order);
  const notes = (Array.isArray(raw.notes) ? raw.notes : []).map((n: any, i: number) => normalizeNote(n, now, i + 1));
  const maxSeq = notes.reduce((m: number, n: any) => Math.max(m, n.seq || 0), 0);
  return {
    version: DB_VERSION,
    savedAt: num(raw.savedAt),
    createdAt: num(raw.createdAt, now),
    meta: { ...base.meta, ...(raw.meta || {}), nextSeq: Math.max(num(raw.meta?.nextSeq, 1), maxSeq + 1) },
    settings: normalizeSettings(raw.settings || {}),
    notes,
    projects,
    entries: (Array.isArray(raw.entries) ? raw.entries : []).map((e: any) => normalizeEntry(e, now)),
    days: (Array.isArray(raw.days) ? raw.days : []).map((d: any) => normalizeDayLog(d, now)),
    templates: (Array.isArray(raw.templates) ? raw.templates : []).map((t: any) => normalizeTemplate(t, now)),
    attachments: (Array.isArray(raw.attachments) ? raw.attachments : []).map((a: any) => normalizeAttachment(a, now)),
  };
}

export { uid, dateKey, cleanText, num, clamp, normalizeProject, normalizeEntry, normalizeDayLog, normalizeTemplate, normalizeNote, normalizeAttachment };
