// 由 scripts/gen-web-libs.mjs 从 server/lib/review.js 自动生成，请勿手改
'use strict';
/**
 * 抽样与尺子 —— 回看机制的全部算法
 *
 * 设计前提（见 PROMPT·改造v2.md §1）：
 *  - 抽样必须由系统决定，用户不能选，否则只会翻爱看的；
 *  - 没有队列、没有欠账：每天最多 1 张，今天不看明天还是这 1 张，永不累积；
 *  - 同一天多次请求必须返回同一张（否则刷新就能换牌 = 用户又拿到了选择权）。
 *
 * 因此选择是「按日期确定性」的：种子 = 日期字符串，不用任何持久化状态。
 */

import { MISTAKE_GROUP_OF } from './constants.js';

const DAY = 864e5;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const daysBetween = (from, to = Date.now()) => Math.floor((to - from) / DAY);

/** 同一天同一个种子 → 同一个 0..1 随机数（xorshift32 + FNV-1a 播种） */
function seededUnit(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i += 1) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let x = h >>> 0 || 1;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5; x >>>= 0;
  return x / 4294967296;
}

const dayKey = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 该条记录的冷却天数：A 层 + verdict=worse 的缩短到 14 天，这是唯一的「复诊」机制 */
const A_LAYER_COOLDOWN = 14;
const DEFAULT_COOLDOWN = 30;

function layerOf(note) {
  if (note.result && note.result.outcome === 'wrong') return 'A';
  if (note.did === 'skipped') return 'B';
  return 'C';
}

function cooldownOf(note) {
  const verdict = note.review && note.review.verdict;
  if (layerOf(note) === 'A' && verdict === 'worse') return A_LAYER_COOLDOWN;
  return DEFAULT_COOLDOWN;
}

/**
 * ageMin = clamp(建库至今天数 × 0.5, 7, 90)
 * 自适应的理由：固定「三个月」会让新用户头 12 周完全用不了这功能，
 * 而那 12 周恰好是他最需要看到反馈的时候。
 */
function ageMinDays(notes, now = Date.now()) {
  const times = notes.map((n) => Number(n.createdAt) || now);
  const earliest = times.length ? Math.min(...times) : now;
  return clamp(daysBetween(earliest, now) * 0.5, 7, 90);
}

function hasAnswer(note) {
  return Boolean((note.result && note.result.outcome) || (note.after && note.after.text));
}

/**
 * 候选池
 * @returns {{pool: {A: [], B: [], C: []}, ageMin: number}}
 */
function buildPool(notes, now = Date.now()) {
  const ageMin = ageMinDays(notes, now);
  const today = dayKey(now);
  const pool = { A: [], B: [], C: [] };

  for (const note of notes) {
    if (note.zone !== 'review') continue;             // 灵感区不参与回看
    if (note.legacy) continue;                       // 老数据没有「看到」，遮不出东西
    if (!hasAnswer(note)) continue;                  // 有答案才值得重做
    if (!note.createdAt) continue;
    if (daysBetween(note.createdAt, now) < ageMin) continue;
    if (note.review && now - note.review.at < cooldownOf(note) * DAY) continue;
    if (dayKey(note.createdAt) === today) continue;   // 今天刚写的自己还记得
    pool[layerOf(note)].push(note);
  }

  const byTime = (a, b) => a.createdAt - b.createdAt;
  pool.A.sort(byTime);
  pool.B.sort(byTime);
  pool.C.sort(byTime);
  return { pool, ageMin };
}

/**
 * 挑今天那一张。同一个 dateStr 恒定返回同一条。
 * 空层的权重按比例回流到 C 层。
 */
