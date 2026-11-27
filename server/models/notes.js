'use strict';

/**
 * 知行 · 笔记模型（灵感 / 复盘）
 * 归一化层从 inspiration/server.js 移植并扩展：新增 projectId / entryId / dueAt。
 * 这里只做「形状规约」，不碰磁盘。
 */

const path = require('path');
const crypto = require('crypto');
const C = require('../lib/constants');
const transfer = require('../lib/transfer');
const richtext = require('../lib/richtext');
const { cleanText, round2, numOrNull, computeR } = require('../util');

const {
  SIDES, DIDS, HORIZONS, OUTCOMES, TAGS_MAX,
  ZONES, STAGES, GROWTHS, TRIAGES, STATE_TAGS,
  MISTAKES, MISTAKE_GROUPS, MISTAKE_GROUP_OF,
  zoneFromType, stageFromNote, normalizeZone, normalizeStage, normalizeGrowth, normalizeCallRight,
} = C;

/**
 * R 倍数口径（唯一实现，别在别处再算一遍）
 *   risk 必须是正数：0 / 空 / 负数 一律视为「没填风险」→ 不出 R（null）。
 *   pnl 可以是负数；结果钳制在 ±100（手滑填错数字时宁可截断）。
 */
/**
 * 交易要素。
 * 记的时候只需要 标的 / 方向 / 盈亏 / 执行度；
 * 事后（结结果或编辑时）可以补 手数 / 入场 / 止损 / 目标 / 单笔风险，
 * 单笔风险与盈亏同时存在时算出 R 倍数 —— 只有 R 才是可跨品种比较的单位。
 */
function normalizeTrade(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const trade = {};
  const symbol = String(raw.symbol || '').trim().slice(0, 24);
  if (symbol) trade.symbol = symbol;
  if (SIDES.includes(raw.side)) trade.side = raw.side;

  const pnl = numOrNull(raw.pnl);
  if (pnl !== null) trade.pnl = pnl;

  const rating = Number(raw.rating);
  if (rating >= 1 && rating <= 5) trade.rating = Math.round(rating);

  const qty = numOrNull(raw.qty, { min: 0, max: 100000, digits: 0 });
  if (qty) trade.qty = qty;
  const entry = numOrNull(raw.entry, { min: 0, max: 1e8, digits: 4 });
  if (entry !== null) trade.entry = entry;
  const stop = numOrNull(raw.stop, { min: 0, max: 1e8, digits: 4 });
  if (stop !== null) trade.stop = stop;
  const target = numOrNull(raw.target, { min: 0, max: 1e8, digits: 4 });
  if (target !== null) trade.target = target;
  const risk = numOrNull(raw.risk, { min: 0, max: 1e12, digits: 2 });
  if (risk) trade.risk = risk;

  // R 倍数：只由「盈亏 ÷ 单笔风险」算，不接受前端直接填（避免又变成手填数字）
  const rMultiple = computeR(trade.pnl, trade.risk);
  if (rMultiple !== null) trade.rMultiple = rMultiple;

  // 事后字段：十项白名单，白名单外不入库
  if (MISTAKES.includes(raw.mistake)) trade.mistake = raw.mistake;
  return Object.keys(trade).length ? trade : null;
}

/** 押注：把握 1-5 整数（不许百分比，70% 是假精确）/ 多久见分晓 / 失效条件 */
function normalizeBet(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const bet = {};
  const conf = Number(raw.conf);
  if (Number.isFinite(conf) && conf >= 1 && conf <= 5) bet.conf = Math.round(conf);
  if (HORIZONS.includes(raw.horizon)) bet.horizon = raw.horizon;
  const invalid = cleanText(raw.invalid, 200);
  if (invalid) bet.invalid = invalid;
  return Object.keys(bet).length ? bet : null;
}

function normalizeResult(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!OUTCOMES.includes(raw.outcome)) return null;
  return {
    outcome: raw.outcome,
    note: cleanText(raw.note, 2000),
    at: Number(raw.at) || Date.now(),
  };
}

function normalizeAfter(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = cleanText(raw.text, 8000);
  if (!text) return null;
  return { text, at: Number(raw.at) || Date.now() };
}

function normalizeRevisions(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((r) => (r && r.field ? {
      at: Number(r.at) || Date.now(),
      field: String(r.field).slice(0, 24),
      before: String(r.before == null ? '' : r.before).slice(0, 4000),
      reason: String(r.reason || '').slice(0, 200),
    } : null))
    .filter(Boolean)
    .slice(-50);
}

