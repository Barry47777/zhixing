'use strict';

/**
 * 知行 · 通用路由：健康检查、枚举、设置、今日概览、全局搜索、工作统计、洞察组合。
 * 契约见 docs/API.md 第 0 / 4 节。
 */

const C = require('../lib/constants');
const transfer = require('../lib/transfer');
const review = require('../lib/review');
const store = require('../store');
const N = require('../models/notes');
const M = require('../models/work');
const { sendJson, sendError, readBody, dayKey, dayStart, cleanText, round1 } = require('../util');
const notesRoutes = require('./notes');

const int = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};
const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const shiftDay = (key, n) => dayKey(new Date((dayStart(key) || 0) + n * 864e5));
const shiftKey = (key, days) => {
  const t = dayStart(key);
  if (t == null) return key;
  return dayKey(new Date(t - days * 864e5 + 12 * 36e5));
};

/** 某天所在周的起始日（按设置的周起始） */
function weekStartOf(key, weekStart) {
  const t = dayStart(key);
  if (t == null) return null;
  const dow = new Date(t).getDay();
  return shiftKey(key, (dow - weekStart + 7) % 7);
}

function rangeKeys(from, to) {
  const list = [];
  const a = dayStart(from);
  const b = dayStart(to);
  if (a == null || b == null || b < a) return list;
  const n = Math.min(366, Math.round((b - a) / 864e5) + 1);
  for (let i = 0; i < n; i += 1) list.push(dayKey(new Date(a + i * 864e5 + 12 * 36e5)));
  return list;
}

const activeEntries = () => store.db.entries.filter((e) => !e.deletedAt);
const projectOf = (id) => store.db.projects.find((p) => p.id === id) || null;

function entryOut(e) {
  const p = projectOf(e.projectId);
  return M.entryView(e, {
    project: p ? { id: p.id, name: p.name, color: p.color } : null,
    attachments: (e.attachmentIds || [])
      .map((id) => store.db.attachments.find((a) => a.id === id))
      .filter(Boolean)
      .map(M.attachmentView),
  });
}

function projectOut(p) {
  return M.projectView(p, {
    entryCount: activeEntries().filter((e) => e.projectId === p.id).length,
    minutes: activeEntries().filter((e) => e.projectId === p.id).reduce((s, e) => s + (e.minutes || 0), 0),
  });
}

function noteOut(n) {
  const view = n.zone === 'inspiration' ? N.toZoneNote(n, 'inspiration') : { ...n };
  if (n.zone === 'review') view.incomplete = review.incompleteOf(n);
  return view;
}