function pickDailyCard(notes, now = Date.now()) {
  const { pool, ageMin } = buildPool(notes, now);
  const total = pool.A.length + pool.B.length + pool.C.length;
  if (!total) return { card: null, ageMin, pool: { A: 0, B: 0, C: 0 } };

  // 空层权重回流到 C（spec 原文）；C 也空时按 A:B 比例归一，否则会抽到空层返回 null
  const w = { A: 0.35, B: 0.25, C: 0.4 };
  for (const k of ['A', 'B']) {
    if (!pool[k].length) { w.C += w[k]; w[k] = 0; }
  }
  if (!pool.C.length) {
    const rest = w.A + w.B;
    if (rest > 0) { w.A /= rest; w.B /= rest; }
    w.C = 0;
  }

  const day = dayKey(now);
  const r = seededUnit(`${day}:layer`);
  let layer = null;
  let acc = 0;
  for (const k of ['A', 'B', 'C']) {
    if (!pool[k].length || !w[k]) continue;
    acc += w[k];
    if (r <= acc) { layer = k; break; }
  }
  if (!layer) {
    // 浮点兜底：取第一个还有牌的层
    layer = ['A', 'B', 'C'].find((k) => pool[k].length) || 'C';
  }

  const list = pool[layer];
  const idx = Math.min(list.length - 1, Math.floor(seededUnit(`${day}:${layer}:pick`) * list.length));
  const note = list[idx];

  return {
    card: note,
    ageMin,
    layer,
    pool: { A: pool.A.length, B: pool.B.length, C: pool.C.length },
  };
}

/** 盲卡只允许这些字段出现在响应里 —— 其余一律不许（防止答案过网线） */
function toBlindCard(note, now = Date.now()) {
  const trade = note.trade || {};
  return {
    id: note.id,
    seq: note.seq,
    createdAt: note.createdAt,
    symbol: trade.symbol || null,
    side: note.did === 'skipped' ? 'skipped' : (trade.side || null),
    seen: note.seen || '',
    images: (note.images || []).map((img) => ({ url: img.url, w: img.w, h: img.h })),
    ageDays: daysBetween(note.createdAt, now),
  };
}

/* ------------------------------ 尺子（P2） ------------------------------ */

const VERDICTS = ['same', 'better', 'worse', 'both_wrong'];

/** 最近 N 次回看的定性分布 */
function verdictStats(notes, now = Date.now(), windowSize = 8) {
  const done = notes
    .filter((n) => n.review && n.review.at && VERDICTS.includes(n.review.verdict))
    .sort((a, b) => b.review.at - a.review.at)
    .slice(0, windowSize);
  const counts = { same: 0, better: 0, worse: 0, both_wrong: 0 };
  for (const n of done) counts[n.review.verdict] += 1;
  return { ...counts, window: done.length };
}

/**
 * 把握校准：近 N 天里「把握 4-5」和「把握 1-3」各命中多少。
 * 任一组样本 < 5 → 整个对象 null（前端显示「样本不够，先记 5 笔」）。
 */
function calibration(notes, now = Date.now(), days = 30) {
  const since = now - days * DAY;
  const settled = notes.filter((n) => (
    n.bet && n.bet.conf && n.result && n.result.outcome
    && n.result.outcome !== 'unclear'
    && (n.result.at || n.updatedAt || n.createdAt) >= since
  ));

  const group = (min, max, label) => {
    const list = settled.filter((n) => n.bet.conf >= min && n.bet.conf <= max);
    if (list.length < 5) return null;
    const right = list.filter((n) => n.result.outcome === 'right').length;
    return { conf: label, n: list.length, right, rate: Math.round((right / list.length) * 100) / 100 };
  };

  const high = group(4, 5, '4-5');
  const low = group(1, 3, '1-3');
  if (!high || !low) return null;
  return { high, low, window: days };
}

/** 没做的里，事后看「确实该不做」有几笔 */
function skippedStats(notes, now = Date.now(), days = 30) {
  const since = now - days * DAY;
  const list = notes.filter((n) => n.did === 'skipped'
    && n.result && n.result.outcome
    && (n.result.at || n.updatedAt || n.createdAt) >= since);
  return { n: list.length, right: list.filter((n) => n.result.outcome === 'right').length };
}

/* ------------------------------ 复盘区增强（v3.1） ------------------------------ */

