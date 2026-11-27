'use strict';

/**
 * 知行 · 笔记路由（灵感 / 复盘）
 * 契约见 docs/API.md 第 1 节。归一化在 models/notes.js，链接在 lib/links.js。
 */

const crypto = require('crypto');
const C = require('../lib/constants');
const transfer = require('../lib/transfer');
const richtext = require('../lib/richtext');
const links = require('../lib/links');
const review = require('../lib/review');
const store = require('../store');
const N = require('../models/notes');
const images = require('../lib/images');
const config = require('../config');
const { sendJson, sendError, readBody, cleanText, logError } = require('../util');

const { ZONES, STAGES, DIDS, OUTCOMES, MISTAKES, TRIAGES, STATE_TAGS } = C;

const findNote = (id) => store.db.notes.find((n) => n.id === id) || null;
const one = (v) => (Array.isArray(v) ? v[0] : v);
const int = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

/** 全部记录 + 双向链接（反向引用必须看全量） */
function annotatedAll() {
  return links.annotate(store.db.notes);
}

/**
 * 列表筛选，与导出、统计保持同一口径。
 * 返回过滤后的记录（未 annotate，调用方按需 annotate）。
 */
function filterNotes(db, query, now = Date.now()) {
  const q = cleanText(query.get('q'), 200).toLowerCase();
  const tag = cleanText(query.get('tag'), 40);
  const type = cleanText(query.get('type'), 20);
  const zone = cleanText(query.get('zone'), 20);
  const stage = cleanText(query.get('stage'), 20);
  const status = cleanText(query.get('status'), 20);
  const desk = cleanText(query.get('desk'), 20);
  const projectId = cleanText(query.get('projectId'), 64);
  const entryId = cleanText(query.get('entryId'), 64);
  const days = Math.min(366, Math.max(1, int(query.get('days'), 7)));

  let list = db.notes;
  if (ZONES.includes(zone)) list = list.filter((n) => n.zone === zone);
  if (tag) list = list.filter((n) => (n.tags || []).includes(tag));
  if (transfer.TYPES[type]) list = list.filter((n) => n.type === type);
  if (STAGES.includes(stage)) list = list.filter((n) => n.stage === stage);
  if (projectId) list = list.filter((n) => n.projectId === projectId);
  if (entryId) list = list.filter((n) => n.entryId === entryId);
  if (status === 'open') list = list.filter((n) => !(n.result && n.result.outcome));
  if (status === 'settled') list = list.filter((n) => n.result && n.result.outcome);
  if (status === 'inbox') list = list.filter((n) => n.triage === 'inbox');
  if (query.get('growth') === 'pending') list = review.growthPending(list, now, days);
  if (query.get('incomplete') === '1') list = list.filter((n) => review.incompleteOf(n).length);
  if (desk && desk !== 'all') list = review.byDesk(list, desk);
  if (q) list = list.filter((n) => noteMatches(n, q));
  return list;
}

function noteMatches(n, q) {
  const body = [richtext.htmlToText(n.content || ''), n.seen, n.think, n.after && n.after.text]
    .filter(Boolean).join('\n').toLowerCase();
  if (body.includes(q)) return true;
  if ((n.tags || []).some((t) => String(t).toLowerCase().includes(q))) return true;
  if (n.trade && String(n.trade.symbol || '').toLowerCase().includes(q)) return true;
  if ((n.comments || []).some((c) => String(c.text || '').toLowerCase().includes(q))) return true;
  return false;
}

const sortNotes = (list) => [...list].sort((a, b) => {
  if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
  return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
});

/** 列表输出：加上链接、缺项，灵感区剥掉复盘字段 */
function listOut(list, zone) {
  const enriched = new Map(links.annotate(store.db.notes).map((n) => [n.id, n]));
  return list.map((n) => {
    const e = enriched.get(n.id) || n;
    const view = zone === 'inspiration' ? N.toZoneNote(e, 'inspiration') : { ...e };
    if (view.zone === 'review' || e.zone === 'review') view.incomplete = review.incompleteOf(e);
    return view;
  });
}

function hasContent(note, body) {
  if (body.text !== undefined && cleanText(body.text)) return true;
  if (body.seen !== undefined && cleanText(body.seen)) return true;
  if (body.think !== undefined && cleanText(body.think)) return true;
  if (body.content !== undefined && richtext.htmlToText(richtext.sanitizeHtml(body.content))) return true;
  if (Array.isArray(body.images) && body.images.length) return true;
  return Boolean(richtext.htmlToText(note.content) || note.seen || note.think || (note.images || []).length);
}