/** 只接受本站 /media/ 下的图片地址，别的一条都不认 */
function normalizeImages(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((img) => {
      const url = typeof img === 'string' ? img : img && img.url;
      if (typeof url !== 'string' || !url.startsWith('/media/')) return null;
      const clean = url.replace(/^\/media\//, '');
      if (!clean || clean.includes('..')) return null;
      const item = { url: `/media/${clean}` };
      const w = Number(img && img.w);
      const h = Number(img && img.h);
      if (w > 0 && h > 0) { item.w = Math.round(w); item.h = Math.round(h); }
      return item;
    })
    .filter(Boolean)
    .slice(0, 9);
}

/**
 * 留言（一条灵感/记录下面的短评论）。
 * 只存「谁在什么时候说了什么」——没有嵌套、没有编辑，「删」就是真删。
 * at 是留言时间，跟记录的 createdAt/updatedAt 完全无关：留言不该改动卡片时间。
 */
function normalizeComments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      if (!c || typeof c !== 'object') return null;
      const text = cleanText(c.text, 1000);
      if (!text) return null;
      return {
        id: typeof c.id === 'string' && /^[\w-]{6,64}$/.test(c.id) ? c.id : crypto.randomUUID(),
        text,
        at: Number(c.at) || Date.now(),
      };
    })
    .filter(Boolean)
    .slice(-300);
}