/**
 * 漏斗：想法 → 判断 → 交易。
 *
 * 两种口径，别混：
 *  - rateIJ / rateJT 「构成比」：分母是**相邻两层之和**。stage 是每条记录的
 *    分类，不是同一批想法的流转，所以用上层做分母会算出一百多个百分点。
 *  - convIJ / convJT 「真转化率」：靠 derivedFrom 软链接算 ——
 *    上层中被某条下层记录承接过的比例，分母严格是上层数量。
 *    没接软链时 converted=0，rate 仍然是数字（0 是真的 0，不是缺数据）。
 */
function funnel(notes) {
  const reviewNotes = notes.filter((n) => n.zone === 'review');
  const idea = reviewNotes.filter((n) => n.stage === 'idea').length;
  const judgment = reviewNotes.filter((n) => n.stage === 'judgment').length;
  const trade = reviewNotes.filter((n) => n.stage === 'trade').length;
  const total = idea + judgment + trade;

  const conv = (from, to) => {
    const parents = new Set(reviewNotes.filter((n) => n.stage === from).map((n) => n.id));
    if (!parents.size) return { from, to, pool: 0, converted: 0, rate: null };
    const linked = new Set();
    for (const n of reviewNotes) {
      if (n.stage === to && n.derivedFrom && parents.has(n.derivedFrom)) linked.add(n.derivedFrom);
    }
    return {
      from,
      to,
      pool: parents.size,
      converted: linked.size,
      rate: Math.round((linked.size / parents.size) * 100) / 100,
    };
  };

  return {
    idea,
    judgment,
    trade,
    total,
    // 构成比（分母 = 相邻两层之和）
    rateIJ: idea + judgment > 0 ? Math.round((judgment / (idea + judgment)) * 100) / 100 : null,
    rateJT: judgment + trade > 0 ? Math.round((trade / (judgment + trade)) * 100) / 100 : null,
    // 真转化率（分母 = 上层数量，靠 derivedFrom）
    convIJ: conv('idea', 'judgment'),
    convJT: conv('judgment', 'trade'),
  };
}

/**
 * 归因三组分布 + 归因 × 标签交叉。
 * 三组必须分开计数，不混进胜率；「就是运气」单独标注，避免把运气当本事。
 * byTag 只保留出现 ≥2 次的组合 —— 「螺纹 × 位置不对 3 次」才值得看，1 次是噪声。
 */