/* ------------------------------------------------------------------ 路由 */

async function handle(req, res, pathname, query) {
  const db = store.db;
  const now = Date.now();

  /* ---- 媒体上传（笔记正文图片，不建附件行） ---- */
  if (pathname === '/api/media' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, config.MAX_UPLOAD); } catch (e) { sendError(res, 400, e.message); return true; }
    const data = typeof body.data === 'string' ? body.data : '';
    const buf = data.startsWith('data:') ? images.parseDataUri(data) : (data ? Buffer.from(data, 'base64') : null);
    if (!buf || !buf.length) { sendError(res, 400, '图片内容为空'); return true; }
    try {
      const rel = await images.saveImage(config.MEDIA_DIR, buf);
      const w = Number(body.w) > 0 ? Math.round(Number(body.w)) : null;
      const h = Number(body.h) > 0 ? Math.round(Number(body.h)) : null;
      return sendJson(res, 201, { ok: true, image: { url: `/media/${rel}`, w, h } }), true;
    } catch (err) {
      sendError(res, 400, err.message || '图片没存下来');
      return true;
    }
  }

  /* ---- 列表 / 新建 ---- */
  if (pathname === '/api/notes') {
    if (req.method === 'GET') {
      const zone = cleanText(query.get('zone'), 20);
      const filtered = filterNotes(db, query, now);
      const sorted = sortNotes(filtered);
      const notes = listOut(sorted, ZONES.includes(zone) ? zone : '');
      const desk = review.deskCounts(db.notes.filter((n) => n.zone === 'review'));
      return sendJson(res, 200, { ok: true, notes, total: notes.length, desk }), true;
    }
    if (req.method === 'POST') {
      let body;
      try { body = await readBody(req); } catch (e) { sendError(res, 400, e.message); return true; }
      const probe = N.normalizeNote(body, now);
      if (!hasContent(probe, body)) {
        sendError(res, 400, '写点什么再存（文字或图片至少要有一个）');
        return true;
      }
      const note = N.normalizeNote(body, now);
      note.seq = db.meta.nextSeq;
      if (note.derivedFrom) {
        if (!findNote(note.derivedFrom)) { sendError(res, 400, '承接的那条记录不在了'); return true; }
        if (N.derivedWouldCycle(db.notes, note.id, note.derivedFrom)) {
          sendError(res, 400, '承接关系成环了，换一条');
          return true;
        }
      }
      N.fixStage(note);
      if (note.result && note.result.outcome) { note.frozen = true; note.legacy = false; }
      db.meta.nextSeq += 1;
      db.notes.push(note);
      const ok = await store.commit(res, () => {
        const i = db.notes.findIndex((n) => n.id === note.id);
        if (i >= 0) db.notes.splice(i, 1);
        db.meta.nextSeq = Math.max(1, db.meta.nextSeq - 1);
      });
      if (!ok) return true;
      return sendJson(res, 201, { ok: true, note }), true;
    }
    sendError(res, 405, 'method not allowed');
    return true;
  }

  /* ---- 评论区 ---- */
  let m = pathname.match(/^\/api\/notes\/([\w-]+)\/comments(?:\/([\w-]+))?$/);
  if (m) {
    const note = findNote(m[1]);
    if (!note) { sendError(res, 404, '这条记录不在了'); return true; }

    if (!m[2] && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, comments: note.comments || [] }), true;
    }
    if (!m[2] && req.method === 'POST') {
      let body;
      try { body = await readBody(req); } catch (e) { sendError(res, 400, e.message); return true; }
      const text = cleanText(body.text, 500);
      if (!text) { sendError(res, 400, '写点什么再留言'); return true; }
      if ((note.comments || []).length >= 300) { sendError(res, 400, '这条留言太多了（上限 300 条）'); return true; }
      const comment = { id: crypto.randomUUID(), text, at: now };
      note.comments.push(comment);
      const ok = await store.commit(res, () => {
        note.comments = note.comments.filter((c) => c.id !== comment.id);
      });
      if (!ok) return true;
      return sendJson(res, 201, { ok: true, comment, comments: note.comments }), true;
    }
    if (m[2] && req.method === 'DELETE') {
      const before = note.comments;
      const rest = before.filter((c) => c.id !== m[2]);
      if (rest.length === before.length) { sendError(res, 404, '留言不存在'); return true; }
      note.comments = rest;
      const ok = await store.commit(res, () => { note.comments = before; });
      if (!ok) return true;
      return sendJson(res, 200, { ok: true, comments: note.comments }), true;
    }
    sendError(res, 405, 'method not allowed');
    return true;
  }

  /* ---- 结果 / 事后 ---- */
  m = pathname.match(/^\/api\/notes\/([\w-]+)\/(result|after)$/);
  if (m && req.method === 'POST') {
    const note = findNote(m[1]);
    if (!note) { sendError(res, 404, '这条记录不在了'); return true; }
    let body;
    try { body = await readBody(req); } catch (e) { sendError(res, 400, e.message); return true; }
    const restore = store.restorer(note);

    if (m[2] === 'result') {
      if (note.result && note.result.outcome) {
        sendError(res, 409, '结果已经记过，不能重复结。要补充请写「事后想想」。');
        return true;
      }
      const result = N.normalizeResult({ outcome: body.outcome, note: body.note, at: now });
      if (!result) { sendError(res, 400, 'outcome 必须是 right / wrong / unclear'); return true; }
      note.result = result;
      note.frozen = true;
      note.legacy = false;
      if (MISTAKES.includes(body.mistake)) {
        note.trade = note.trade || {};
        note.trade.mistake = body.mistake;
      }
      if (OUTCOMES.includes(body.callRight)) note.callRight = body.callRight;
    } else {
      const after = N.normalizeAfter({ text: body.text, at: now });
      note.after = after || null;
    }
    note.updatedAt = now;
    if (!(await store.commit(res, restore))) return true;
    return sendJson(res, 200, { ok: true, note }), true;
  }

  /* ---- 单条：看 / 改 / 删 ---- */
  m = pathname.match(/^\/api\/notes\/([\w-]+)$/);
  if (m) {
    const note = findNote(m[1]);
    if (!note) { sendError(res, 404, '这条记录不在了'); return true; }

    if (req.method === 'GET') {
      const all = annotatedAll();
      const enriched = all.find((n) => n.id === note.id) || note;
      const zone = cleanText(query.get('zone'), 20);
      const view = zone === 'inspiration' ? N.toZoneNote(enriched, 'inspiration') : enriched;
      return sendJson(res, 200, {
        ok: true,
        note: view,
        refs: enriched.refs || [],
        backrefs: enriched.backrefs || [],
        incomplete: review.incompleteOf(note),
      }), true;
    }

    if (req.method === 'PATCH') {
      let body;
      try { body = await readBody(req); } catch (e) { sendError(res, 400, e.message); return true; }
      const restore = store.restorer(note);
      const oldImages = (note.images || []).slice();

      // 冻结检查：只对「这条记录是什么」的字段生效
      const touched = config.FROZEN_FIELDS
        ? config.FROZEN_FIELDS.filter((f) => body[f] !== undefined && JSON.stringify(body[f]) !== JSON.stringify(note[f]))
        : [];
      if (note.frozen && touched.length && !(body.revision && cleanText(body.revision.reason))) {
        sendError(res, 409, '这条已经结了果，想法不能再改。要改请带修订理由。', { frozen: true, fields: touched });
        return true;
      }
      const reason = cleanText(body.revision && body.revision.reason, 200);
      if (note.frozen && touched.length && reason) {
        for (const field of touched) {
          note.revisions.push({
            at: now,
            field,
            before: typeof note[field] === 'object' ? JSON.stringify(note[field]) : String(note[field] == null ? '' : note[field]),
            reason,
          });
        }
        if (note.revisions.length > 50) note.revisions = note.revisions.slice(-50);
      }

      if (body.content !== undefined) {
        const clean = richtext.sanitizeHtml(body.content);
        if (clean) note.content = clean;
      }
      if (body.seen !== undefined) note.seen = cleanText(body.seen);
      if (body.think !== undefined) note.think = cleanText(body.think);
      if (body.text !== undefined && body.seen === undefined && body.think === undefined) {
        note.think = cleanText(body.text);
      }
      if (body.bet !== undefined) note.bet = N.normalizeBet(body.bet);
      if (body.did !== undefined && DIDS.includes(body.did)) {
        note.did = body.did;
        if (body.did !== 'skipped') note.skipReason = '';
      }
      if (body.skipReason !== undefined && note.did === 'skipped') note.skipReason = cleanText(body.skipReason, 200);
      if (body.tags !== undefined) note.tags = N.normalizeTags(body.tags);
      if (body.type !== undefined) note.type = transfer.normalizeType(body.type);
      if (body.trade !== undefined) note.trade = N.normalizeTrade(body.trade);
      if (body.images !== undefined) note.images = N.normalizeImages(body.images);
      if (typeof body.pinned === 'boolean') note.pinned = body.pinned;
      if (body.projectId !== undefined) {
        note.projectId = body.projectId && /^[\w-]{2,64}$/.test(body.projectId) ? body.projectId : null;
      }
      if (body.entryId !== undefined) {
        note.entryId = body.entryId && /^[\w-]{2,64}$/.test(body.entryId) ? body.entryId : null;
      }

      if (body.zone !== undefined) {
        note.zone = C.normalizeZone(body.zone, note.type);
        if (note.zone !== 'review') note.stage = null;
      }
      if (body.stage !== undefined) {
        note.stage = C.normalizeStage(body.stage, note.zone)
          || (note.zone === 'review' ? C.stageFromNote(note.zone, { trade: note.trade, bet: note.bet, did: note.did }) : null);
      }

      if (body.after !== undefined) note.after = N.normalizeAfter(body.after);
      if (body.triage !== undefined && TRIAGES.includes(body.triage)) note.triage = body.triage;
      if (body.growth !== undefined) {
        note.growth = C.normalizeGrowth(body.growth);
        note.growthAt = note.growth ? now : null;
      }
      if (body.callRight !== undefined) note.callRight = C.normalizeCallRight(body.callRight);
      if (body.mistake !== undefined) {
        note.trade = note.trade || {};
        if (MISTAKES.includes(body.mistake)) note.trade.mistake = body.mistake;
        else delete note.trade.mistake;
        if (!Object.keys(note.trade).length) note.trade = null;
      }
      if (body.result !== undefined && !note.result) {
        const r = N.normalizeResult(body.result);
        if (r) { note.result = r; note.frozen = true; note.legacy = false; }
      }

      if (!richtext.htmlToText(note.content) && !note.seen && !note.think && !(note.images || []).length) {
        restore();
        sendError(res, 400, '写点什么再存（文字或图片至少要有一个）');
        return true;
      }
      N.fixStage(note);
      note.updatedAt = now;
      if (!(await store.commit(res, restore))) return true;
      // 编辑时删掉的图，没人引用就回收
      const kept = new Set((note.images || []).map((i) => i.url));
      const dropped = oldImages.filter((i) => !kept.has(i.url));
      if (dropped.length) store.gcMedia().catch((err) => logError('gc', err));
      return sendJson(res, 200, { ok: true, note }), true;
    }

    if (req.method === 'DELETE') {
      const index = db.notes.findIndex((n) => n.id === note.id);
      const removed = note;
      db.notes = db.notes.filter((n) => n.id !== note.id);
      const ok = await store.commit(res, () => {
        if (index >= 0) db.notes.splice(index, 0, removed);
        else db.notes.push(removed);
      });
      if (!ok) return true;
      store.gcMedia().catch((err) => logError('gc', err));
      return sendJson(res, 200, { ok: true, id: removed.id }), true;
    }
    sendError(res, 405, 'method not allowed');
    return true;
  }

  /* ---- 归因 / 深度复盘 ---- */
  if (pathname === '/api/review/week' && req.method === 'GET') {
    const days = Math.min(31, Math.max(1, int(query.get('days'), 7)));
    const pool = store.db.notes.filter((n) => n.zone === 'review');
    const picks = review.weekPicks(pool, now, days).slice(0, 40);
    return sendJson(res, 200, {
      ok: true,
      days,
      weekStart: now - days * 864e5,
      picks: picks.map(({ note, weight }) => ({
        id: note.id,
        seq: note.seq || 0,
        stage: note.stage,
        symbol: (note.trade && note.trade.symbol) || '',
        seen: note.seen || '',
        think: note.think || '',
        outcome: note.result ? note.result.outcome : null,
        mistake: (note.trade && note.trade.mistake) || '',
        growth: note.growth || null,
        incomplete: review.incompleteOf(note),
        weight,
        createdAt: note.createdAt,
      })),
    }), true;
  }

  if (pathname === '/api/review/next' && req.method === 'GET') {
    const poolNotes = store.db.notes.filter((n) => n.zone === 'review');
    const picked = review.pickDailyCard(poolNotes, now);
    const lastReviewAt = poolNotes
      .filter((n) => n.review && n.review.at)
      .reduce((max, n) => Math.max(max, n.review.at), 0);
    return sendJson(res, 200, {
      ok: true,
      card: picked.card ? review.toBlindCard(picked.card, now) : null,
      ageMin: picked.ageMin,
      pool: picked.pool,
      lastReviewAt: lastReviewAt || null,
    }), true;
  }

  m = pathname.match(/^\/api\/review\/([\w-]+)\/(reveal|verdict)$/);
  if (m) {
    const note = findNote(m[1]);
    if (!note) { sendError(res, 404, '这条记录不在了'); return true; }
    if (m[2] === 'reveal' && req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        reveal: { think: note.think, bet: note.bet, result: note.result, after: note.after, createdAt: note.createdAt },
      }), true;
    }
    if (m[2] === 'verdict' && req.method === 'POST') {
      let body;
      try { body = await readBody(req); } catch (e) { sendError(res, 400, e.message); return true; }
      if (!review.VERDICTS.includes(body.verdict)) {
        sendError(res, 400, 'verdict 必须是 same / better / worse / both_wrong');
        return true;
      }
      const restore = store.restorer(note);
      note.review = {
        at: now,
        verdict: body.verdict,
        newThink: cleanText(body.newThink, 4000),
        newConf: Number(body.newConf) || null,
      };
      note.updatedAt = now;
      if (!(await store.commit(res, restore))) return true;
      return sendJson(res, 200, { ok: true, note }), true;
    }
    sendError(res, 405, 'method not allowed');
    return true;
  }

  if (pathname === '/api/ruler' && req.method === 'GET') {
    const scoped = store.db.notes.filter((n) => n.zone === 'review');
    return sendJson(res, 200, {
      ok: true,
      zone: 'review',
      verdicts: review.verdictStats(scoped, now),
      calibration: review.calibration(scoped, now),
      skipped: review.skippedStats(scoped, now),
      funnel: review.funnel(scoped),
      mistakes: review.mistakeStats(scoped),
      callHit: review.callHitStats(scoped),
      growth: review.growthStats(scoped),
      execution: review.executionStats(scoped),
    }), true;
  }

  if (pathname === '/api/stats/notes' && req.method === 'GET') {
    const zoneParam = cleanText(query.get('zone'), 20);
    const zone = ZONES.includes(zoneParam) ? zoneParam : 'review';
    return sendJson(res, 200, { ok: true, ...statsFor(zone) }), true;
  }

  return false;
}

