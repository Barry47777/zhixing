'use strict';
/**
 * 知行 · 导出 / 导入路由
 *
 *    GET  /api/export   scope=notes|work|all + format=md|pack|docx|json|print|workmd|backup
 *    POST /api/import   { files:[{name,data}], mode:merge|replace, dryRun?, confirmReplace? }
 *
 * 设计要点：
 *   - 笔记导出直接复用 lib/transfer（旧灵感导出）与 lib/docx、lib/print，筛选口径与列表接口一致；
 *   - 工作数据的 Markdown（日报 / 周报 / 月报 / 全部历史）在本文件实现，品牌统一为「知行」；
 *   - 工作 JSON 与旧 Studio Log 备份同形状（projects.weeklyTarget、entries.hours），可回导旧程序；
 *   - 全量备份 app === 'zhixing'，workspace 即 store.exportRaw() 的磁盘形状；
 *   - dryRun 全程只读（不写盘、不落图、不建快照）；正式导入先 createSnapshot('pre-import')，
 *     失败走 store.commit 的 503 回滚，绝不重复响应。
 */
const fs = require('fs');
const fsp = fs.promises;
const nodePath = require('path');
const crypto = require('crypto');

const config = require('../config');
const store = require('../store');
const util = require('../util');
const noteLib = require('../lib/transfer');
const docxLib = require('../lib/docx');
const printLib = require('../lib/print');
const { readZip } = require('../lib/zip');
const imageLib = require('../lib/images');
const richtext = require('../lib/richtext');
const N = require('../models/notes');
const M = require('../models/work');
const notesRoutes = require('./notes');

/* ------------------------------------------------------------ 常量 */

const NOTE_FORMATS = ['md', 'pack', 'docx', 'json', 'print'];
const STATUS_TEXT = { done: '已完成', doing: '进行中', blocked: '受阻' };
const MAX_ERRORS = 40;
const ZONE_TEXT = { inspiration: '灵感', review: '复盘' };

/* ------------------------------------------------------------ 小工具 */

const two = (n) => String(n).padStart(2, '0');

function pushError(list, msg) {
  if (!msg) return;
  if (list.length >= MAX_ERRORS) return;
  if (list.includes(msg)) return;
  list.push(msg);
}

/** 兼容两种调用：query 是 URLSearchParams，或 pathname 上带着 ?a=b */
function queryParams(pathname, query) {
  const params = new URLSearchParams();
  if (query && typeof query.get === 'function') {
    for (const [k, v] of query) params.append(k, v);
  } else if (query && typeof query === 'object') {
    for (const k of Object.keys(query)) {
      const v = query[k];
      if (Array.isArray(v)) v.forEach((x) => x != null && params.append(k, String(x)));
      else if (v != null) params.append(k, String(v));
    }
  }
  const raw = String(pathname || '');
  const qi = raw.indexOf('?');
  if (qi >= 0) {
    const extra = new URLSearchParams(raw.slice(qi + 1));
    for (const [k, v] of extra) if (!params.has(k)) params.append(k, v);
  }
  return params;
}

const pickStr = (p, key, fallback = '') => {
  const v = p.get(key);
  return v == null ? fallback : String(v).trim();
};

const pickBool = (p, key) => {
  const v = String(p.get(key) == null ? '' : p.get(key)).toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
};

/** 严格校验 YYYY-MM-DD（util.dayStart 也一样严格） */
function validDateKey(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ms = util.dayStart(s);
  if (ms == null) return null;
  // util.dayStart 只校验形状：2026-13-99、2026-02-30 会被 Date 归一化成别的日期，这里回读比对拦住
  if (util.dayKey(new Date(ms + 12 * 36e5)) !== s) return null;
  return s;
}

/** 在本地时区上挪日期（正午起算，躲开夏令时） */
function shiftDays(key, n) {
  const ms = util.dayStart(key);
  if (ms == null) return key;
  const d = new Date(ms + 12 * 36e5);
  d.setDate(d.getDate() + n);
  return util.dayKey(d);
}

function startOfWeek(key, weekStartsOn) {
  const ms = util.dayStart(key);
  if (ms == null) return key;
  const d = new Date(ms + 12 * 36e5);
  const start = weekStartsOn === 0 ? 0 : 1;
  const diff = (d.getDay() - start + 7) % 7;
  d.setDate(d.getDate() - diff);
  return util.dayKey(d);
}

function startOfMonth(key) {
  return `${key.slice(0, 4)}-${key.slice(5, 7)}-01`;
}

function endOfMonth(key) {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const d = new Date(y, m, 0, 12, 0, 0, 0);
  return util.dayKey(d);
}

function stampOf(now) {
  const d = new Date(now);
  return `${util.dayKey(d)}_${two(d.getHours())}${two(d.getMinutes())}`;
}

/** 小时显示：1 位小数、去掉多余的 .0（6h / 1.5h） */
function fmtHours(hours) {
  const n = Math.round((Number(hours) || 0) * 10) / 10;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** base64（可带 data URI 前缀）→ Buffer；无效返回 null */
function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data.length ? data : null;
  if (data == null) return null;
  let s = String(data);
  const m = /^data:[^,]*;base64,/i.exec(s.trim());
  if (m) s = s.slice(m[0].length);
  s = s.replace(/\s+/g, '');
  if (!s) return null;
  try {
    const buf = Buffer.from(s, 'base64');
    return buf.length ? buf : null;
  } catch (_) {
    return null;
  }
}

/* ------------------------------------------------------------ 导出：笔记 */

function describeNotesScope(p) {
  const parts = [];
  const zone = pickStr(p, 'zone');
  if (ZONE_TEXT[zone]) parts.push(`${ZONE_TEXT[zone]}区`);
  const type = pickStr(p, 'type');
  if (noteLib.TYPES[type]) parts.push(`类型 ${noteLib.typeLabel(type)}`);
  const stage = pickStr(p, 'stage');
  if (stage) parts.push(`层级 ${stage}`);
  const tag = pickStr(p, 'tag');
  if (tag) parts.push(`标签 #${tag}`);
  const q = pickStr(p, 'q');
  if (q) parts.push(`搜索「${q}」`);
  if (pickBool(p, 'pinned')) parts.push('仅置顶');
  const sf = pickStr(p, 'scopeFilter');
  if (sf === 'wrong') parts.push('只看判断错的');
  else if (sf === 'skipped') parts.push('只看跳过的');
  else if (sf === 'unsettled') parts.push('只看没结果的');
  return parts.length ? parts.join(' · ') : '全部';
}

/** 笔记筛选：与列表接口同口径，补 pinned / scopeFilter */
function pickNotesForExport(db, p, now) {
  let list = notesRoutes.filterNotes(db, p, now);
  if (pickBool(p, 'pinned')) list = list.filter((n) => n.pinned);
  const sf = pickStr(p, 'scopeFilter');
  if (sf === 'wrong') list = list.filter((n) => n.result && n.result.outcome === 'wrong');
  else if (sf === 'skipped') list = list.filter((n) => n.did === 'skipped');
  else if (sf === 'unsettled') list = list.filter((n) => !(n.result && n.result.outcome));
  return notesRoutes.sortNotes(list);
}

/* ------------------------------------------------------------ 导出：工作 Markdown */

