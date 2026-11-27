'use strict';
/**
 * 枚举与派生规则 —— 后端唯一真源
 *
 * 为什么单独一个文件：`ZONES / STAGES / MISTAKES / GROWTHS` 原先在
 * server.js、lib/transfer.js、public/app.js 各抄一份，改一个枚举要改三处，
 * 漏一处就出现「后端拒收、前端却还在发」。现在后端只认这里；
 * 前端仍是内联常量（浏览器不打包 CommonJS），但取值必须与本文件一致，
 * 改枚举时改两处：这里 + public/app.js 顶部常量块。
 */

const SIDES = ['long', 'short', 'flat'];
const DIDS = ['acted', 'skipped', 'none'];
const HORIZONS = ['intraday', '3d', '1w', '1m', '3m'];
const OUTCOMES = ['right', 'wrong', 'unclear'];
const TAGS_MAX = 8;

/* ---- 双分区 ---- */
const ZONES = ['inspiration', 'review'];
const STAGES = ['idea', 'judgment', 'trade'];      // 想法 → 判断 → 交易
const GROWTHS = ['up', 'equal', 'down'];           // ↑ / = / ↓，不打分
const TRIAGES = ['inbox', 'filed'];                // 收件箱 / 已归类

// 十项错误归因（事后字段，不进冻结），派生三组见 MISTAKE_GROUPS
const MISTAKES = [
  '方向看反', '位置不对', '时候不到', '没等到确认', '赚的不够赔',
  '止损放错', '仓位太重', '做得太频繁', '明知故犯', '就是运气',
];
const MISTAKE_GROUPS = {
  discipline: ['明知故犯'],                                   // 自律组
  skill: ['方向看反', '位置不对', '时候不到', '没等到确认', '赚的不够赔', '止损放错', '仓位太重', '做得太频繁'], // 本事组
  luck: ['就是运气'],                                          // 运气组
};

const MISTAKE_GROUP_OF = (m) => {
  if (m === '明知故犯') return 'discipline';
  if (m === '就是运气') return 'luck';
  return 'skill';
};

/** 状态标签：只是标签，不做量表（见 ARCHITECTURE §4.6） */
const STATE_TAGS = ['睡好', '疲惫', '手痒', '急躁', '分心', '平静'];

/** type 决定归属分区（老数据迁移与缺省都走这里） */
const zoneFromType = (type) => (type === 'review' || type === 'strategy' ? 'review' : 'inspiration');

/**
 * 复盘区的漏斗层级推导 —— 只在「没填 stage」时兜底，且必须叠加 did：
 *   did=acted + 有标的  → trade（真下过单）
 *   有失效条件          → judgment（判断，但没做）
 *   其余                → idea
 *
 * 早期版本只看 trade.symbol，会把「想做没做但填了标的」错推成 trade；
 * 现在 skipped / none 一律不会落进 trade，与 validateStage 的互斥规则一致。
 */
function stageFromNote(zone, note = {}) {
  if (zone !== 'review') return null;
  const trade = note.trade || {};
  const bet = note.bet || {};
  const did = note.did || 'none';
  if (did === 'acted' && trade.symbol) return 'trade';
  if (bet.invalid) return 'judgment';
  return 'idea';
}

const normalizeZone = (raw, type) => (ZONES.includes(raw) ? raw : zoneFromType(type));
const normalizeStage = (raw, zone) => (zone === 'review' && STAGES.includes(raw) ? raw : null);
const normalizeGrowth = (raw) => (GROWTHS.includes(raw) ? raw : null);
const normalizeCallRight = (raw) => (OUTCOMES.includes(raw) ? raw : null);

module.exports = {
  SIDES,
  DIDS,
  HORIZONS,
  OUTCOMES,
  TAGS_MAX,
  ZONES,
  STAGES,
  GROWTHS,
  TRIAGES,
  MISTAKES,
  MISTAKE_GROUPS,
  MISTAKE_GROUP_OF,
  STATE_TAGS,
  zoneFromType,
  stageFromNote,
  normalizeZone,
  normalizeStage,
  normalizeGrowth,
  normalizeCallRight,
};