/** 笔记统计：灵感 / 复盘两套口径，供 /api/stats/notes 与 /api/insights 共用 */
function statsFor(zone, now = Date.now()) {
  const scoped = store.db.notes.filter((n) => n.zone === zone);
  const weekAgo = now - 7 * 864e5;
  const tags = new Map();
  const byType = { review: 0, strategy: 0, insight: 0, idea: 0 };
  for (const n of scoped) {
    for (const t of n.tags || []) if (!STATE_TAGS.includes(t)) tags.set(t, (tags.get(t) || 0) + 1);
    byType[transfer.normalizeType(n.type)] += 1;
  }
  const tagCloud = [...tags.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  const stateTags = [...new Set(scoped.flatMap((n) => (n.tags || []).filter((t) => STATE_TAGS.includes(t))))];
  const inbox = scoped.filter((n) => n.triage === 'inbox').length;
  const pinned = scoped.filter((n) => n.pinned).length;
  const week = scoped.filter((n) => (n.createdAt || 0) > weekAgo).length;

  if (zone === 'inspiration') {
    return {
      zone,
      total: scoped.length,
      week,
      inbox,
      filed: scoped.length - inbox,
      pinned,
      byType,
      tags: tagCloud,
      stateTags,
    };
  }

  const settledCount = scoped.filter((n) => n.result && n.result.outcome).length;
  const withPnl = scoped.filter((n) => n.type === 'review' && n.trade && typeof n.trade.pnl === 'number');
  const wins = withPnl.filter((n) => n.trade.pnl > 0).length;
  const pnl = withPnl.reduce((sum, n) => sum + n.trade.pnl, 0);
  return {
    zone,
    total: scoped.length,
    week,
    pinned,
    inbox,
    settled: settledCount,
    open: scoped.length - settledCount,
    byType,
    stateTags,
    review: {
      count: byType.review,
      settled: withPnl.length,
      wins,
      winRate: withPnl.length ? Math.round((wins / withPnl.length) * 100) : null,
      pnl: Math.round(pnl * 100) / 100,
    },
    tags: tagCloud,
  };
}

module.exports = { handle, filterNotes, noteMatches, sortNotes, listOut, statsFor };