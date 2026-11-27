/**
 * 知行 · 浏览器虚拟后端
 * 拦截 /api/* 请求，在浏览器内完成路由与业务逻辑，替代 Node 服务端。
 */
import {
  getDb, persist, replaceDb, normalizeWorkspace, blankWorkspace, load, isBooted,
  uid, dateKey, cleanText, num, clamp,
  normalizeProject, normalizeEntry, normalizeDayLog, normalizeTemplate, normalizeNote,
} from './db';
import { seedDemo } from './demo';
import * as RT from './lib/richtext.js';
import * as LK from './lib/links.js';
import * as RV from './lib/review.js';
import * as C from './lib/constants.js';

export interface ApiResponse { ok: boolean; status?: number; [key: string]: any }

function ok(data: any = {}): ApiResponse { return { ok: true, ...data }; }
function fail(message: string, status = 400): ApiResponse { return { ok: false, error: message, status }; }
function commit(): void { void persist(); }

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
const dayStart = (key: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) return null;
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};
const daysBetween = (a: string, b: string) => Math.round(Math.abs((dayStart(b) || 0) - (dayStart(a) || 0)) / 864e5);

/** 把 note 转成带 refs/backrefs/incomplete 的视图 */
function noteView(note: any) {
  const db = getDb();
  const annotated = LK.annotate([note], db.notes) as any[];
  const view = annotated[0] || note;
  return { ...view, incomplete: RV.incompleteOf ? RV.incompleteOf(note) : [] };
}

function noteListOut(notes: any[]) {
  return notes.map((n) => ({ ...n, ...(({ refs, backrefs, ...rest }) => rest)(n as any) }));
}

function filterNotes(query: any) {
  let list = [...getDb().notes];
  const zone = query.zone;
  if (zone && zone !== 'all') list = list.filter((n) => n.zone === zone);
  if (query.type) list = list.filter((n) => n.type === query.type);
  if (query.stage) list = list.filter((n) => n.stage === query.stage);
  if (query.triage === 'inbox') list = list.filter((n) => n.triage === 'inbox');
  if (query.growth === 'pending') list = list.filter((n) => RV.growthPending && RV.growthPending(n));
  const q = String(query.q || '').trim().toLowerCase();
  if (q) {
    list = list.filter((n) => {
      const text = `${RT.htmlToText(n.content || '')} ${n.seen || ''} ${n.think || ''} ${(n.tags || []).join(' ')}`.toLowerCase();
      return text.includes(q);
    });
  }
  if (query.tag) list = list.filter((n) => (n.tags || []).includes(String(query.tag)));
  if (query.projectId) list = list.filter((n) => n.projectId === query.projectId);
  if (query.entryId) list = list.filter((n) => n.entryId === query.entryId);
  if (query.pinned) list = list.filter((n) => n.pinned);
  if (query.status === 'open') list = list.filter((n) => !n.result);
  if (query.status === 'settled') list = list.filter((n) => !!n.result);
  return list;
}

function sortNotes(list: any[]) {
  return [...list].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.createdAt || 0) - (a.createdAt || 0));
}

// ---------------------------------------------------------------- 统计

function statsForRange(from: string, to: string) {
  const db = getDb();
  const entries = db.entries.filter((e) => !e.deletedAt && e.date >= from && e.date <= to);
  const minutes = entries.reduce((s, e) => s + (e.minutes || 0), 0);
  const activeDays = new Set(entries.map((e) => e.date)).size;
  const byProject: Record<string, number> = {};
  entries.forEach((e) => { if (e.projectId) byProject[e.projectId] = (byProject[e.projectId] || 0) + (e.minutes || 0); });
  const weeks: Record<string, number> = {};
  entries.forEach((e) => {
    const d = new Date(e.date + 'T00:00:00');
    const weekKey = `${d.getFullYear()}-W${Math.ceil(((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 864e5 + 1) / 7)}`;
    weeks[weekKey] = (weeks[weekKey] || 0) + (e.minutes || 0);
  });
  return { entries: entries.length, minutes, hours: round1(minutes / 60), activeDays, byProject, weeks, done: entries.filter((e) => e.status === 'done').length };
}