function makeWorkCtx(db, now) {
  const projects = Array.isArray(db.projects) ? db.projects : [];
  const byId = new Map(projects.map((p) => [p.id, p]));
  const entries = (Array.isArray(db.entries) ? db.entries : []).filter((e) => !e.deletedAt);
  const days = new Map((Array.isArray(db.days) ? db.days : []).map((d) => [d.date, d]));
  return {
    db,
    now,
    projects,
    entries,
    days,
    projectName(projectId) {
      const p = byId.get(projectId);
      return p && p.name ? p.name : '未分类';
    },
    daySummary(dateKey) {
      const d = days.get(dateKey);
      return d && d.summary ? d.summary : '';
    },
  };
}

function sortEntries(list) {
  return [...list].sort((a, b) => {
    const pa = Number(a.priority) || 0;
    const pb = Number(b.priority) || 0;
    if (pa !== pb) return pb - pa;
    const ma = Number(a.minutes) || 0;
    const mb = Number(b.minutes) || 0;
    if (ma !== mb) return mb - ma;
    return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
  });
}

function sumMinutes(list) {
  return list.reduce((s, e) => s + (Number(e.minutes) || 0), 0);
}

function projectGroups(ctx, list) {
  const groups = new Map();
  for (const e of list) {
    const name = ctx.projectName(e.projectId);
    if (!groups.has(name)) groups.set(name, { name, minutes: 0, count: 0, list: [] });
    const g = groups.get(name);
    g.minutes += Number(e.minutes) || 0;
    g.count += 1;
    g.list.push(e);
  }
  return [...groups.values()].sort((a, b) => b.minutes - a.minutes);
}

/** 一条记录 → Markdown 列表行（含子任务与备注缩进） */
function entryLine(ctx, e) {
  const bits = [];
  if (Number(e.minutes) > 0) bits.push(`${fmtHours(Number(e.minutes) / 60)}h`);
  if (STATUS_TEXT[e.status]) bits.push(STATUS_TEXT[e.status]);
  if (Number(e.priority) === 2) bits.unshift('重要');
  if (Array.isArray(e.tags) && e.tags.length) bits.push(e.tags.map((t) => `#${t}`).join(' '));
  const head = `- ${e.title || '（未命名）'}${bits.length ? `（${bits.join(' · ')}）` : ''}`;
  const lines = [head];
  for (const st of Array.isArray(e.subtasks) ? e.subtasks : []) {
    if (!st || !st.text) continue;
    lines.push(`  - [${st.done ? 'x' : ' '}] ${st.text}`);
  }
  if (e.note) lines.push(`  > ${String(e.note).replace(/\n/g, '\n  > ')}`);
  return lines.join('\n');
}

/** 按项目分组（标题级别可调） */
function groupByProject(ctx, list, level = 2) {
  const out = [];
  for (const g of projectGroups(ctx, list)) {
    out.push(`${'#'.repeat(level)} ${g.name} · ${fmtHours(g.minutes / 60)}h`, '');
    out.push(...sortEntries(g.list).map((e) => entryLine(ctx, e)), '');
  }
  return out;
}

function buildDailyMarkdown(db, dateKey, now) {
  const ctx = makeWorkCtx(db, now);
  const list = sortEntries(ctx.entries.filter((e) => e.date === dateKey));
  const total = sumMinutes(list);
  const done = list.filter((e) => e.status === 'done').length;
  const lines = [
    `# ${dateKey} 工作日报`,
    '',
    `**投入** ${fmtHours(total / 60)}h · **条目** ${list.length} · **完成** ${done}`,
    '',
  ];
  if (!list.length) lines.push('_这一天还没有记录。_', '');
  else lines.push(...groupByProject(ctx, list));
  const summary = ctx.daySummary(dateKey);
  if (summary) lines.push('## 当日总结', '', summary, '');
  return lines.join('\n');
}

function buildWeeklyMarkdown(db, anchorKey, weekStartsOn, now) {
  const ctx = makeWorkCtx(db, now);
  const start = startOfWeek(anchorKey, weekStartsOn);
  const end = shiftDays(start, 6);
  const list = ctx.entries.filter((e) => e.date >= start && e.date <= end);
  const total = sumMinutes(list);
  const dateList = [...new Set(list.map((e) => e.date))].sort();

  const lines = [
    `# ${start} ~ ${end} 工作周报`,
    '',
    `**投入** ${fmtHours(total / 60)}h · **活跃天数** ${dateList.length} · **条目** ${list.length}`,
    '',
    '## 项目投入',
    '',
    '| 项目 | 工时 | 条目 |',
    '| --- | ---: | ---: |',
  ];
  const groups = projectGroups(ctx, list);
  if (!groups.length) lines.push('| — | 0 | 0 |');
  else for (const g of groups) lines.push(`| ${g.name} | ${fmtHours(g.minutes / 60)}h | ${g.count} |`);

  lines.push('', '## 每日记录', '');
  if (!dateList.length) {
    lines.push('_这一周还没有记录。_', '');
  } else {
    for (const dateKey of dateList) {
      const dayList = sortEntries(list.filter((e) => e.date === dateKey));
      lines.push(`### ${dateKey} · ${fmtHours(sumMinutes(dayList) / 60)}h`, '');
      lines.push(...dayList.map((e) => entryLine(ctx, e)), '');
      const summary = ctx.daySummary(dateKey);
      if (summary) lines.push(...String(summary).split(/\n/).map((l) => `> ${l}`), '');
    }
  }
  lines.push('## 下周计划', '', '- [ ] ', '');
  return lines.join('\n');
}

function buildMonthlyMarkdown(db, cursorKey, now) {
  const ctx = makeWorkCtx(db, now);
  const year = Number(cursorKey.slice(0, 4));
  const month = Number(cursorKey.slice(5, 7));
  const start = startOfMonth(cursorKey);
  const end = endOfMonth(cursorKey);
  const list = ctx.entries.filter((e) => e.date >= start && e.date <= end);
  const total = sumMinutes(list);
  const dateList = [...new Set(list.map((e) => e.date))].sort();
  const activeDays = dateList.length;
  const done = list.filter((e) => e.status === 'done').length;
  const dailyAvg = activeDays ? total / activeDays : 0;

  const lines = [
    `# ${year} 年 ${month} 月 工作月报`,
    '',
    `**投入** ${fmtHours(total / 60)}h · **活跃天数** ${activeDays} · **日均** ${fmtHours(dailyAvg / 60)}h · **完成** ${done}/${list.length}`,
    '',
    '## 项目投入',
    '',
    '| 项目 | 工时 | 占比 | 条目 |',
    '| --- | ---: | ---: | ---: |',
  ];
  const groups = projectGroups(ctx, list);
  if (!groups.length) lines.push('| — | 0 | 0% | 0 |');
  else {
    for (const g of groups) {
      const pct = total ? Math.round((g.minutes / total) * 100) : 0;
      lines.push(`| ${g.name} | ${fmtHours(g.minutes / 60)}h | ${pct}% | ${g.count} |`);
    }
  }

  lines.push('', '## 重要记录', '');
  if (!list.length) {
    lines.push('_本月还没有记录。_', '');
  } else {
    const important = [...list]
      .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0) || (Number(b.minutes) || 0) - (Number(a.minutes) || 0))
      .slice(0, 8);
    for (const e of important) {
      lines.push(`- ${e.date} · ${e.title || '（未命名）'}（${fmtHours((Number(e.minutes) || 0) / 60)}h · ${ctx.projectName(e.projectId)}）`);
    }
    lines.push('');
  }

  lines.push('## 月度总结', '');
  const summaryDays = dateList.filter((k) => ctx.daySummary(k));
  if (!summaryDays.length) lines.push('_没有填写当日总结。_', '');
  else {
    for (const dateKey of summaryDays) lines.push(`- **${dateKey}**：${ctx.daySummary(dateKey)}`);
    lines.push('');
  }
  return lines.join('\n');
}

