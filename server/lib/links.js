/**
 * 双向链接：从正文里解析 @序号 与 [[...]]，算出每条记录引用了谁、又被谁引用。
 *
 * 语法（按好写的顺序排）：
 *   @12                   按序号引用（人类最短路径：看一眼卡片上的 #12 就能写）
 *   [[<id>]]              按 id 引用
 *   [[<id>|显示文字]]     按 id 引用并改名
 *   [[显示文字]]          按「正文开头 / 标签」唯一匹配
 *
 * 设计约束：
 *  - 只读：不改动存储，(refs / backrefs) 每次请求现算，不落盘。
 *  - 保守：id / 文字匹配不唯一就当没匹配（宁可不连，也不乱连）。
 *  - 有界：单条最多 50 个引用，单个目标最多记 200 条反向引用，
 *    避免有人粘贴一大段把响应撑爆。
 */

const richtext = require('./richtext');

const ID_RE = /^[\w-]{6,64}$/;
const TOKEN_RE = /\[\[([^[\]\n]{1,120})\]\]/g;
// @12：前面不能是字母数字或 @（避免吃掉邮箱），后面不能再跟数字
const SEQ_RE = /(^|[^\w@])@(\d{1,6})(?!\d)/g;
const MAX_OUT = 50;
const MAX_IN = 200;

const clip = (s, n) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** 一条记录拿来当「标题」的文本：先正文，再想到，再看到 */
const titleOf = (n) => {
  const body = n && n.content ? richtext.htmlToText(n.content) : '';
  return clip(body || (n && (n.think || n.seen || (n.after && n.after.text))) || '', 42);
};

/**
 * 解析一条记录正文里的全部引用 token。
 * 返回 [{ kind:'seq'|'id'|'label', value, label }]，去重、截断，顺序保留。
 */
function tokenize(note) {
  // 正文以 content 为准（v5）；老记录 content 由 seen+think 生成，这里再做一次兜底
  const body = note.content ? richtext.htmlToText(note.content) : `${note.seen || ''}\n${note.think || ''}`;
  const text = `${body}\n${note.after && note.after.text || ''}`;
  const out = [];
  const seen = new Set();
  const push = (tok) => {
    const key = `${tok.kind}\u0000${tok.value}\u0000${tok.label || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (out.length < MAX_OUT) out.push(tok);
  };

  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const inner = m[1].trim();
    if (!inner) continue;
    const bar = inner.indexOf('|');
    const target = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
    const label = (bar >= 0 ? inner.slice(bar + 1) : '').trim();
    if (!target) continue;
    push(ID_RE.test(target)
      ? { kind: 'id', value: target, label }
      : { kind: 'label', value: target, label });
  }

  SEQ_RE.lastIndex = 0;
  while ((m = SEQ_RE.exec(text)) !== null) {
    const seq = Number(m[2]);
    if (!Number.isInteger(seq) || seq <= 0) continue;
    push({ kind: 'seq', value: seq, label: '' });
  }

  return out;
}

/** [[显示文字]] 的唯一匹配：正文开头，或标签完全相同 */
function resolveLabel(label, notes, selfId) {
  const needle = label.toLowerCase();
  const hits = notes.filter((n) => {
    if (n.id === selfId) return false;
    const body = richtext.htmlToText(n.content || '');
    const head = `${body || n.think || ''}`.trim().toLowerCase();
    const seen = `${n.seen || ''}`.trim().toLowerCase();
    return head.startsWith(needle) || seen.startsWith(needle) ||
      (n.tags || []).some((t) => String(t).toLowerCase() === needle);
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 给一整批记录算出 refs / backrefs。
 * 传入的 notes 必须是**全量**（反向引用要看到不在当前筛选结果里的引用者）。
 * 返回一个新的数组视图：每条附 seq、refs、backrefs（不改原对象）。
 */
function annotate(notes) {
  const list = Array.isArray(notes) ? notes : [];
  const byId = new Map(list.map((n) => [n.id, n]));
  const bySeq = new Map();
  list.forEach((n) => {
    const seq = Number(n.seq) || 0;
    if (seq > 0 && !bySeq.has(seq)) bySeq.set(seq, n);
  });

  // 1. 正向：这条引用了谁
  const outbound = new Map();
  list.forEach((n) => {
    const refs = [];
    const seenId = new Set();
    tokenize(n).forEach((tok) => {
      let target = null;
      if (tok.kind === 'seq') target = bySeq.get(tok.value) || null;
      else if (tok.kind === 'id') target = byId.get(tok.value) || null;
      else target = resolveLabel(tok.value, list, n.id);
      if (!target || target.id === n.id) return;
      if (seenId.has(target.id)) return;
      seenId.add(target.id);
      refs.push({
        id: target.id,
        seq: Number(target.seq) || 0,
        // zone 让前端知道这个链接要跨分区跳，也顺便在 chip / 抽屉上标一下
        zone: target.zone === 'review' ? 'review' : 'inspiration',
        label: tok.label ? clip(tok.label, 24) : clip(titleOf(target), 24),
        title: titleOf(target),
      });
    });
    outbound.set(n.id, refs);
  });

  // 2. 反向：谁引用了这条
  const inbound = new Map();
  outbound.forEach((refs, fromId) => {
    const from = byId.get(fromId) || {};
    refs.forEach((r) => {
      const bucket = inbound.get(r.id) || [];
      if (bucket.length >= MAX_IN) return;
      bucket.push({
        id: fromId,
        seq: Number(from.seq) || 0,
        zone: from.zone === 'inspiration' ? 'inspiration' : 'review',
        // 反向引用的 label 必须是「谁引了我」的那条自己的标题，
        // 不能沿用正向链接里给目标起的别名（那样会显示成自己）
        label: clip(titleOf(from), 24),
        title: titleOf(from),
      });
      inbound.set(r.id, bucket);
    });
  });

  return list.map((n) => ({
    ...n,
    refs: outbound.get(n.id) || [],
    backrefs: inbound.get(n.id) || [],
  }));
}

module.exports = { annotate, tokenize, titleOf, clip, MAX_OUT, MAX_IN };