function normalizeTags(raw) {
  const tags = Array.isArray(raw) ? raw : String(raw || '').split(/[\s,，、]+/);
  return [...new Set(
    tags
      .map((t) => String(t).trim().replace(/^#+/, '').slice(0, 24))
      .filter(Boolean)
  )].slice(0, TAGS_MAX);
}

/**
 * 记录组装（v4）。
 * 兼容 v1/v2 的 { text }：text 落到 think，并标 legacy（不进回看队列，因为遮不出「看到」）。
 * zone 缺省按 type 推导；stage/triage/growth 缺省按规则补，不覆原值。
 *
 * 灵感区的落位约定（重要，去重键与盲卡都依赖它）：
 *   灵感条目 `seen` 恒为空、正文一律落 `think`、`stage` 恒 null、`triage` 默认 inbox。
 *   所以灵感的去重键等价于「正文归一化」，不会出现「看到/想到各写一半」的形态。
 */
function normalizeNote(raw, now) {
  const hasV3 = raw && (raw.seen !== undefined || raw.think !== undefined);
  const legacyText = raw && !hasV3 && typeof raw.text === 'string' ? cleanText(raw.text) : '';
  const seen = hasV3 ? cleanText(raw.seen) : '';
  const think = hasV3 ? cleanText(raw.think) : legacyText;
  // 正文唯一写入位（v5）：消毒后的 HTML。老记录 / 导入的纯文本在这里一次性包成 <p>，
  // 之后 seen/think 只作为「只读兼容字段」保留，不再由记录页写入。
  const content = richtext.sanitizeHtml(raw && raw.content)
    || richtext.fromLegacy(seen, think);
  const type = transfer.normalizeType(raw && raw.type);
  const zone = normalizeZone(raw && raw.zone, type);
  const trade = normalizeTrade(raw && raw.trade);
  const bet = normalizeBet(raw && raw.bet);
  const did = DIDS.includes(raw && raw.did)
    ? raw.did
    : (raw && raw.stage === 'trade' ? 'acted' : 'none');   // 交易层级缺省即「做了」
  const result = normalizeResult(raw && raw.result);
  const derivedFrom = raw && typeof raw.derivedFrom === 'string'
    && /^[\w-]{6,64}$/.test(raw.derivedFrom) && raw.derivedFrom !== raw.id
    ? raw.derivedFrom        // 自指直接丢弃（导入外部文件时可能出现）
    : null;
  // 融合层：记录可以挂到项目 / 某条工作记录上（两条软链接，断开不影响正文）
  const projectId = raw && typeof raw.projectId === 'string' && /^[\w-]{2,64}$/.test(raw.projectId)
    ? raw.projectId : null;
  const entryId = raw && typeof raw.entryId === 'string' && /^[\w-]{2,64}$/.test(raw.entryId)
    ? raw.entryId : null;

  return {
    id: (raw && raw.id) || crypto.randomUUID(),
    // 人读序号：#12 写在正文里就是 @12 引用（0 表示待分配，loadDb / POST 负责发号）
    seq: Math.max(0, Math.trunc(Number(raw && raw.seq) || 0)),
    zone,
    type,
    stage: normalizeStage(raw && raw.stage, zone) || stageFromNote(zone, { trade, bet, did }),
    content,
    seen,
    think,
    bet,
    did,
    skipReason: raw && raw.did === 'skipped' ? cleanText(raw.skipReason, 200) : '',
    trade,
    result,
    callRight: normalizeCallRight(raw && raw.callRight),   // 没做的思路后来对不对
    after: normalizeAfter(raw && raw.after),
    growth: normalizeGrowth(raw && raw.growth),           // ↑ = ↓，与 review.verdict 分开
    growthAt: normalizeGrowth(raw && raw.growth) ? (Number(raw.growthAt) || now) : null,
    triage: TRIAGES.includes(raw && raw.triage)
      ? raw.triage
      : (result && result.outcome ? 'filed' : 'inbox'),
    // 软链接：这条是从哪条灵感/判断长出来的（不复制正文，只留指针）
    derivedFrom,
    projectId,
    entryId,
    frozen: Boolean(raw && (raw.frozen || (raw && raw.result && raw.result.outcome))),
    revisions: normalizeRevisions(raw && raw.revisions),
    review: raw && raw.review && raw.review.verdict ? {
      at: Number(raw.review.at) || now,
      verdict: raw.review.verdict,
      newThink: cleanText(raw.review.newThink, 4000),
      newConf: Number(raw.review.newConf) || null,
    } : null,
    legacy: raw && raw.legacy !== undefined ? Boolean(raw.legacy) : Boolean(legacyText),
    images: normalizeImages(raw && raw.images),
    comments: normalizeComments(raw && raw.comments),
    tags: normalizeTags(raw && raw.tags),
    pinned: Boolean(raw && raw.pinned),
    createdAt: Number(raw && raw.createdAt) || now,
    updatedAt: now,
  };
}

/**
 * 层级自洽（不再拒收）。
 *
 * 历史：v1 这里有两道 400 硬门（判断缺认错条件、交易缺标的/方向）。
 * 复盘重构 v2 把它们拆掉了 —— 写不出认错条件不该让整条记录作废。
 * 现在只保留一条**静默修正**：没下单就不可能是「交易」层，按 stageFromNote 重推，
 * 与 loadDb 启动修复的口径完全一致（见迁移修复块）。
 *
 * 「还欠什么」由 review.incompleteOf 派生，进补全池，不挡保存。
 */
function fixStage(note) {
  if (note.zone !== 'review') return;
  if (note.stage === 'trade' && note.did !== 'acted') {
    // 与启动时的 v4 数据修复（loadDb 第 474 行）保持同一口径，否则会来回抖动
    note.stage = note.bet && note.bet.invalid ? 'judgment' : 'idea';
  }
}

/** 灵感区不下发任何复盘字段（接口层隔离，不只靠前端不渲染） */
function toZoneNote(note, zone) {
  if (zone !== 'inspiration') return note;
  return {
    id: note.id,
    seq: note.seq || 0,
    zone: note.zone,
    type: note.type,
    content: note.content || '',
    seen: note.seen,
    think: note.think,
    triage: note.triage,
    legacy: note.legacy,
    images: note.images,
    comments: note.comments || [],
    tags: note.tags,
    pinned: note.pinned,
    projectId: note.projectId || null,
    entryId: note.entryId || null,
    refs: note.refs || [],
    backrefs: note.backrefs || [],
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}


/** 用于去重的正文键：正文纯文本（v5 起以 content 为准，老记录 content 由 seen+think 生成） */
const keyOf = (n) => transfer.dedupeKey(richtext.htmlToText(n.content || `${n.seen || ''}\n${n.think || ''}`));

/**
 * 软链接的两种坏形状，只在这里判：
 *  - 自指：id === derivedFrom（normalizeNote 已丢）
 *  - 成环：A→B→A（导入外部包才会出现；正常 UI 只会从旧记录指向新记录）
 *
 * 做法：从 parent 沿 derivedFrom 往上走最多 32 跳，途中撞到 childId 就是环。
 * 32 跳足够（高于任何真实链条长度），也顺便挡住「有人手工造了长链做 DoS」。
 */
function derivedWouldCycle(list, childId, parentId) {
  if (!parentId) return false;
  if (childId === parentId) return true;
  const byId = new Map(list.map((n) => [n.id, n]));
  let cur = parentId;
  for (let hop = 0; hop < 32 && cur; hop += 1) {
    if (cur === childId) return true;
    const parent = byId.get(cur);
    cur = parent && parent.derivedFrom;
  }
  return false;
}

/**
 * 清洗一整个列表里的 derivedFrom：自指 / 成环 / 指向不存在的记录。
 * 「指向不存在」默认**保留**（删除上游不应悄悄改写下游），只标 derivedOrphan 给前端；
 * 但成环必须切断，否则任何沿链遍历的地方都可能死循环。
 * @returns {number} 被切断的条数
 */
function sanitizeDerived(list) {
  let cut = 0;
  for (const n of list) {
    if (!n.derivedFrom) continue;
    if (derivedWouldCycle(list, n.id, n.derivedFrom)) {
      n.derivedFrom = null;
      cut += 1;
    }
  }
  return cut;
}

/** 列表响应里给「上游已删」的承接关系打标（只影响展示，不写盘） */
function withDerivedFlag(list, allNotes = list) {
  const ids = new Set(allNotes.map((n) => n.id));
  return list.map((n) => (n.derivedFrom && !ids.has(n.derivedFrom)
    ? { ...n, derivedOrphan: true }
    : n));
}

module.exports = {
  cleanText,
  round2,
  numOrNull,
  computeR,
  normalizeTrade,
  normalizeBet,
  normalizeResult,
  normalizeAfter,
  normalizeRevisions,
  normalizeImages,
  normalizeComments,
  normalizeTags,
  normalizeNote,
  fixStage,
  toZoneNote,
  keyOf,
  derivedWouldCycle,
  sanitizeDerived,
  withDerivedFlag,
};