function buildAllEntriesMarkdown(db, { from, to }, now) {
  const ctx = makeWorkCtx(db, now);
  let list = ctx.entries;
  if (from) list = list.filter((e) => e.date >= from);
  if (to) list = list.filter((e) => e.date <= to);

  let title = '# 全部工作记录';
  if (from || to) title = `# ${from || '最早'} ~ ${to || '至今'} 工作记录`;
  const lines = [title, '', `导出时间：${new Date(now).toLocaleString('zh-CN')}`, ''];

  const dateList = [...new Set(list.map((e) => e.date))].sort().reverse();
  if (!dateList.length) {
    lines.push('_还没有任何工作记录。_', '');
    return lines.join('\n');
  }
  for (const dateKey of dateList) {
    const dayList = sortEntries(list.filter((e) => e.date === dateKey));
    lines.push(`## ${dateKey} · ${fmtHours(sumMinutes(dayList) / 60)}h`, '');
    lines.push(...dayList.map((e) => entryLine(ctx, e)), '');
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------ 导出：Studio Log 兼容 JSON */

function legacySettings(settings) {
  const s = settings || {};
  return {
    theme: s.theme,
    accent: s.accent,
    density: s.density,
    weekStartsOn: s.weekStart,
    dailyGoal: s.dailyGoalHours,
    defaultProjectId: s.defaultProjectId,
    defaultHours: Math.round((Number(s.defaultMinutes) || 120) / 6) / 10,
    fontScale: s.fontScale,
    autoSnapshotHours: s.snapshotHours,
    attachmentLimitMB: s.attachmentLimitMB,
    showWeekNumbers: s.showWeekNumbers,
    reduceMotion: s.reduceMotion,
  };
}

/** 工作数据 → 旧 Studio Log 备份形状（小时制），旧程序可以直接恢复 */
function buildWorkJson(db, includeAttachments) {
  const payload = {
    app: 'studio-log-pro',
    version: 2,
    exportedAt: new Date().toISOString(),
    projects: (db.projects || []).map((p) => ({ ...p, weeklyTarget: p.weeklyGoalHours })),
    entries: (db.entries || []).map((e) => ({ ...e, hours: util.round1((Number(e.minutes) || 0) / 60) })),
    days: (db.days || []).map((d) => ({ date: d.date, summary: d.summary, updatedAt: d.updatedAt })),
    templates: (db.templates || []).map((t) => ({ ...t, hours: util.round1((Number(t.minutes) || 0) / 60) })),
    settings: legacySettings(db.settings),
  };
  if (!includeAttachments) return payload;
  const list = [];
  for (const a of db.attachments || []) {
    const buf = imageLib.readImageSync(config.MEDIA_DIR, `/media/${a.rel}`);
    if (!buf) continue;
    const thumb = a.thumbRel ? imageLib.readImageSync(config.MEDIA_DIR, `/media/${a.thumbRel}`) : null;
    list.push({
      id: a.id,
      entryId: a.entryId,
      date: a.date,
      name: a.name,
      mime: a.mime,
      size: a.size || buf.length,
      data: buf.toString('base64'),
      thumb: thumb ? thumb.toString('base64') : null,
    });
  }
  payload.attachments = list;
  return payload;
}

/* ------------------------------------------------------------ GET /api/export */

async function handleExport(req, res, pathname, query) {
  if (req.method !== 'GET') {
    util.sendError(res, 405, '导出只支持 GET');
    return true;
  }
  const p = queryParams(pathname, query);
  const db = store.db;
  const now = Date.now();
  const stamp = stampOf(now);

  const formatRaw = pickStr(p, 'format').toLowerCase();
  let scope = pickStr(p, 'scope').toLowerCase();

  // 兼容旧参数：scope=wrong|skipped|unsettled 其实是笔记筛选
  if (scope === 'wrong' || scope === 'skipped' || scope === 'unsettled') {
    if (!p.has('scopeFilter')) p.set('scopeFilter', scope);
    scope = 'notes';
  }
  if (!['notes', 'work', 'all'].includes(scope)) {
    if (formatRaw === 'workmd') scope = 'work';
    else if (formatRaw === 'backup') scope = 'all';
    else scope = 'notes';
  }
  let format = formatRaw || (scope === 'work' ? 'workmd' : scope === 'all' ? 'backup' : 'md');
  if (scope === 'work' && (format === 'md' || format === 'workmd')) format = 'workmd';
  if (scope === 'all' && format === 'json') format = 'backup';

  const readImage = (url) => imageLib.readImageSync(config.MEDIA_DIR, url);

  /* ---- 笔记 ---- */
  if (scope === 'notes') {
    if (!NOTE_FORMATS.includes(format)) {
      util.sendError(res, 400, `不支持的导出格式：${format}`);
      return true;
    }
    const list = pickNotesForExport(db, p, now);
    const scopeLabel = describeNotesScope(p);

    if (format === 'md') {
      const text = noteLib.buildMarkdown(list, { scopeLabel, readImage, embedImages: true });
      util.sendDownload(res, {
        filename: `知行-思考笔记-${stamp}.md`,
        type: 'text/markdown; charset=utf-8',
        body: text,
      });
      return true;
    }
    if (format === 'pack') {
      const buf = noteLib.buildPack(list, { scopeLabel, readImage });
      util.sendDownload(res, {
        filename: `知行-知识库-${stamp}.zip`,
        type: 'application/zip',
        body: buf,
      });
      return true;
    }
    if (format === 'docx') {
      const buf = docxLib.buildDocx(list, { scopeLabel, readImage, title: '知行 · 思考笔记' });
      util.sendDownload(res, {
        filename: `知行-思考笔记-${stamp}.docx`,
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        body: buf,
      });
      return true;
    }
    if (format === 'json') {
      const text = noteLib.buildJson(list);
      util.sendDownload(res, {
        filename: `知行-笔记备份-${stamp}.json`,
        type: 'application/json; charset=utf-8',
        body: text,
      });
      return true;
    }
    // print
    const autoPrint = pickBool(p, 'auto');
    const html = printLib.buildPrintHtml(list, { scopeLabel, readImage, autoPrint });
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html, 'utf8'),
      'Cache-Control': 'no-store',
    });
    res.end(html);
    return true;
  }

  /* ---- 工作 ---- */
  if (scope === 'work') {
    if (format === 'json') {
      const includeAttachments = pickBool(p, 'attachments');
      const text = JSON.stringify(buildWorkJson(db, includeAttachments), null, 2);
      util.sendDownload(res, {
        filename: `知行-工作数据-${stamp}.json`,
        type: 'application/json; charset=utf-8',
        body: text,
      });
      return true;
    }
    if (format !== 'workmd') {
      util.sendError(res, 400, `工作数据不支持的导出格式：${format}`);
      return true;
    }

    const dateRaw = pickStr(p, 'date');
    const dateKey = dateRaw ? validDateKey(dateRaw) : util.dayKey(new Date(now));
    if (dateRaw && !dateKey) {
      util.sendError(res, 400, '请求参数 date 应为 YYYY-MM-DD');
      return true;
    }
    const fromRaw = pickStr(p, 'from');
    const toRaw = pickStr(p, 'to');
    const from = fromRaw ? validDateKey(fromRaw) : null;
    const to = toRaw ? validDateKey(toRaw) : null;
    if ((fromRaw && !from) || (toRaw && !to)) {
      util.sendError(res, 400, '请求参数 from / to 应为 YYYY-MM-DD');
      return true;
    }

    const range = pickStr(p, 'range', 'daily').toLowerCase() || 'daily';
    const weekStartsOn = db.settings && db.settings.weekStart === 0 ? 0 : 1;
    let body = '';
    let namePart = '';
    if (range === 'daily') {
      body = buildDailyMarkdown(db, dateKey, now);
      namePart = '工作日报';
    } else if (range === 'weekly') {
      body = buildWeeklyMarkdown(db, dateKey, weekStartsOn, now);
      namePart = '工作周报';
    } else if (range === 'monthly') {
      body = buildMonthlyMarkdown(db, dateKey, now);
      namePart = '工作月报';
    } else if (range === 'all') {
      body = buildAllEntriesMarkdown(db, { from, to }, now);
      namePart = '全部工作记录';
    } else {
      util.sendError(res, 400, '工作范围只能是 daily / weekly / monthly / all');
      return true;
    }

    util.sendDownload(res, {
      filename: `知行-${namePart}-${stamp}.md`,
      type: 'text/markdown; charset=utf-8',
      body,
    });
    return true;
  }

  /* ---- 全量备份 ---- */
  if (format !== 'backup') {
    util.sendError(res, 400, `全量备份不支持的导出格式：${format}`);
    return true;
  }
  const includeAttachments = pickBool(p, 'attachments');
  const workspace = store.exportRaw({ includeAttachments });
  if (includeAttachments) {
    // store.exportRaw 只内联了附件文件，笔记正文里的图片也要带上，否则换台机器恢复后图文会缺
    const media = workspace.media || (workspace.media = {});
    for (const note of db.notes) {
      for (const img of note.images || []) {
        const rel = String((img && img.url) || '').replace(/^\/media\//, '');
        if (!rel || rel.includes('..') || media[rel]) continue;
        const buf = imageLib.readImageSync(config.MEDIA_DIR, `/media/${rel}`);
        if (buf) media[rel] = buf.toString('base64');
      }
    }
  }
  const payload = {
    app: 'zhixing',
    version: 2,
    exportedAt: new Date().toISOString(),
    workspace,
  };
  util.sendDownload(res, {
    filename: `知行-全量备份-${stamp}.json`,
    type: 'application/json; charset=utf-8',
    body: JSON.stringify(payload, null, 2),
  });
  return true;
}