function statsForZone(zone: string) {
  const db = getDb();
  const list = db.notes.filter((n) => !zone || zone === 'all' || n.zone === zone);
  const settled = list.filter((n) => n.result);
  const wins = settled.filter((n) => n.result?.outcome === 'win').length;
  return {
    total: list.length,
    inbox: list.filter((n) => n.triage === 'inbox').length,
    settled: settled.length,
    winRate: settled.length ? round1((wins / settled.length) * 100) : 0,
    byType: list.reduce((m: any, n) => { m[n.type] = (m[n.type] || 0) + 1; return m; }, {}),
    pnl: round2(list.reduce((s, n) => s + (num(n.trade?.pnl) || 0), 0)),
  };
}

function overview(date?: string) {
  const key = date || dateKey(new Date());
  const db = getDb();
  const entries = db.entries.filter((e) => !e.deletedAt && e.date === key);
  const minutes = entries.reduce((s, e) => s + (e.minutes || 0), 0);
  return {
    date: key,
    day: { date: key, summary: db.days.find((d) => d.date === key)?.summary || '' },
    entries,
    minutes,
    hours: round1(minutes / 60),
    goalHours: db.settings.dailyGoalHours || 6,
    notes: db.notes.filter((n) => n.zone === 'inspiration').slice(0, 20),
    projects: db.projects,
    activeProjects: db.projects.filter((p) => p.status === 'active'),
    recent: [...db.notes].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 12),
    counts: {
      entries: db.entries.filter((e) => !e.deletedAt).length,
      notes: db.notes.length,
      projects: db.projects.length,
      templates: db.templates.length,
    },
  };
}

// ---------------------------------------------------------------- 导出

function buildMarkdown(scope: string) {
  const db = getDb();
  const notes = scope === 'work' ? [] : db.notes;
  const entries = scope === 'notes' ? [] : db.entries.filter((e) => !e.deletedAt);
  const lines: string[] = ['# 知行工作台导出', '', `导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
  if (notes.length) {
    lines.push('## 笔记与复盘', '');
    notes.forEach((n) => {
      lines.push(`### ${RT.summary(RT.htmlToText(n.content || '') || n.seen || '未命名', 50)}`);
      lines.push(`- 类型：${n.type} · 区域：${n.zone}${n.stage ? ` · 阶段：${n.stage}` : ''}`);
      if (n.tags?.length) lines.push(`- 标签：${n.tags.join('、')}`);
      if (n.seen) lines.push(`- 看到：${n.seen}`);
      if (n.think) lines.push(`- 判断：${n.think}`);
      if (n.content) lines.push('', RT.htmlToMarkdown(n.content));
      if (n.result) lines.push(`- 结果：${n.result.outcome} ${n.result.note || ''}`);
      lines.push('');
    });
  }
  if (entries.length) {
    lines.push('## 工作记录', '');
    const byDate: Record<string, any[]> = {};
    entries.forEach((e) => { (byDate[e.date] ||= []).push(e); });
    Object.keys(byDate).sort().reverse().forEach((date) => {
      lines.push(`### ${date}`, '');
      byDate[date].forEach((e) => {
        const p = db.projects.find((x) => x.id === e.projectId);
        lines.push(`- ${e.title} · ${round1((e.minutes || 0) / 60)}h${p ? ` · ${p.name}` : ''}${e.note ? ` — ${e.note}` : ''}`);
      });
      lines.push('');
    });
  }
  return lines.join('\n');
}

function exportData(format: string, scope: string) {
  const db = getDb();
  if (format === 'json' || format === 'backup') {
    return { filename: `zhixing-backup-${dateKey(new Date())}.json`, data: JSON.stringify({ app: 'zhixing', version: 2, exportedAt: Date.now(), workspace: db }, null, 2), mime: 'application/json' };
  }
  return { filename: `zhixing-${scope}-${dateKey(new Date())}.md`, data: buildMarkdown(scope), mime: 'text/markdown' };
}

// ---------------------------------------------------------------- 路由