function mistakeStats(notes) {
  const groups = { discipline: 0, skill: 0, luck: 0 };
  const byName = new Map();
  const cross = new Map();
  for (const n of notes) {
    if (n.zone !== 'review') continue;
    const m = n.trade && n.trade.mistake;
    if (!m) continue;
    groups[MISTAKE_GROUP_OF(m)] += 1;
    byName.set(m, (byName.get(m) || 0) + 1);
    for (const t of n.tags || []) {
      const key = `${t}\u0000${m}`;
      cross.set(key, (cross.get(key) || 0) + 1);
    }
  }
  const total = groups.discipline + groups.skill + groups.luck;
  const byTag = [...cross.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => {
      const [tag, mistake] = key.split('\u0000');
      return { tag, mistake, count };
    });
  return {
    ...groups,
    total,
    list: [...byName.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    byTag,
  };
}

/**
 * 未执行思路命中率：当时想做没做，后来看「思路本身对不对」。
 * 与「该不该做」（skippedStats）是两件事，必须并列而不是相加。
 */
function callHitStats(notes) {
  const list = notes.filter((n) => n.zone === 'review' && n.did === 'skipped' && n.callRight);
  const settled = list.filter((n) => n.callRight !== 'unclear');
  const right = settled.filter((n) => n.callRight === 'right').length;
  return {
    n: list.length,
    right,
    rate: settled.length ? Math.round((right / settled.length) * 100) / 100 : null,
  };
}

/**
 * 待打标池：已结结果、还没打 ↑=↓、且是近 N 天的复盘记录。
 * 为什么要求「已结」：成长是跟过去的自己比，连结果都还不知道就评「比过去强」是空话。
 * 前端在复盘区给一个「待打标 N」的筛选入口，卡片上直接点 ↑ = ↓，不走别的流程。
 */
function growthPending(notes, now = Date.now(), days = 30) {
  const since = now - days * DAY;
  return notes.filter((n) => n.zone === 'review'
    && !n.growth
    && n.result && n.result.outcome
    && (n.createdAt || 0) >= since);
}

/**
 * 成长标记比例（↑ / = / ↓），并按标签聚合 down —— down 集中的标签就是「在退的具体话题」。
 * 与 review.verdict（两次判断对比）是两套东西，不要混。
 */
function growthStats(notes) {
  const counts = { up: 0, equal: 0, down: 0 };
  const byTag = new Map();
  for (const n of notes) {
    if (n.zone !== 'review' || !n.growth) continue;
    counts[n.growth] += 1;
    for (const t of n.tags || []) {
      if (!byTag.has(t)) byTag.set(t, { up: 0, equal: 0, down: 0, total: 0 });
      const cell = byTag.get(t);
      cell[n.growth] += 1;
      cell.total += 1;
    }
  }
  const total = counts.up + counts.equal + counts.down;
  const downTags = [...byTag.entries()]
    .filter(([, v]) => v.down > 0)
    .sort((a, b) => b[1].down - a[1].down)
    .slice(0, 5)
    .map(([tag, v]) => ({ tag, down: v.down, total: v.total }));
  return { ...counts, total, downTags };
}

/* ------------------------------------------------------------------
 * 交易执行（复盘重构 v2 · 尺子第三组）
 *
 * 只回答「动作有没有按系统来」，不评价单次结果好坏：
 *  - 平均 R：下过单且有单笔风险才有 R，没风险就没有口径；
 *  - 平均执行度：自己打的分，只看趋势不看得分绝对值；
 *  - 侥幸：执行度低（<=2）但结果对 —— 这种「对」不该鼓励；
 *  - 系统内亏损：执行度高（>=4）但结果错 —— 这种「错」不该自责。
 * ------------------------------------------------------------------ */
function executionStats(notes) {
  const traded = notes.filter((n) => n.zone === 'review' && n.trade && (n.trade.symbol || typeof n.trade.pnl === 'number'));
  const rated = traded.filter((n) => Number(n.trade.rating) > 0);
  const withR = traded.filter((n) => typeof n.trade.rMultiple === 'number');
  const mean = (arr, pick) => (arr.length ? arr.reduce((s, n) => s + pick(n), 0) / arr.length : null);
  const settled = traded.filter((n) => n.result && n.result.outcome);
  return {
    traded: traded.length,
    rated: rated.length,
    withR: withR.length,
    avgR: mean(withR, (n) => n.trade.rMultiple),
    avgRating: mean(rated, (n) => Number(n.trade.rating)),
    lucky: rated.filter((n) => Number(n.trade.rating) <= 2 && n.result && n.result.outcome === 'right').length,
    disciplined: rated.filter((n) => Number(n.trade.rating) >= 4 && n.result && n.result.outcome === 'wrong').length,
    settled: settled.length,
  };
}

/* ------------------------------------------------------------------
 * 补全池（复盘重构 v2）
 *
 * 记录时只表达，结构化的事后补。哪些记录「还欠一句话」由这里派生，
 * 不落盘、不加字段 —— 补完了条件自然不再命中，不会出现状态和内容不一致。
 *
 * 只回答「缺什么代码」，中文措辞在前端（展示层不归后端管）。
 * 顺序 = 提问顺序：先问最容易答的（认错条件），最后问核算项。
 * ------------------------------------------------------------------ */

const INCOMPLETE_CODES = ['invalid', 'conf', 'horizon', 'symbol', 'side', 'risk'];

/**
 * 一条复盘还欠哪些话。空数组 = 齐了。
 *
 * 判定刻意的宽松，理由：这是「欠账清单」不是「必填校验」，误报比漏报更烦人。
 *  - 只要这条已经落到「判断」或「交易」层（或有动作），就要求能验证 → 纯想法不欠；
 *  - R 倍数只在下过单、且已经填了盈亏时才要求单笔风险（没盈亏根本算不了 R，
 *    此时要 risk 是纯打扰）。
 *
 * 口径按 stage 判而不是只看 did：层级是这条记录「走到哪一步」的真源，
 * did 只是动作。只看 did 会漏掉 stage=judgment 而 did 缺省的记录。
 */
function incompleteOf(note) {
  if (!note || note.zone !== 'review') return [];
  const stage = note.stage || 'idea';
  const did = note.did || 'none';
  const bet = note.bet || {};
  const trade = note.trade || {};
  const out = [];
  const judged = stage !== 'idea' || did !== 'none';
  if (judged) {
    if (!bet.invalid) out.push('invalid');
    if (!bet.conf) out.push('conf');
    if (!bet.horizon) out.push('horizon');
  }
  const traded = stage === 'trade' || did === 'acted';
  if (traded) {
    if (!trade.symbol) out.push('symbol');
    if (!trade.side) out.push('side');
    if (typeof trade.pnl === 'number' && !trade.risk) out.push('risk');
  }
  return out;
}

/**
 * 复盘台的三个工作流池。补全池（fill）**不在这里**——
 * 它是横切的「欠一句话」清单，一条记录可以同时在「待核对」和「待补全」里。
 * 如果让 fill 抢占，新记的记录几乎全都有缺项，待核对/待归因会永远是空的。
 */
function deskOf(note) {
  if (!note || note.zone !== 'review') return null;
  const settled = Boolean(note.result && note.result.outcome);
  if (!settled) return note.stage === 'idea' ? null : 'check';
  const wrong = note.result.outcome === 'wrong';
  if (wrong && !(note.trade && note.trade.mistake)) return 'attribute';
  if (!note.growth) return 'growth';
  return null;
}

/** 按池筛选。fill 走 incompleteOf，其余走 deskOf。 */
const DESK_KEYS = ['all', 'check', 'attribute', 'growth', 'fill'];
function byDesk(notes, desk) {
  if (!DESK_KEYS.includes(desk) || desk === 'all') return notes;
  if (desk === 'fill') return notes.filter((n) => incompleteOf(n).length > 0);
  return notes.filter((n) => deskOf(n) === desk);
}

/** 各池计数，给导航上的待办数字用（fill 独立统计，会与其它池重叠） */
function deskCounts(notes) {
  const out = { check: 0, attribute: 0, growth: 0, fill: 0 };
  for (const n of notes) {
    const d = deskOf(n);
    if (d) out[d] += 1;
    if (incompleteOf(n).length) out.fill += 1;
  }
  return out;
}

/**
 * 周回顾候选：本周「已结或被归因」的记录，按「最该重新想一遍」排序。
 * 排序不是随机的 —— 先给结论错、缺认错条件、归因落在自律组的，
 * 这些才是值得动用那 3 张票的条目。
 */
function weekPicks(notes, now = Date.now(), days = 7) {
  const since = now - days * DAY;
  const pool = notes.filter((n) => n.zone === 'review'
    && (n.createdAt || 0) >= since
    && n.result && n.result.outcome);
  const score = (n) => {
    let s = 0;
    if (n.result.outcome === 'wrong') s += 40;
    if (incompleteOf(n).includes('invalid')) s += 20;
    const m = n.trade && n.trade.mistake;
    if (m === '明知故犯') s += 25;
    else if (m) s += 10;
    if (n.growth === 'down') s += 15;
    return s;
  };
  return pool
    .map((n) => ({ note: n, weight: score(n) }))
    .sort((a, b) => b.weight - a.weight || (b.note.createdAt || 0) - (a.note.createdAt || 0));
}

export { DAY, VERDICTS, INCOMPLETE_CODES, incompleteOf, deskOf, byDesk, deskCounts, weekPicks, layerOf, cooldownOf, ageMinDays, hasAnswer, buildPool, pickDailyCard, toBlindCard, verdictStats, calibration, skippedStats, funnel, mistakeStats, callHitStats, growthStats, growthPending, executionStats, MISTAKE_GROUP_OF, dayKey, daysBetween };