/* ------------------------------------------------------------ 导入：解析文件 */

function makeZipResolver(entries, mdName) {
  const byName = new Map();
  for (const e of entries) byName.set(e.name, e);
  const dir = mdName.includes('/') ? mdName.slice(0, mdName.lastIndexOf('/')) : '';
  return (ref) => {
    const clean = String(ref || '').replace(/\\/g, '/').replace(/^\.?\//, '');
    if (!clean) return null;
    if (!/\.(png|jpe?g|webp|gif)$/i.test(clean)) return null;
    const base = clean.split('/').pop();
    const candidates = [clean, dir ? `${dir}/${clean}` : '', base];
    for (const c of candidates) {
      if (c && byName.has(c)) return byName.get(c).data;
    }
    for (const e of entries) {
      if (e.name === base || e.name.endsWith(`/${base}`)) return e.data;
    }
    return null;
  };
}

function collectText(name, buf, sink) {
  const items = noteLib.parseFile(name, buf);
  for (const item of items) {
    if (!Array.isArray(item.images)) item.images = [];
    item.images = item.images.filter((img) => {
      if (!img) return false;
      if (img.data) return true;
      const ref = img.ref || img.url;
      return Boolean(ref && (String(ref).startsWith('/media/') || /^data:/i.test(String(ref))));
    });
  }
  sink.notes.push(...items);
}

function collectDocx(name, buf, sink) {
  const sections = docxLib.readDocxNotes(buf);
  for (const sec of sections) {
    const text = String((sec && sec.text) || '').trim();
    const images = Array.isArray(sec && sec.images) ? sec.images.map((b) => ({ data: b })) : [];
    if (!text && !images.length) continue;
    let base = {};
    try {
      const arr = noteLib.parseFile('docx.txt', Buffer.from(text, 'utf8'));
      base = (Array.isArray(arr) && arr[0]) || {};
    } catch (_) {
      base = {};
    }
    if (!base.seen && !base.think && !base.content) base = { ...base, content: richtext.fromLegacy('', text) };
    delete base.images;
    sink.notes.push({ ...base, images });
  }
}

function collectJson(name, buf, sink) {
  let parsed;
  try {
    parsed = JSON.parse(buf.toString('utf8'));
  } catch (_) {
    throw new Error('不是有效的 JSON 文件');
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (parsed.app === 'zhixing' && parsed.workspace && typeof parsed.workspace === 'object') {
      sink.workspaces.push(parsed);
      return;
    }
    if (parsed.app === 'studio-log-pro' || Array.isArray(parsed.entries) || Array.isArray(parsed.projects)) {
      sink.works.push(parsed);
      return;
    }
  }
  const items = noteLib.parseFile(name, buf);
  sink.notes.push(...items);
}

function collectZip(name, buf, sink) {
  const entries = readZip(buf).map((e) => ({ ...e, name: String(e.name || '').replace(/\\/g, '/').replace(/^\.?\//, '') }));
  const files = entries.filter((e) => e.name && !e.name.endsWith('/'));
  for (const e of files) {
    const base = e.name.split('/').pop().toLowerCase();
    if (base === 'readme.md' || base === 'readme.txt' || base.startsWith('00-')) continue;
    const ext = (base.split('.').pop() || '').toLowerCase();
    if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
      const resolve = makeZipResolver(files, e.name);
      const items = noteLib.parseFile(e.name, e.data);
      for (const item of items) {
        if (!Array.isArray(item.images)) item.images = [];
        item.images = item.images.map((img) => {
          if (!img) return null;
          if (img.data) return img;
          const ref = img.ref || img.url;
          if (!ref) return null;
          const s = String(ref);
          if (/^data:/i.test(s)) {
            const data = imageLib.parseDataUri(s);
            return data ? { data } : null;
          }
          if (s.startsWith('/media/')) return img;
          const data = resolve(s);
          return data ? { data } : null;
        }).filter(Boolean);
      }
      sink.notes.push(...items);
    } else if (ext === 'docx') {
      collectDocx(e.name, e.data, sink);
    } else if (ext === 'json') {
      collectJson(e.name, e.data, sink);
    }
  }
}

async function collectFiles(files, sink) {
  for (let i = 0; i < files.length; i += 1) {
    const f = files[i];
    if (!f || typeof f !== 'object') {
      pushError(sink.errors, '忽略了一个无效的文件项');
      continue;
    }
    const name = String(f.name || `file-${i + 1}`).replace(/\\/g, '/');
    const ext = (name.split('.').pop() || '').toLowerCase();
    const buf = toBuffer(f.data);
    sink.files += 1;
    if (!buf || !buf.length) {
      pushError(sink.errors, `「${name}」是空文件`);
      continue;
    }
    try {
      if (ext === 'zip') collectZip(name, buf, sink);
      else if (ext === 'docx' || ext === 'doc') collectDocx(name, buf, sink);
      else if (ext === 'json') collectJson(name, buf, sink);
      else if (ext === 'md' || ext === 'markdown' || ext === 'txt' || ext === 'text') collectText(name, buf, sink);
      else {
        const text = buf.toString('utf8').trim();
        if (text.startsWith('{') || text.startsWith('[')) collectJson(name, buf, sink);
        else collectText(name, buf, sink);
      }
    } catch (err) {
      pushError(sink.errors, `「${name}」导入失败：${err.message || '格式无法识别'}`);
    }
  }
}

function mergeWorkBackups(works) {
  const out = { projects: [], entries: [], days: [], templates: [], attachments: [], settings: null };
  for (const w of works) {
    for (const key of ['projects', 'entries', 'days', 'templates', 'attachments']) {
      if (Array.isArray(w[key])) out[key].push(...w[key]);
    }
    if (!out.settings && w.settings && typeof w.settings === 'object') out.settings = w.settings;
  }
  return out;
}

/* ------------------------------------------------------------ 导入：图片解析 */

function resolveNoteImages(list, { keepMissingMedia = false } = {}) {
  const pending = [];
  const keep = [];
  let missing = 0;
  for (const img of Array.isArray(list) ? list : []) {
    if (!img) continue;
    const data = img.data;
    if (Buffer.isBuffer(data)) {
      if (data.length) pending.push(data);
      continue;
    }
    if (typeof data === 'string' && data) {
      const buf = toBuffer(data);
      if (buf) pending.push(buf);
      continue;
    }
    const ref = img.ref || img.url || (typeof img === 'string' ? img : '');
    if (!ref) continue;
    const s = String(ref);
    if (/^data:/i.test(s)) {
      const buf = imageLib.parseDataUri(s);
      if (buf) pending.push(buf);
      continue;
    }
    if (s.startsWith('/media/')) {
      const rel = s.slice('/media/'.length);
      if (!rel || rel.includes('..')) continue;
      if (imageLib.existsSync(config.MEDIA_DIR, s)) {
        const item = { url: `/media/${rel}` };
        if (Number(img.w) > 0 && Number(img.h) > 0) {
          item.w = Math.round(Number(img.w));
          item.h = Math.round(Number(img.h));
        }
        keep.push(item);
      } else if (keepMissingMedia) {
        keep.push({ url: `/media/${rel}` });
        missing += 1;
      }
    }
  }
  return { pending, keep, missing };
}

/* ------------------------------------------------------------ 导入：笔记计划 */

async function planNotes(rawItems, opts) {
  const mode = opts.mode;
  const now = opts.now;
  const dryRun = Boolean(opts.dryRun);
  const db = store.db;
  const stats = { parsed: Array.isArray(rawItems) ? rawItems.length : 0, addable: 0, duplicates: 0, empty: 0, images: 0, missingImages: 0, errors: [] };
  const savedRels = [];
  const notes = [];
  const preview = [];
  const idMap = new Map();

  const seen = new Set();
  if (mode === 'merge') {
    for (const n of db.notes) {
      const key = N.keyOf(n);
      if (key) seen.add(key);
    }
  }
  const dbNoteIds = new Set(db.notes.map((n) => n.id));
  const usedIds = mode === 'merge' ? new Set(dbNoteIds) : new Set();
  const knownProjects = opts.projectIds || new Set((db.projects || []).map((p) => p.id));
  const knownEntries = opts.entryIds || new Set((db.entries || []).map((e) => e.id));
  const refMaps = opts.refMaps || null;
  const keepMissingMedia = Boolean(opts.keepMissingMedia);

  for (const raw0 of rawItems) {
    if (!raw0 || typeof raw0 !== 'object') {
      stats.empty += 1;
      continue;
    }
    const raw = { ...raw0 };
    if (refMaps) {
      if (raw.projectId && refMaps.projects && refMaps.projects.has(raw.projectId)) {
        raw.projectId = refMaps.projects.get(raw.projectId);
      }
      if (raw.entryId && refMaps.entries && refMaps.entries.has(raw.entryId)) {
        raw.entryId = refMaps.entries.get(raw.entryId);
      }
    }
    const resolved = resolveNoteImages(raw.images, { keepMissingMedia });
    stats.missingImages += resolved.missing;
    const images = resolved.keep;
    if (dryRun) {
      stats.images += resolved.pending.length;
    } else {
      for (const buf of resolved.pending) {
        try {
          const rel = await imageLib.saveImage(config.MEDIA_DIR, buf);
          savedRels.push(rel);
          const url = `/media/${rel}`;
          if (!images.some((x) => x.url === url)) images.push({ url });
          stats.images += 1;
        } catch (err) {
          pushError(stats.errors, `图片没能保存：${err.message || '未知错误'}`);
        }
      }
    }

    const note = N.normalizeNote(
      {
        ...raw,
        images,
        projectId: raw.projectId && knownProjects.has(raw.projectId) ? raw.projectId : null,
        entryId: raw.entryId && knownEntries.has(raw.entryId) ? raw.entryId : null,
      },
      now
    );
    const plain = richtext.htmlToText(note.content).trim();
    if (!plain && !note.seen && !note.think && !(note.images || []).length) {
      stats.empty += 1;
      continue;
    }
    const key = N.keyOf(note);
    if (!key) {
      stats.empty += 1;
      continue;
    }
    if (seen.has(key)) {
      stats.duplicates += 1;
      continue;
    }
    seen.add(key);

    const oldId = note.id;
    let id = oldId;
    if (!/^[\w-]{6,64}$/.test(String(id)) || usedIds.has(id)) id = crypto.randomUUID();
    note.id = id;
    usedIds.add(id);
    if (oldId) idMap.set(oldId, id);
    if (raw.updatedAt) note.updatedAt = Number(raw.updatedAt) || now;

    notes.push(note);
    stats.addable += 1;
    if (preview.length < 4) {
      preview.push({
        kind: 'note',
        title: richtext.summary(note.content, 40) || note.seen || note.think || '（无标题笔记）',
        sub: [ZONE_TEXT[note.zone] || '灵感', noteLib.typeLabel(note.type), noteLib.fmtDate(note.createdAt)].join(' · '),
        meta: '笔记',
      });
    }
  }

  // 派生关系重映射（导入时 id 可能被重发）
  for (const note of notes) {
    if (!note.derivedFrom) continue;
    if (idMap.has(note.derivedFrom)) note.derivedFrom = idMap.get(note.derivedFrom);
    else if (!dbNoteIds.has(note.derivedFrom)) note.derivedFrom = null;
  }

  return { notes, stats, savedRels, idMap, preview };
}

/* ------------------------------------------------------------ 导入：工作计划 */

async function planWork(rawWork, opts) {
  const mode = opts.mode;
  const now = opts.now;
  const dryRun = Boolean(opts.dryRun);
  const db = store.db;
  const replacing = mode === 'replace';
  // 合并全量备份时，同 id 视为「已存在」跳过（而不是重发 id 造成重复数据）
  const dedupeById = Boolean(opts.dedupeById);
  const src = rawWork && typeof rawWork === 'object' ? rawWork : {};
  const stats = {
    parsed: 0,
    addable: 0,
    duplicates: 0,
    images: 0,
    idConflicts: 0,
    missingFiles: 0,
    errors: [],
    projects: 0,
    entries: 0,
    days: 0,
    templates: 0,
    attachments: 0,
  };
  const savedRels = [];
  const projectIdMap = new Map();
  const entryIdMap = new Map();
  const projects = [];
  const entries = [];
  const templates = [];
  const attachments = [];
  const preview = [];

  const existingProjectIds = replacing ? new Set() : new Set((db.projects || []).map((p) => p.id));
  const existingEntryIds = replacing ? new Set() : new Set((db.entries || []).map((e) => e.id));
  const existingTemplateIds = replacing ? new Set() : new Set((db.templates || []).map((t) => t.id));

  /* ---- 项目 ---- */
  const rawProjects = Array.isArray(src.projects) ? src.projects : [];
  stats.parsed += rawProjects.length;
  for (const rp of rawProjects) {
    if (!rp || typeof rp !== 'object') {
      pushError(stats.errors, '跳过一个无效项目');
      continue;
    }
    const srcId = typeof rp.id === 'string' ? rp.id : null;
    const p = M.normalizeProject(
      { ...rp, weeklyGoalHours: rp.weeklyGoalHours != null ? rp.weeklyGoalHours : rp.weeklyTarget },
      now
    );
    if (!p) {
      pushError(stats.errors, '跳过一个缺少名称的项目');
      continue;
    }
    let id = p.id;
    if (existingProjectIds.has(id)) {
      if (dedupeById) {
        stats.duplicates += 1;
        if (srcId) projectIdMap.set(srcId, id);
        continue;
      }
      id = M.uid('p');
      stats.idConflicts += 1;
    }
    p.id = id;
    existingProjectIds.add(id);
    if (srcId) projectIdMap.set(srcId, id);
    projects.push(p);
    stats.projects += 1;
    stats.addable += 1;
  }
  const knownProjectIds = replacing ? new Set(projects.map((p) => p.id)) : new Set(existingProjectIds);

  /* ---- 记录 ---- */
  const rawEntries = Array.isArray(src.entries) ? src.entries : [];
  stats.parsed += rawEntries.length;
  for (const re of rawEntries) {
    if (!re || typeof re !== 'object') {
      pushError(stats.errors, '跳过一个无效记录');
      continue;
    }
    const srcId = typeof re.id === 'string' ? re.id : null;
    let projectId = re.projectId;
    if (projectId && projectIdMap.has(projectId)) projectId = projectIdMap.get(projectId);
    if (projectId && !knownProjectIds.has(projectId)) projectId = null;
    let minutes = re.minutes;
    if (minutes == null && re.hours != null) minutes = Math.round((Number(re.hours) || 0) * 60);
    const e = M.normalizeEntry({ ...re, projectId, minutes, attachmentIds: [] }, now);
    if (!e) {
      pushError(stats.errors, '跳过一个缺少标题或日期的记录');
      continue;
    }
    let id = e.id;
    if (existingEntryIds.has(id)) {
      if (dedupeById) {
        stats.duplicates += 1;
        if (srcId) entryIdMap.set(srcId, id);
        continue;
      }
      id = M.uid('e');
      stats.idConflicts += 1;
    }
    e.id = id;
    existingEntryIds.add(id);
    if (srcId) entryIdMap.set(srcId, id);
    entries.push(e);
    stats.entries += 1;
    stats.addable += 1;
    if (preview.length < 5 && !e.deletedAt) {
      preview.push({
        kind: 'entry',
        title: e.title,
        sub: `${e.date} · ${fmtHours((Number(e.minutes) || 0) / 60)}h · ${projectNameOf(projects, db, e.projectId)}`,
        meta: '记录',
      });
    }
  }

  /* ---- 当日总结 ---- */
  const rawDays = Array.isArray(src.days) ? src.days : [];
  stats.parsed += rawDays.length;
  const incomingDays = [];
  for (const rd of rawDays) {
    const d = M.normalizeDayLog(rd, now);
    if (!d) {
      pushError(stats.errors, '跳过一个无效的当日总结');
      continue;
    }
    incomingDays.push(d);
    stats.days += 1;
    stats.addable += 1;
  }
  let days;
  if (replacing) {
    days = incomingDays;
  } else {
    const map = new Map((db.days || []).map((d) => [d.date, d]));
    for (const d of incomingDays) {
      const cur = map.get(d.date);
      if (cur && !d.summary && cur.summary) continue;
      map.set(d.date, d);
    }
    days = [...map.values()];
  }

  /* ---- 模板 ---- */
  const rawTemplates = Array.isArray(src.templates) ? src.templates : [];
  stats.parsed += rawTemplates.length;
  for (const rt of rawTemplates) {
    if (!rt || typeof rt !== 'object') {
      pushError(stats.errors, '跳过一个无效模板');
      continue;
    }
    let projectId = rt.projectId;
    if (projectId && projectIdMap.has(projectId)) projectId = projectIdMap.get(projectId);
    if (projectId && !knownProjectIds.has(projectId)) projectId = null;
    let minutes = rt.minutes;
    if (minutes == null && rt.hours != null) minutes = Math.round((Number(rt.hours) || 0) * 60);
    const t = M.normalizeTemplate({ ...rt, projectId, minutes }, now);
    if (!t) {
      pushError(stats.errors, '跳过一个缺少名称的模板');
      continue;
    }
    let id = t.id;
    if (existingTemplateIds.has(id)) {
      if (dedupeById) {
        stats.duplicates += 1;
        continue;
      }
      id = M.uid('t');
      stats.idConflicts += 1;
    }
    t.id = id;
    existingTemplateIds.add(id);
    templates.push(t);
    stats.templates += 1;
    stats.addable += 1;
  }

  /* ---- 附件 ---- */
  const rawAtts = Array.isArray(src.attachments) ? src.attachments : [];
  stats.parsed += rawAtts.length;
  const entryById = new Map(entries.map((e) => [e.id, e]));
  for (const ra of rawAtts) {
    if (!ra || typeof ra !== 'object') {
      pushError(stats.errors, '跳过一个无效附件');
      continue;
    }
    let entryId = ra.entryId;
    if (entryId && entryIdMap.has(entryId)) entryId = entryIdMap.get(entryId);
    const entry = entryById.get(entryId);
    if (!entry) {
      if (dedupeById && (db.entries || []).some((e) => e.id === entryId)) {
        stats.duplicates += 1;
        continue;
      }
      pushError(stats.errors, `附件「${ra.name || '未命名'}」找不到对应的工作记录，已跳过`);
      continue;
    }

    let rel = null;
    let thumbRel = null;
    let bytes = Number(ra.size) || 0;

    if (typeof ra.rel === 'string' && ra.rel) {
      const cleanRel = ra.rel.replace(/^\/media\//, '').replace(/\\/g, '/');
      if (!cleanRel || cleanRel.includes('..') || nodePath.isAbsolute(cleanRel)) {
        pushError(stats.errors, `附件「${ra.name || '未命名'}」的路径不合法，已跳过`);
        continue;
      }
      rel = cleanRel;
      const exists = imageLib.existsSync(config.MEDIA_DIR, `/media/${rel}`);
      if (!exists && !dryRun) {
        stats.missingFiles += 1;
        pushError(stats.errors, `附件「${ra.name || rel}」的文件不在 media 里，已跳过`);
        continue;
      }
    } else {
      const buf = toBuffer(ra.data);
      if (!buf) {
        pushError(stats.errors, `附件「${ra.name || '未命名'}」内容为空，已跳过`);
        continue;
      }
      bytes = buf.length;
      if (dryRun) {
        stats.images += 1;
        stats.attachments += 1;
        stats.addable += 1;
        continue;
      }
      try {
        rel = await imageLib.saveImage(config.MEDIA_DIR, buf);
        savedRels.push(rel);
        stats.images += 1;
      } catch (err) {
        pushError(stats.errors, `附件「${ra.name || '未命名'}」没能保存：${err.message || '未知错误'}`);
        continue;
      }
      const thumbBuf = toBuffer(ra.thumb);
      if (thumbBuf) {
        try {
          thumbRel = await imageLib.saveImage(config.MEDIA_DIR, thumbBuf);
          savedRels.push(thumbRel);
        } catch (_) {
          thumbRel = null;
        }
      }
    }

    if (dryRun) {
      stats.attachments += 1;
      stats.addable += 1;
      continue;
    }

    const a = M.normalizeAttachment(
      {
        id: M.uid('a'),
        entryId: entry.id,
        date: ra.date || entry.date,
        name: ra.name,
        mime: ra.mime,
        size: bytes,
        rel,
        thumbRel,
        w: ra.w,
        h: ra.h,
      },
      now
    );
    if (!a) {
      pushError(stats.errors, `附件「${ra.name || '未命名'}」元数据不完整，已跳过`);
      continue;
    }
    attachments.push(a);
    entry.attachmentIds = [...(entry.attachmentIds || []), a.id].slice(0, 12);
    stats.attachments += 1;
    stats.addable += 1;
  }

  // 项目预览（放在记录后面，最多补两条）
  if (preview.length < 6) {
    for (const p of projects.slice(0, 2)) {
      preview.push({ kind: 'project', title: p.name, sub: '项目', meta: '项目' });
    }
  }

  return { projects, entries, days, templates, attachments, stats, savedRels, projectIdMap, entryIdMap, preview };
}

function projectNameOf(plans, db, projectId) {
  const p = (plans || []).find((x) => x.id === projectId);
  if (p) return p.name;
  const old = (db.projects || []).find((x) => x.id === projectId);
  return old && old.name ? old.name : '未分类';
}

/* ------------------------------------------------------------ 导入：落库 */

function applyWorkPlan(plan, mode, db) {
  if (mode === 'replace') {
    db.projects = plan.projects;
    db.entries = plan.entries;
    db.days = plan.days;
    db.templates = plan.templates;
    db.attachments = plan.attachments;
    // 记录被整体替换后，笔记里指向旧对象的两条软链接要断开，避免悬空
    const projectIds = new Set(db.projects.map((p) => p.id));
    const entryIds = new Set(db.entries.map((e) => e.id));
    for (const note of db.notes) {
      if (note.projectId && !projectIds.has(note.projectId)) note.projectId = null;
      if (note.entryId && !entryIds.has(note.entryId)) note.entryId = null;
    }
  } else {
    db.projects = [...db.projects, ...plan.projects];
    db.entries = [...db.entries, ...plan.entries];
    db.templates = [...db.templates, ...plan.templates];
    db.attachments = [...db.attachments, ...plan.attachments];
    db.days = plan.days; // 计划阶段已经与现有按 date 合并
  }
}

function applyNotesPlan(plan, mode, db) {
  let nextSeq = Math.max(1, Number(db.meta && db.meta.nextSeq) || 1);
  for (const note of plan.notes) {
    note.seq = nextSeq;
    nextSeq += 1;
  }
  if (!db.meta) db.meta = {};
  db.meta.nextSeq = nextSeq;
  db.notes = mode === 'replace' ? plan.notes : [...db.notes, ...plan.notes];
  return N.sanitizeDerived(db.notes);
}

/** 全量备份里的 media 直接按原 rel 落盘（不能用 saveImage：它会按当前月份建目录） */
async function writeWorkspaceMedia(media) {
  const written = [];
  if (!media || typeof media !== 'object') return written;
  for (const [rawRel, b64] of Object.entries(media)) {
    const rel = String(rawRel || '').replace(/\\/g, '/').replace(/^\/media\//, '');
    if (!rel || rel.includes('..') || nodePath.isAbsolute(rel)) continue;
    const buf = toBuffer(b64);
    if (!buf) continue;
    const abs = nodePath.join(config.MEDIA_DIR, rel);
    try {
      await fsp.mkdir(nodePath.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, buf);
      written.push(rel);
    } catch (err) {
      util.logError('import-media', err);
    }
  }
  return written;
}

/* ------------------------------------------------------------ POST /api/import */

async function handleImport(req, res, pathname) {
  if (req.method !== 'POST') {
    util.sendError(res, 405, '导入只支持 POST');
    return true;
  }

  let body;
  try {
    body = await util.readBody(req, config.MAX_IMPORT);
  } catch (err) {
    util.sendError(res, 400, err.message || '请求体解析失败');
    return true;
  }

  const mode = body.mode == null ? 'merge' : String(body.mode);
  if (mode !== 'merge' && mode !== 'replace') {
    util.sendError(res, 400, '导入方式只能是 merge 或 replace');
    return true;
  }
  const dryRun = body.dryRun === true;
  if (mode === 'replace' && body.confirmReplace !== true) {
    util.sendError(res, 400, '替换全部需要二次确认');
    return true;
  }
  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length) {
    util.sendError(res, 400, '没有收到文件');
    return true;
  }

  const now = Date.now();
  const db = store.db;
  const sink = { files: 0, notes: [], works: [], workspaces: [], errors: [] };
  await collectFiles(files, sink);

  const workspaceBackup = sink.workspaces.length ? sink.workspaces[0] : null;
  if (sink.workspaces.length > 1) pushError(sink.errors, '一次只能导入一个全量备份，后面的已忽略');
  const workRaw = sink.works.length ? mergeWorkBackups(sink.works) : null;
  const hasNotes = sink.notes.length > 0;

  if (!workspaceBackup && !workRaw && !hasNotes) {
    const first = sink.errors[0] || '文件里没有可识别的笔记或工作数据';
    util.sendError(res, 400, `没有识别到可导入的数据：${first}`, { errors: sink.errors });
    return true;
  }
  if (workspaceBackup && (hasNotes || workRaw)) {
    pushError(sink.errors, '检测到全量备份，其他文件不再单独导入');
  }

  let notePlan = null;
  let workPlan = null;
  let workspaceRaw = null;
  let workspaceMediaRels = [];
  const errors = [];

  try {
    if (workspaceBackup) {
      workspaceRaw = workspaceBackup.workspace;
      if (!workspaceRaw || typeof workspaceRaw !== 'object' || Array.isArray(workspaceRaw)) {
        util.sendError(res, 400, '全量备份里没有有效的 workspace 数据');
        return true;
      }
      if (!dryRun) workspaceMediaRels = await writeWorkspaceMedia(workspaceRaw.media);
      workPlan = await planWork(workspaceRaw, { mode, now, dryRun, dedupeById: mode === 'merge' });
      const projectIds = new Set(workPlan.projects.map((p) => p.id));
      const entryIds = new Set(workPlan.entries.map((e) => e.id));
      if (mode === 'merge') {
        for (const p of db.projects || []) projectIds.add(p.id);
        for (const e of db.entries || []) entryIds.add(e.id);
      }
      notePlan = await planNotes(Array.isArray(workspaceRaw.notes) ? workspaceRaw.notes : [], {
        mode,
        now,
        dryRun,
        projectIds,
        entryIds,
        keepMissingMedia: true,
        refMaps: { projects: workPlan.projectIdMap, entries: workPlan.entryIdMap },
      });
    } else {
      if (hasNotes) {
        notePlan = await planNotes(sink.notes, {
          mode,
          now,
          dryRun,
          projectIds: new Set((db.projects || []).map((p) => p.id)),
          entryIds: new Set((db.entries || []).map((e) => e.id)),
        });
      }
      if (workRaw) workPlan = await planWork(workRaw, { mode, now, dryRun });
    }
  } catch (err) {
    util.logError('import-plan', err);
    if (!res.headersSent) util.sendError(res, 500, `导入失败：${err.message || '解析数据时出错'}`);
    return true;
  }

  for (const e of sink.errors) pushError(errors, e);
  if (notePlan) for (const e of notePlan.stats.errors) pushError(errors, e);
  if (workPlan) for (const e of workPlan.stats.errors) pushError(errors, e);

  const kind = workspaceBackup ? 'workspace' : hasNotes && workRaw ? 'mixed' : workRaw ? 'work' : 'notes';
  const noteStats = notePlan ? notePlan.stats : { parsed: 0, addable: 0, duplicates: 0, empty: 0, images: 0 };
  const workStats = workPlan ? workPlan.stats : null;
  const totalAddable = noteStats.addable + (workStats ? workStats.addable : 0);
  const preview = [
    ...(notePlan ? notePlan.preview : []),
    ...(workPlan ? workPlan.preview : []),
  ].slice(0, 8);

  const counts = {
    parsed: noteStats.parsed + (workStats ? workStats.parsed : 0),
    addable: totalAddable,
    duplicates: noteStats.duplicates + (workStats ? workStats.duplicates : 0),
    empty: noteStats.empty,
    images: noteStats.images + (workStats ? workStats.images : 0),
    errors,
    notes: {
      parsed: noteStats.parsed,
      addable: noteStats.addable,
      duplicates: noteStats.duplicates,
      empty: noteStats.empty,
      totalAfter: dryRun ? (mode === 'replace' ? noteStats.addable : db.notes.length + noteStats.addable) : db.notes.length,
    },
    work: workStats
      ? {
          projects: workStats.projects,
          entries: workStats.entries,
          days: workStats.days,
          templates: workStats.templates,
          attachments: workStats.attachments,
          parsed: workStats.parsed,
          addable: workStats.addable,
          idConflicts: workStats.idConflicts,
          missingFiles: workStats.missingFiles,
        }
      : { projects: 0, entries: 0, days: 0, templates: 0, attachments: 0, parsed: 0, addable: 0, idConflicts: 0, missingFiles: 0 },
    preview,
  };

  // dryRun：什么都不写
  if (dryRun) {
    util.sendJson(res, 200, { ok: true, dryRun: true, mode, kind, ...counts });
    return true;
  }

  // 没有新增数据时不改动工作区（避免 replace 模式下空文件把数据清空）
  const mustReplace = Boolean(workspaceBackup) && mode === 'replace';
  if (totalAddable === 0 && !mustReplace) {
    util.sendJson(res, 200, {
      ok: true,
      dryRun: false,
      changed: false,
      mode,
      kind,
      message: '没有新增内容（可能是重复导入或文件为空），工作区未改动。',
      ...counts,
    });
    return true;
  }

  // 正式导入：先快照，再改内存，最后由 store.commit 落盘 / 回滚
  store.createSnapshot('pre-import');

  const before = {
    notes: db.notes,
    projects: db.projects,
    entries: db.entries,
    days: db.days,
    templates: db.templates,
    attachments: db.attachments,
    settings: db.settings,
    nextSeq: db.meta && db.meta.nextSeq,
  };
  const revert = () => {
    db.notes = before.notes;
    db.projects = before.projects;
    db.entries = before.entries;
    db.days = before.days;
    db.templates = before.templates;
    db.attachments = before.attachments;
    db.settings = before.settings;
    if (db.meta) db.meta.nextSeq = before.nextSeq;
  };

  let cutLinks = 0;
  try {
    if (workPlan) applyWorkPlan(workPlan, mode, db);
    if (notePlan) cutLinks = applyNotesPlan(notePlan, mode, db);
    if (workspaceBackup && mode === 'replace' && workspaceRaw.settings) {
      db.settings = M.normalizeSettings(workspaceRaw.settings, db.settings);
    }
  } catch (err) {
    revert();
    util.logError('import-apply', err);
    if (!res.headersSent) util.sendError(res, 500, `导入失败：${err.message || '写入数据时出错'}`);
    return true;
  }

  const savedRels = [
    ...workspaceMediaRels,
    ...(notePlan ? notePlan.savedRels : []),
    ...(workPlan ? workPlan.savedRels : []),
  ];
  const ok = await store.commit(res, revert);
  if (!ok) {
    // 503 已由 store.commit 发出；把这次刚落盘的图片清掉，避免留垃圾
    for (const rel of savedRels) {
      try {
        await store.removeMedia(rel);
      } catch (_) {
        /* 忽略 */
      }
    }
    return true;
  }

  const payload = {
    ok: true,
    dryRun: false,
    changed: true,
    mode,
    kind,
    ...counts,
    notes: {
      ...counts.notes,
      totalAfter: db.notes.length,
    },
    work: {
      ...counts.work,
      totalAfter: {
        projects: db.projects.length,
        entries: db.entries.length,
        days: db.days.length,
        templates: db.templates.length,
        attachments: db.attachments.length,
      },
    },
    cutLinks,
  };
  if (workspaceBackup) {
    payload.workspace = {
      notes: db.notes.length,
      entries: db.entries.length,
      projects: db.projects.length,
    };
  }
  if (workspaceBackup && mode === 'merge') {
    payload.message = '全量备份已合并进当前工作区：同正文的笔记、同 id 的项目 / 记录 / 模板视为已存在并跳过，附件随记录重建。';
  }
  util.sendJson(res, 200, payload);
  return true;
}

/* ------------------------------------------------------------ 路由入口 */

async function handle(req, res, pathname, query) {
  const route = String(pathname || '').split('?')[0].replace(/\/+$/, '');
  try {
    if (route === '/api/export') return await handleExport(req, res, pathname, query);
    if (route === '/api/import') return await handleImport(req, res, pathname, query);
    return false;
  } catch (err) {
    util.logError('transfer', err);
    if (!res.headersSent) util.sendError(res, 500, `导出/导入失败：${err.message || '未知错误'}`);
    return true;
  }
}

module.exports = handle;
module.exports.handle = handle;