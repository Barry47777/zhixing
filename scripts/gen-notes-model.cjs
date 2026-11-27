'use strict';
/** 一次性：把 inspiration/server.js 的归一化层抽到 models/notes.js（随后手工扩展 projectId/entryId） */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, '..', 'inspiration', 'server.js'), 'utf8').split(/\r?\n/);
// 83–409 行：cleanText..withDerivedFlag（含 normalizeNote / fixStage / toZoneNote / 软链接）
const body = src.slice(82, 409).join('\n');

const header = `'use strict';

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

`;

const footer = `

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
`;

fs.writeFileSync(path.join(ROOT, 'server', 'models', 'notes.js'), header + body + footer, 'utf8');
console.log('written server/models/notes.js', (header + body + footer).split('\n').length, 'lines');