export async function apiRequest(method: string, path: string, query: Record<string, any>, body: any): Promise<ApiResponse> {
  if (!isBooted()) await load();
  const db = getDb();

  // 健康与枚举
  if (path === '/api/health' && method === 'GET') {
    return ok({ app: 'zhixing', configured: true, authenticated: true, demo: !!db.meta.demoAt, notes: db.notes.length, entries: db.entries.length, projects: db.projects.length });
  }
  if (path === '/api/enums' && method === 'GET') {
    return ok({
      zones: C.ZONES, stages: C.STAGES, types: ['review', 'strategy', 'insight', 'idea'],
      mistakes: C.MISTAKES, mistakeGroups: C.MISTAKE_GROUPS, stateTags: C.STATE_TAGS,
      dids: C.DIDS, horizons: C.HORIZONS, outcomes: C.OUTCOMES, growths: C.GROWTHS, triages: C.TRIAGES, sides: C.SIDES,
    });
  }

  // 鉴权：网页版直接放行
  if (path.startsWith('/api/auth/')) {
    if (path === '/api/auth/status' || path === '/api/auth/check') return ok({ configured: true, authenticated: true, username: 'web' });
    return ok({});
  }

  // 设置
  if (path === '/api/settings') {
    if (method === 'GET') return ok({ settings: db.settings });
    if (method === 'PUT') {
      db.settings = { ...db.settings, ...(body || {}) };
      commit();
      return ok({ settings: db.settings });
    }
  }
  if (path === '/api/demo/clear' && method === 'POST') {
    const fresh = blankWorkspace();
    fresh.settings = db.settings;
    fresh.createdAt = db.createdAt;
    fresh.meta.clearedAt = Date.now();
    replaceDb(fresh);
    commit();
    return ok({});
  }
  if (path === '/api/overview' && method === 'GET') return ok(overview(query.date));
  if (path === '/api/search' && method === 'GET') {
    const q = String(query.q || '').toLowerCase();
    const limit = num(query.limit, 8);
    return ok({
      notes: db.notes.filter((n) => `${RT.htmlToText(n.content || '')} ${n.seen || ''} ${n.think || ''}`.toLowerCase().includes(q)).slice(0, limit),
      entries: db.entries.filter((e) => !e.deletedAt && e.title.toLowerCase().includes(q)).slice(0, limit),
      projects: db.projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, limit),
      templates: db.templates.filter((t) => t.name.toLowerCase().includes(q)).slice(0, limit),
    });
  }
  if (path === '/api/stats/work' && method === 'GET') return ok(statsForRange(query.from || '1970-01-01', query.to || '2999-12-31'));
  if (path === '/api/insights' && method === 'GET') {
    return ok({ work: statsForRange(query.from || '1970-01-01', query.to || '2999-12-31'), notes: statsForZone('all'), ruler: {} });
  }

  // 媒体上传：返回 data URL
  if (path === '/api/media' && method === 'POST') {
    const data = String(body?.data || '');
    if (!data.startsWith('data:image/')) return fail('图片格式不对');
    return ok({ image: { url: data, w: num(body.w), h: num(body.h) } });
  }

  // 笔记
  if (path === '/api/notes') {
    if (method === 'GET') {
      const list = sortNotes(filterNotes(query));
      return ok({ notes: list, total: list.length, desk: {} });
    }
    if (method === 'POST') {
      const content = RT.sanitizeHtml(String(body?.content || ''));
      const seen = cleanText(body?.seen);
      if (!RT.htmlToText(content).trim() && !seen) return fail('先写点什么');
      const seq = db.meta.nextSeq++;
      const note = normalizeNote({ ...body, content, seen, seq }, Date.now(), seq);
      note.id = uid('n');
      db.notes.push(note);
      commit();
      return ok({ note: noteView(note) });
    }
  }
  let m = path.match(/^\/api\/notes\/([^/]+)$/);
  if (m) {
    const note = db.notes.find((n) => n.id === m![1]);
    if (!note) return fail('笔记不存在', 404);
    if (method === 'GET') return ok({ note: noteView(note), refs: [], backrefs: [], incomplete: [] });
    if (method === 'PATCH') {
      if (note.frozen) return fail('这条已经结案，不能改了');
      const patch = { ...body };
      if (patch.content !== undefined) patch.content = RT.sanitizeHtml(String(patch.content || ''));
      Object.assign(note, normalizeNote({ ...note, ...patch, id: note.id, seq: note.seq }, Date.now(), note.seq));
      note.updatedAt = Date.now();
      commit();
      return ok({ note: noteView(note) });
    }
    if (method === 'DELETE') {
      db.notes = db.notes.filter((n) => n.id !== note.id);
      commit();
      return ok({ id: note.id });
    }
  }
  m = path.match(/^\/api\/notes\/([^/]+)\/comments$/);
  if (m) {
    const note = db.notes.find((n) => n.id === m![1]);
    if (!note) return fail('笔记不存在', 404);
    if (method === 'GET') return ok({ comments: note.comments || [] });
    if (method === 'POST') {
      const text = cleanText(body?.text).slice(0, 300);
      if (!text) return fail('留言不能空');
      const c = { id: uid('c'), text, at: Date.now() };
      (note.comments ||= []).push(c);
      commit();
      return ok({ comment: c });
    }
  }
  m = path.match(/^\/api\/notes\/([^/]+)\/comments\/([^/]+)$/);
  if (m && method === 'DELETE') {
    const note = db.notes.find((n) => n.id === m![1]);
    if (note) note.comments = (note.comments || []).filter((c: any) => c.id !== m![2]);
    commit();
    return ok({});
  }
  m = path.match(/^\/api\/notes\/([^/]+)\/result$/);
  if (m && method === 'POST') {
    const note = db.notes.find((n) => n.id === m![1]);
    if (!note) return fail('笔记不存在', 404);
    note.result = { outcome: String(body?.outcome || ''), note: String(body?.note || ''), at: Date.now() };
    note.frozen = true;
    note.updatedAt = Date.now();
    commit();
    return ok({ note: noteView(note) });
  }
  m = path.match(/^\/api\/notes\/([^/]+)\/after$/);
  if (m && method === 'POST') {
    const note = db.notes.find((n) => n.id === m![1]);
    if (!note) return fail('笔记不存在', 404);
    note.after = { text: String(body?.text || ''), at: Date.now() };
    commit();
    return ok({ note: noteView(note) });
  }
  if (path === '/api/stats/notes' && method === 'GET') return ok(statsForZone(query.zone || 'all'));

  // 回看
  if (path === '/api/review/week' && method === 'GET') {
    const picks = RV.weekPicks ? RV.weekPicks(db.notes, num(query.days, 7)) : [];
    return ok({ picks });
  }
  if (path === '/api/review/next' && method === 'GET') {
    const card = RV.pickDailyCard ? RV.pickDailyCard(db.notes) : null;
    return ok({ card: card ? RV.toBlindCard(card) : null, ageMin: 0, pool: db.notes.length, lastReviewAt: 0 });
  }
  m = path.match(/^\/api\/review\/([^/]+)\/reveal$/);
  if (m && method === 'GET') {
    const note = db.notes.find((n) => n.id === m![1]);
    if (!note) return fail('笔记不存在', 404);
    return ok({ reveal: { think: note.think || '', bet: note.bet, result: note.result, after: note.after, createdAt: note.createdAt } });
  }
  m = path.match(/^\/api\/review\/([^/]+)\/verdict$/);
  if (m && method === 'POST') {
    const note = db.notes.find((n) => n.id === m![1]);
    if (!note) return fail('笔记不存在', 404);
    note.review = { at: Date.now(), verdict: String(body?.verdict || ''), newThink: body?.newThink, newConf: body?.newConf };
    if (body?.newThink !== undefined) note.think = String(body.newThink);
    commit();
    return ok({ note: noteView(note) });
  }
  if (path === '/api/ruler' && method === 'GET') {
    return ok({
      calibration: RV.calibration ? RV.calibration(db.notes) : {},
      mistake: RV.mistakeStats ? RV.mistakeStats(db.notes) : {},
      callHit: RV.callHitStats ? RV.callHitStats(db.notes) : {},
      growth: RV.growthStats ? RV.growthStats(db.notes) : {},
      execution: RV.executionStats ? RV.executionStats(db.notes) : {},
      funnel: RV.funnel ? RV.funnel(db.notes) : {},
    });
  }

  // 工作记录
  if (path === '/api/work/entries') {
    if (method === 'GET') {
      let list = db.entries.filter((e) => !e.deletedAt);
      if (query.date) list = list.filter((e) => e.date === query.date);
      if (query.from) list = list.filter((e) => e.date >= query.from);
      if (query.to) list = list.filter((e) => e.date <= query.to);
      if (query.projectId) list = list.filter((e) => e.projectId === query.projectId);
      if (query.q) list = list.filter((e) => e.title.toLowerCase().includes(String(query.q).toLowerCase()));
      list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
      return ok({ entries: list.slice(0, num(query.limit, 5000)), total: list.length });
    }
    if (method === 'POST') {
      const e = normalizeEntry({ ...body }, Date.now(), { minutes: db.settings.defaultMinutes, date: dateKey(new Date()) });
      e.id = uid('e');
      db.entries.push(e);
      commit();
      return ok({ entry: e });
    }
  }
  if (path === '/api/work/entries/copy' && method === 'POST') {
    const from = String(body?.from || ''), to = String(body?.to || '');
    let copied = 0;
    db.entries.filter((e) => !e.deletedAt && e.date === from).forEach((e) => {
      const clone = normalizeEntry({ ...e, date: to }, Date.now());
      clone.id = uid('e');
      db.entries.push(clone);
      copied++;
    });
    commit();
    return ok({ copied });
  }
  if (path === '/api/work/entries/move' && method === 'POST') {
    const e = db.entries.find((x) => x.id === body?.id);
    if (!e) return fail('记录不存在', 404);
    e.date = dateKey(body.date);
    e.updatedAt = Date.now();
    commit();
    return ok({ entry: e });
  }
  m = path.match(/^\/api\/work\/entries\/([^/]+)\/restore$/);
  if (m && method === 'POST') {
    const e = db.entries.find((x) => x.id === m![1]);
    if (e) { e.deletedAt = null; commit(); }
    return ok({ entry: e });
  }
  m = path.match(/^\/api\/work\/entries\/([^/]+)\/purge$/);
  if (m && method === 'DELETE') {
    db.entries = db.entries.filter((x) => x.id !== m![1]);
    commit();
    return ok({ id: m![1] });
  }
  m = path.match(/^\/api\/work\/entries\/([^/]+)$/);
  if (m) {
    const e = db.entries.find((x) => x.id === m![1]);
    if (!e) return fail('记录不存在', 404);
    if (method === 'PATCH') {
      Object.assign(e, normalizeEntry({ ...e, ...body, id: e.id }, Date.now()));
      e.updatedAt = Date.now();
      commit();
      return ok({ entry: e });
    }
    if (method === 'DELETE') {
      e.deletedAt = Date.now();
      commit();
      return ok({ id: e.id, deletedAt: e.deletedAt });
    }
  }

  // 日总结
  if (path === '/api/work/days' && method === 'GET') {
    const from = query.from || '1970-01-01', to = query.to || '2999-12-31';
    return ok({ days: db.days.filter((d) => d.date >= from && d.date <= to) });
  }
  m = path.match(/^\/api\/work\/days\/([^/]+)$/);
  if (m && method === 'PUT') {
    const key = dateKey(m![1]);
    let d = db.days.find((x) => x.date === key);
    if (!d) { d = normalizeDayLog({ date: key, summary: body?.summary || '' }); db.days.push(d); }
    else { d.summary = String(body?.summary || ''); d.updatedAt = Date.now(); }
    commit();
    return ok({ day: d });
  }

  // 项目
  if (path === '/api/work/projects') {
    if (method === 'GET') return ok({ projects: db.projects });
    if (method === 'POST') {
      const p = normalizeProject(body || {});
      p.id = uid('p');
      p.order = db.projects.length ? Math.max(...db.projects.map((x) => x.order)) + 1 : 1;
      db.projects.push(p);
      commit();
      return ok({ project: p });
    }
  }
  if (path === '/api/work/projects/reorder' && method === 'POST') {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    ids.forEach((id: string, i: number) => { const p = db.projects.find((x) => x.id === id); if (p) p.order = i + 1; });
    db.projects.sort((a, b) => a.order - b.order);
    commit();
    return ok({});
  }
  m = path.match(/^\/api\/work\/projects\/([^/]+)\/merge$/);
  if (m && method === 'POST') {
    const src = db.projects.find((p) => p.id === m![1]);
    const target = db.projects.find((p) => p.id === body?.targetId);
    if (!src || !target) return fail('项目不存在', 404);
    db.entries.forEach((e) => { if (e.projectId === src.id) e.projectId = target.id; });
    db.notes.forEach((n) => { if (n.projectId === src.id) n.projectId = target.id; });
    db.projects = db.projects.filter((p) => p.id !== src.id);
    commit();
    return ok({});
  }
  m = path.match(/^\/api\/work\/projects\/([^/]+)$/);
  if (m) {
    const p = db.projects.find((x) => x.id === m![1]);
    if (!p) return fail('项目不存在', 404);
    if (method === 'PATCH') {
      Object.assign(p, normalizeProject({ ...p, ...body, id: p.id }, Date.now()));
      p.updatedAt = Date.now();
      commit();
      return ok({ project: p });
    }
    if (method === 'DELETE') {
      const transferTo = query.transferTo === 'none' ? null : query.transferTo || null;
      let movedEntries = 0, movedNotes = 0;
      db.entries.forEach((e) => { if (e.projectId === p.id) { e.projectId = transferTo; movedEntries++; } });
      db.notes.forEach((n) => { if (n.projectId === p.id) { n.projectId = transferTo; movedNotes++; } });
      db.projects = db.projects.filter((x) => x.id !== p.id);
      commit();
      return ok({ id: p.id, movedEntries, movedNotes });
    }
  }

  // 模板
  if (path === '/api/work/templates') {
    if (method === 'GET') return ok({ templates: db.templates });
    if (method === 'POST') {
      const t = normalizeTemplate(body || {});
      t.id = uid('t');
      db.templates.push(t);
      commit();
      return ok({ template: t });
    }
  }
  m = path.match(/^\/api\/work\/templates\/([^/]+)\/use$/);
  if (m && method === 'POST') {
    const t = db.templates.find((x) => x.id === m![1]);
    if (!t) return fail('模板不存在', 404);
    const e = normalizeEntry({ title: t.title, projectId: t.projectId, minutes: t.minutes, tags: t.tags, date: body?.date || dateKey(new Date()) }, Date.now());
    e.id = uid('e');
    db.entries.push(e);
    t.useCount = (t.useCount || 0) + 1;
    commit();
    return ok({ entry: e, template: t });
  }
  m = path.match(/^\/api\/work\/templates\/([^/]+)$/);
  if (m) {
    const t = db.templates.find((x) => x.id === m![1]);
    if (!t) return fail('模板不存在', 404);
    if (method === 'PATCH') { Object.assign(t, normalizeTemplate({ ...t, ...body, id: t.id }, Date.now())); commit(); return ok({ template: t }); }
    if (method === 'DELETE') { db.templates = db.templates.filter((x) => x.id !== t.id); commit(); return ok({}); }
  }

  // 附件：data URL 直存
  if (path === '/api/attachments' && method === 'POST') {
    const data = String(body?.data || '');
    if (!data) return fail('文件内容为空');
    const a = {
      id: uid('a'),
      entryId: body?.entryId || null,
      date: body?.date || null,
      name: cleanText(body?.name).slice(0, 200) || '附件',
      mime: cleanText(body?.mime) || 'application/octet-stream',
      size: data.length,
      data,
      thumb: String(body?.thumb || ''),
      w: num(body?.w), h: num(body?.h),
      createdAt: Date.now(),
    };
    db.attachments.push(a);
    commit();
    return ok({ attachment: { ...a, url: a.data, thumbUrl: a.thumb || a.data } });
  }
  m = path.match(/^\/api\/attachments\/([^/]+)$/);
  if (m && method === 'DELETE') {
    const a = db.attachments.find((x) => x.id === m![1]);
    if (a) {
      a.entryId = null;
      db.entries.forEach((e) => { e.attachmentIds = (e.attachmentIds || []).filter((id: string) => id !== a.id); });
      commit();
    }
    return ok({});
  }

  // 快照：浏览器版用 localStorage 存几个历史版本
  if (path === '/api/snapshots') {
    if (method === 'GET') {
      try { return ok({ snapshots: JSON.parse(localStorage.getItem('zx-web-snapshots') || '[]') }); }
      catch (_) { return ok({ snapshots: [] }); }
    }
    if (method === 'POST') {
      const list = listSnapshots();
      list.unshift({ name: `snap-${Date.now()}`, at: Date.now(), reason: cleanText(body?.reason) || 'manual', data: JSON.stringify(db) });
      localStorage.setItem('zx-web-snapshots', JSON.stringify(list.slice(0, 10)));
      return ok({ snapshot: { name: list[0].name, at: list[0].at } });
    }
  }
  m = path.match(/^\/api\/snapshots\/([^/]+)\/restore$/);
  if (m && method === 'POST') {
    const snap = listSnapshots().find((s) => s.name === m![1]);
    if (!snap) return fail('快照不存在', 404);
    replaceDb(JSON.parse(snap.data));
    commit();
    return ok({});
  }
  m = path.match(/^\/api\/snapshots\/([^/]+)$/);
  if (m && method === 'DELETE') {
    localStorage.setItem('zx-web-snapshots', JSON.stringify(listSnapshots().filter((s) => s.name !== m![1])));
    return ok({});
  }
  if (path === '/api/storage' && method === 'GET') {
    const used = new Blob([JSON.stringify(db)]).size;
    return ok({ info: { dataBytes: used, mediaBytes: 0, totalBytes: used, snapshots: listSnapshots().length } });
  }
  if (path === '/api/cleanup' && method === 'POST') {
    const used = new Set<string>();
    db.notes.forEach((n) => (n.images || []).forEach((i: any) => used.add(i.url)));
    db.attachments = db.attachments.filter((a) => a.entryId || used.has(a.data));
    commit();
    return ok({ removed: 0 });
  }
  if (path === '/api/migrate/inspect' && method === 'GET') return ok({ found: 0 });
  if (path === '/api/migrate/inspiration' && method === 'POST') return ok({ migrated: 0 });

  // 导入导出
  if (path === '/api/export' && method === 'GET') {
    const result = exportData(String(query.format || 'md'), String(query.scope || 'all'));
    return ok({ filename: result.filename, content: result.data, mime: result.mime, _download: { filename: result.filename, data: result.data, mime: result.mime } });
  }
  if (path === '/api/import' && method === 'POST') {
    const files = Array.isArray(body?.files) ? body.files : [];
    let raw = '';
    for (const f of files) {
      const d = String(f?.data || '');
      const comma = d.indexOf(',');
      try {
        // dataURL（base64）先解码
        const text = comma >= 0 && d.startsWith('data:') ? decodeURIComponent(escape(atob(d.slice(comma + 1)))) : d;
        const parsed = JSON.parse(text);
        raw = text;
        break;
      } catch (_) { /* 试下一个文件 */ }
    }
    if (!raw) return fail('文件格式不对，需要 JSON 备份');
    let imported: any = null;
    try {
      const parsed = JSON.parse(raw);
      imported = parsed.workspace || parsed;
    } catch (_) {
      return fail('文件内容不是有效的 JSON');
    }
    const next = normalizeWorkspace(imported);
    if (body?.mode === 'replace') replaceDb(next);
    else {
      const cur = getDb();
      cur.notes = [...cur.notes, ...next.notes];
      cur.entries = [...cur.entries, ...next.entries];
      cur.projects = [...cur.projects, ...next.projects];
      cur.templates = [...cur.templates, ...next.templates];
      cur.days = [...cur.days, ...next.days];
      replaceDb(cur);
    }
    commit();
    return ok({ parsed: files.length, duplicates: 0, notes: next.notes.length, entries: next.entries.length, projects: next.projects.length, templates: next.templates.length, days: next.days.length });
  }

  return fail(`未知接口：${method} ${path}`, 404);
}

function listSnapshots(): any[] {
  try { return JSON.parse(localStorage.getItem('zx-web-snapshots') || '[]'); }
  catch (_) { return []; }
}

/** 供前端下载使用：把导出内容转成 Blob 下载 */
export function downloadText(filename: string, data: string, mime = 'text/plain') {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