function statsForRange(from, to) {
  const days = rangeKeys(from, to);
  const inRange = activeEntries().filter((e) => e.date >= from && e.date <= to);
  const totalMinutes = inRange.reduce((s, e) => s + (e.minutes || 0), 0);
  const hoursByDay = {};
  for (const key of days) hoursByDay[key] = 0;
  for (const e of inRange) hoursByDay[e.date] = round1((hoursByDay[e.date] || 0) + (e.minutes || 0) / 60);
  const dayCount = days.filter((k) => hoursByDay[k] > 0).length;

  const pMap = new Map();
  for (const e of inRange) {
    const key = e.projectId || '__none';
    const cur = pMap.get(key) || { id: e.projectId || null, name: '', color: '', minutes: 0, count: 0 };
    const p = e.projectId ? projectOf(e.projectId) : null;
    cur.name = p ? p.name : '未分类';
    cur.color = p ? p.color : '';
    cur.minutes += e.minutes || 0;
    cur.count += 1;
    pMap.set(key, cur);
  }
  const byProject = [...pMap.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .map((p) => ({ ...p, minutes: Math.round(p.minutes), share: totalMinutes ? Math.round((p.minutes / totalMinutes) * 100) / 100 : 0 }));

  const heatmap = days.map((key) => {
    const hours = round1(hoursByDay[key] || 0);
    const level = hours >= 6 ? 4 : hours >= 4 ? 3 : hours >= 2 ? 2 : hours > 0 ? 1 : 0;
    return { key, hours, level };
  });

  // 近 8 周（以 to 所在周的周一/周日起算）
  const weekStart = store.db.settings.weekStart === 0 ? 0 : 1;
  const weekly = [];
  const endWeek = weekStartOf(to, weekStart);
  for (let w = 7; w >= 0; w -= 1) {
    const start = shiftKey(endWeek, w * 7);
    const keys = rangeKeys(start, shiftKey(start, -6));
    const dayHours = keys.map((k) => round1(hoursByDay[k] || 0));
    weekly.push({
      start,
      label: `${Number(start.slice(5, 7))}/${Number(start.slice(8, 10))}`,
      hours: round1(dayHours.reduce((s, h) => s + h, 0)),
      days: dayHours,
    });
  }

  const tagMap = new Map();
  for (const e of inRange) {
    for (const t of e.tags || []) {
      const cur = tagMap.get(t) || { tag: t, count: 0, minutes: 0 };
      cur.count += 1;
      cur.minutes += e.minutes || 0;
      tagMap.set(t, cur);
    }
  }

  const todayKey = dayKey();
  let streakDays = 0;
  let cursor = todayKey;
  if (!activeEntries().some((e) => e.date === cursor)) cursor = shiftDay(cursor, -1);
  while (activeEntries().some((e) => e.date === cursor) && streakDays < 3650) {
    streakDays += 1;
    cursor = shiftDay(cursor, -1);
  }

  const len = Math.max(1, days.length);
  const prevTo = shiftKey(from, 1);
  const prevFrom = rangeKeys(prevTo, prevTo).length ? shiftKey(from, len) : from;
  const prevKeys = rangeKeys(prevFrom, shiftKey(from, 1));
  const prevEntries = activeEntries().filter((e) => e.date >= prevFrom && e.date < from);
  const prevMinutes = prevEntries.reduce((s, e) => s + (e.minutes || 0), 0);
  const prevActive = new Set(prevEntries.map((e) => e.date)).size;
  const prevHours = round1(prevMinutes / 60);

  const hours = round1(totalMinutes / 60);
  return {
    from,
    to,
    totalHours: hours,
    entryCount: inRange.length,
    dayCount,
    avgPerActiveDay: dayCount ? round1(hours / dayCount) : 0,
    avgPerDay: round1(hours / len),
    doneCount: inRange.filter((e) => e.status === 'done').length,
    doingCount: inRange.filter((e) => e.status === 'doing').length,
    blockedCount: inRange.filter((e) => e.status === 'blocked').length,
    hoursByDay,
    byProject,
    heatmap,
    weekly,
    streakDays,
    topEntries: [...inRange].sort((a, b) => (b.minutes || 0) - (a.minutes || 0)).slice(0, 6).map(entryOut),
    tags: [...tagMap.values()].sort((a, b) => b.minutes - a.minutes).map((t) => ({ ...t, minutes: Math.round(t.minutes) })),
    monthCompare: {
      hours,
      prevHours,
      deltaPct: prevHours ? Math.round(((hours - prevHours) / prevHours) * 1000) / 10 : null,
      activeDays: dayCount,
      prevActiveDays: prevActive,
      entries: inRange.length,
      prevEntries: prevEntries.length,
      done: inRange.filter((e) => e.status === 'done').length,
      prevDone: prevEntries.filter((e) => e.status === 'done').length,
      avg: dayCount ? round1(hours / dayCount) : 0,
      prevAvg: prevActive ? round1(prevHours / prevActive) : 0,
    },
  };
}

function overview(dateParam) {
  const db = store.db;
  const key = M.dateKey(dateParam) || dayKey();
  const todayEntries = activeEntries().filter((e) => e.date === key);
  const minutes = todayEntries.reduce((s, e) => s + (e.minutes || 0), 0);
  const weekStart = db.settings.weekStart === 0 ? 0 : 1;
  const start = weekStartOf(key, weekStart);
  const weekKeys = rangeKeys(start, shiftKey(start, -6));
  const weekEntries = activeEntries().filter((e) => e.date >= start && e.date <= shiftKey(start, -6));
  const weekMinutes = weekEntries.reduce((s, e) => s + (e.minutes || 0), 0);
  const daily = weekKeys.map((k) => activeEntries().filter((e) => e.date === k).reduce((s, e) => s + (e.minutes || 0), 0));
  const labels = weekKeys.map((k) => WEEK_CN[(new Date(dayStart(k)).getDay() + 0) % 7]);

  const notes = db.notes;
  const todayNotes = notes.filter((n) => (n.createdAt || 0) >= dayStart(key) && (n.createdAt || 0) < dayStart(key) + 864e5);
  const weekNotes = notes.filter((n) => (n.createdAt || 0) >= dayStart(start));
  const recent = [...notes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6).map(noteOut);
  const pending = notes.filter((n) => n.zone === 'review' && review.incompleteOf(n).length > 0).length;

  const projects = db.projects.filter((p) => p.status !== 'archived');
  const dueProjects = projects
    .filter((p) => p.dueDate)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
    .slice(0, 5)
    .map(projectOut);

  const tagMap = new Map();
  for (const e of activeEntries().filter((x) => x.date === key)) {
    for (const t of e.tags || []) tagMap.set(t, (tagMap.get(t) || 0) + 1);
  }

  const pool = notes.filter((n) => n.zone === 'review');
  const picked = review.pickDailyCard(pool, Date.now());

  return {
    date: key,
    today: {
      minutes,
      hours: round1(minutes / 60),
      entryCount: todayEntries.length,
      doneCount: todayEntries.filter((e) => e.status === 'done').length,
      goalHours: db.settings.dailyGoalHours,
      entries: todayEntries.map(entryOut),
    },
    week: {
      start,
      minutes: weekMinutes,
      hours: round1(weekMinutes / 60),
      activeDays: new Set(weekEntries.map((e) => e.date)).size,
      entries: weekEntries.length,
      labels,
      daily: daily.map((m) => round1(m / 60)),
    },
    streakDays: statsForRange(shiftKey(key, -29), key).streakDays,
    notes: {
      today: todayNotes.length,
      week: weekNotes.length,
      inbox: notes.filter((n) => n.triage === 'inbox').length,
      recent,
    },
    review: {
      pending,
      dueProject: dueProjects.filter((p) => p.dueDate <= shiftKey(key, -0)),
      blindCard: picked.card ? review.toBlindCard(picked.card, Date.now()) : null,
    },
    projects: projects.slice(0, 5).map(projectOut),
    tags: [...tagMap.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count),
    nextDue: dueProjects,
  };
}

async function handle(req, res, pathname, query) {
  const db = store.db;

  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      app: 'zhixing',
      version: db.version,
      pid: process.pid,
      dataDir: require('../config').DATA_DIR,
      notes: db.notes.length,
      entries: db.entries.filter((e) => !e.deletedAt).length,
      projects: db.projects.length,
      lastWriteError: store.lastWriteError,
      demo: !!db.meta.demoAt,
      serverTime: Date.now(),
    }), true;
  }

  if (pathname === '/api/demo/clear' && req.method === 'POST') {
    if (!db.meta.demoAt) return sendError(res, 400, '现在没有演示数据'), true;
    const before = {
      notes: db.notes,
      projects: db.projects,
      entries: db.entries,
      days: db.days,
      templates: db.templates,
      attachments: db.attachments,
      nextSeq: db.meta.nextSeq,
      demoAt: db.meta.demoAt,
      clearedAt: db.meta.clearedAt,
    };
    try {
      await store.createSnapshot('pre-clear-demo');
    } catch (err) {
      /* 快照失败不阻断清空，但留下记录 */
      require('../util').logError('demo-snapshot', err);
    }
    db.notes = [];
    db.projects = [];
    db.entries = [];
    db.days = [];
    db.templates = [];
    db.attachments = [];
    db.meta.nextSeq = 1;
    db.meta.demoAt = 0;
    db.meta.clearedAt = Date.now();
    const ok = await store.commit(res, () => {
      db.notes = before.notes;
      db.projects = before.projects;
      db.entries = before.entries;
      db.days = before.days;
      db.templates = before.templates;
      db.attachments = before.attachments;
      db.meta.nextSeq = before.nextSeq;
      db.meta.demoAt = before.demoAt;
      db.meta.clearedAt = before.clearedAt;
    });
    if (!ok) return true;
    return sendJson(res, 200, { ok: true, cleared: true }), true;
  }

  if (pathname === '/api/enums' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      zones: C.ZONES,
      types: Object.keys(transfer.TYPES),
      stages: C.STAGES,
      dids: C.DIDS,
      outcomes: C.OUTCOMES,
      growths: C.GROWTHS,
      sides: C.SIDES,
      horizons: C.HORIZONS,
      mistakes: C.MISTAKES,
      stateTags: C.STATE_TAGS,
      baseTag: '底线',
      tagsMax: C.TAGS_MAX,
      accents: M.ACCENTS,
      themes: M.THEMES,
      densities: M.DENSITIES,
      entryStatuses: M.ENTRY_STATUSES,
      priorities: M.PRIORITIES,
      startViews: M.START_VIEWS,
      snapshotHours: M.SNAPSHOT_HOURS,
      projectColors: M.PROJECT_COLORS,
      weekStart: db.settings.weekStart,
    }), true;
  }

  if (pathname === '/api/settings') {
    if (req.method === 'GET') return sendJson(res, 200, { ok: true, settings: db.settings }), true;
    if (req.method === 'PUT') {
      let body;
      try { body = await readBody(req); } catch (e) { sendError(res, 400, e.message); return true; }
      const prev = { ...db.settings };
      db.settings = M.normalizeSettings({ ...db.settings, ...(body || {}) });
      if (!(await store.commit(res, () => { db.settings = prev; }))) return true;
      return sendJson(res, 200, { ok: true, settings: db.settings }), true;
    }
    sendError(res, 405, 'method not allowed');
    return true;
  }

  if (pathname === '/api/overview' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, ...overview(cleanText(query.get('date'), 10)) }), true;
  }

  if (pathname === '/api/search' && req.method === 'GET') {
    const q = cleanText(query.get('q'), 200).toLowerCase();
    const limit = Math.min(30, Math.max(1, int(query.get('limit'), 8)));
    if (!q) return sendJson(res, 200, { ok: true, q: '', notes: [], entries: [], projects: [], templates: [], total: 0 }), true;
    const notes = db.notes.filter((n) => notesRoutes.noteMatches(n, q)).slice(0, limit).map(noteOut);
    const entries = activeEntries().filter((e) => {
      const p = projectOf(e.projectId);
      return [e.title, e.note, (e.tags || []).join(' '), (e.subtasks || []).map((s) => s.text).join(' '), p ? p.name : '']
        .join('\n').toLowerCase().includes(q);
    }).slice(0, limit).map(entryOut);
    const projects = db.projects.filter((p) => [p.name, p.note].join('\n').toLowerCase().includes(q)).slice(0, limit).map(projectOut);
    const templates = db.templates
      .filter((t) => [t.name, t.title, (t.tags || []).join(' ')].join('\n').toLowerCase().includes(q))
      .slice(0, limit)
      .map((t) => ({ ...t, projectName: (projectOf(t.projectId) || {}).name || '' }));
    return sendJson(res, 200, {
      ok: true, q,
      notes, entries, projects, templates,
      total: notes.length + entries.length + projects.length + templates.length,
    }), true;
  }

  if (pathname === '/api/stats/work' && req.method === 'GET') {
    const to = M.dateKey(query.get('to')) || dayKey();
    const from = M.dateKey(query.get('from')) || shiftKey(to, 29);
    return sendJson(res, 200, { ok: true, ...statsForRange(from, to) }), true;
  }

  if (pathname === '/api/insights' && req.method === 'GET') {
    const to = M.dateKey(query.get('to')) || dayKey();
    const from = M.dateKey(query.get('from')) || shiftKey(to, 29);
    const work = statsForRange(from, to);
    const zone = C.ZONES.includes(cleanText(query.get('zone'), 20)) ? cleanText(query.get('zone'), 20) : 'review';
    const scoped = db.notes.filter((n) => n.zone === 'review');
    return sendJson(res, 200, {
      ok: true,
      work,
      notes: { ok: true, ...notesRoutes.statsFor(zone) },
      ruler: {
        verdicts: review.verdictStats(scoped, Date.now()),
        calibration: review.calibration(scoped, Date.now()),
        skipped: review.skippedStats(scoped, Date.now()),
        funnel: review.funnel(scoped),
        mistakes: review.mistakeStats(scoped),
        callHit: review.callHitStats(scoped),
        growth: review.growthStats(scoped),
        execution: review.executionStats(scoped),
      },
    }), true;
  }

  return false;
}

module.exports = { handle, overview, statsForRange, entryOut, projectOut, noteOut };