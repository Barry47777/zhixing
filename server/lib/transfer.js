'use strict';
/**
 * 导入 / 导出 —— 格式编排层
 *
 * 交易员视角：一条记录不只是「一段文字」，它带类型（复盘/策略/心得/灵感）、
 * 可选的交易要素（标的、方向、盈亏、执行评分）和截图，所以导出格式要把这些都留住。
 *
 * ima 知识库是按「文件」切块检索的：
 *  - 单文件合集：每条一个 ## 小节，条目之间 --- 分隔，基本一块一条；
 *  - zip 包：每条一个 md，图片放 ../images/，检索颗粒度最细。
 */
const { makeZip } = require('./zip');
const { MISTAKES } = require('./constants');

const MAX_PER_FILE_TITLE = 60;
const EMBED_WARN_BYTES = 22 * 1024 * 1024;   // 单文件内嵌图片超过这个量提示一下

const richtext = require('./richtext');

const TYPES = {
  review: { label: '复盘', color: '#fbbf24' },
  strategy: { label: '策略', color: '#a78bfa' },
  insight: { label: '心得', color: '#f472b6' },
  idea: { label: '灵感', color: '#38bdf8' },
};

const SIDES = { long: '做多', short: '做空', flat: '观望' };
const ZONES = { inspiration: '灵感', review: '复盘' };
const STAGES = { idea: '想法', judgment: '判断', trade: '交易' };
const GROWTHS = { up: '↑ 比过去强', equal: '= 差不多', down: '↓ 还不如' };
const TRIAGES = { inbox: '待归类', filed: '已归类' };

const normalizeType = (t) => (TYPES[t] ? t : 'idea');
const typeLabel = (t) => TYPES[normalizeType(t)].label;
const sideLabel = (s) => SIDES[s] || '';

/* ------------------------------ 小工具 ------------------------------ */

const pad = (n) => String(n).padStart(2, '0');

function fmtDate(ts) {
  const d = new Date(ts || Date.now());
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtTime(ts) {
  const d = new Date(ts || Date.now());
  return `${fmtDate(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function firstLine(text) {
  const line = String(text || '').split('\n').map((s) => s.trim()).find(Boolean) || '无标题';
  return line.length > MAX_PER_FILE_TITLE ? `${line.slice(0, MAX_PER_FILE_TITLE)}…` : line;
}

/** 去掉文件名里 Windows / macOS / Linux 都不接受的字符 */
function safeName(text, fallback = 'note') {
  const cleaned = String(text || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return cleaned || fallback;
}

const tagLine = (tags) => (tags && tags.length ? tags.map((t) => `#${t}`).join(' ') : '无标签');

const fmtPnl = (pnl) => (pnl > 0 ? `+${pnl}` : String(pnl));

/* --- 四段式导出用到的词表（导出中文、解析认回英文） --- */
const OUTCOME_CN = { right: '对', wrong: '错', unclear: '说不清' };
const OUTCOME_EN = { 对: 'right', 错: 'wrong', 说不清: 'unclear', 正确: 'right', 错误: 'wrong' };
const DID_CN = { acted: '做了', skipped: '想做没做', none: '只是想想' };
const DID_EN = { 做了: 'acted', 想做没做: 'skipped', 只是想想: 'none', 没做: 'skipped' };
const HORIZON_CN = { intraday: '当天', '3d': '3 天', '1w': '1 周', '1m': '1 月', '3m': '3 月' };
const HORIZON_EN = { 当天: 'intraday', 日内: 'intraday', '3 天': '3d', '1 周': '1w', '1 月': '1m', '3 月': '3m' };

function tradeLine(note) {
  const t = note.trade || {};
  const bits = [];
  if (t.symbol) bits.push(`**标的**：${t.symbol}`);
  if (t.side) bits.push(`**方向**：${sideLabel(t.side)}`);
  if (typeof t.pnl === 'number' && Number.isFinite(t.pnl)) bits.push(`**盈亏**：${fmtPnl(t.pnl)}`);
  if (t.qty) bits.push(`**手数**：${t.qty}`);
  if (typeof t.entry === 'number') bits.push(`**入场**：${t.entry}`);
  if (typeof t.stop === 'number') bits.push(`**止损**：${t.stop}`);
  if (typeof t.target === 'number') bits.push(`**目标**：${t.target}`);
  if (typeof t.rMultiple === 'number') bits.push(`**R**：${t.rMultiple}`);
  if (t.rating) bits.push(`**执行**：${t.rating}/5`);
  return bits.join('　|　');
}

/** 标题只取「看到」——标题里不该有答案 */
function noteTitle(note) {
  // 正文以 content 为准；取第一行非空文本当标题
  if (note && note.content) {
    const first = richtext.htmlToText(note.content)
      .split('\n').map((s) => s.trim()).filter(Boolean)[0];
    if (first) return first.slice(0, 60);
  }
  return firstLine(note.seen || note.think || '');
}

/**
 * 固定四段小标题：看到 / 想到 / 结果 / 事后。
 * 中文标签是给 ima 检索用的 —— 你问「我上次怎么想的」，它要能落到「想到」段。
 */
function sectionLines(note) {
  const out = [];
  const put = (label, content) => {
    const text = String(content == null ? '' : content).trim();
    if (!text) return;
    out.push(`**${label}**：${text}`, '');
  };
  put('看到', note.seen);
  put('想到', note.think);

  const bet = note.bet || {};
  const betBits = [];
  if (bet.conf) betBits.push(`**把握**：${bet.conf}/5`);
  if (bet.horizon) betBits.push(`**周期**：${HORIZON_CN[bet.horizon] || bet.horizon}`);
  if (bet.invalid) betBits.push(`**失效条件**：${bet.invalid}`);
  if (betBits.length) out.push(betBits.join('　|　'), '');

  if (note.result && note.result.outcome) {
    const res = OUTCOME_CN[note.result.outcome] || note.result.outcome;
    put('结果', note.result.note ? `${res}｜${note.result.note}` : res);
  }
  if (note.after && note.after.text) put('事后', note.after.text);
  return out;
}


/* ------------------------------ 导出：合集 Markdown ------------------------------ */

/**
 * 一条记录的正文段（不含 `## 标题`）。
 * v5 起正文以 content（富文本）为准：图文按编辑器顺序内联输出，
 * 图不再是「全堆到文末」。老记录没有 content 时退回 seen/think 的老排版。
 * 复盘区：正文 + 完整元信息；灵感区：只留正文 + 区/类型/标签。
 */
/**
 * 正文里自带的 `## 小标题` 必须转义，否则导出成 md 后再导入会被当成「新的一条」——
 * 一条记录进去、两条出来。转义成 `\##` 是 Markdown 的合法写法，渲染仍是 `## `。
 * 导入时用 unescapeMd 还原，保证「导出 → 导入」后文字一字不差。
 */
const escapeMd = (s) => String(s || '')
  .replace(/^(#{1,6})([ \t])/gm, '\\$1$2')      // 正文里的 ## 小标题
  .replace(/^(-{3,})[ \t]*$/gm, '\\$1');         // 正文里的 --- 分隔线
const unescapeMd = (s) => String(s || '')
  .replace(/^\\(#{1,6})([ \t])/gm, '$1$2')
  .replace(/^\\(-{3,})[ \t]*$/gm, '$1');

/**
 * 正文里自带的 `## 小标题` / `---` 分隔线必须转义，否则导出成 md 后再导入会被当成
 * 「新的一条」或「记录分隔符」——一条记录进去、两条出来，或者一条被腰斩。
 * `\##`、`\---` 都是合法的 Markdown 写法，渲染出来仍是 `## ` 与 `---`；
 * 导入时用 unescapeMd 还原，保证「导出 → 导入」逐字不变（去重也才认得出来）。
 */
function buildNoteBody(n, meta = {}) {
  const isReview = n.zone === 'review';
  const parts = [];
  const content = String(n.content || '');

  if (content && richtext.htmlToText(content)) {
    // 富文本降级：粗体 → **、斜体 → *、图片 → ![图](...) 就地插在段落之后
    const md = escapeMd(richtext.htmlToMarkdown(content));
    if (md) parts.push(md, '');
  } else if (isReview) {
    parts.push(...sectionLines(n));
  } else {
    const body = escapeMd(String(n.think || '').trim());
    if (body) parts.push(body, '');
  }

  const row = [`**区**：${ZONES[n.zone] || '灵感'}`, `**类型**：${typeLabel(n.type)}`];
  if (isReview && n.stage) row.push(`**层级**：${STAGES[n.stage]}`);
  if (isReview) {
    const t = tradeLine(n);
    if (t) row.push(t);
  }
  parts.push(row.join('　|　'));

  if (isReview) {
    const row2 = [`**动作**：${DID_CN[n.did] || '只是想想'}${n.did === 'skipped' && n.skipReason ? `｜${n.skipReason}` : ''}`];
    if (n.callRight) row2.push(`**思路**：${OUTCOME_CN[n.callRight] || n.callRight}`);
    parts.push(row2.join('　|　'));

    const row3 = [`**归类**：${TRIAGES[n.triage] || '待归类'}`];
    if (n.trade && n.trade.mistake) row3.push(`**归因**：${n.trade.mistake}`);
    if (n.growth) row3.push(`**成长**：${GROWTHS[n.growth]}`);
    parts.push(row3.join('　|　'));
  } else {
    parts.push(`**归类**：${TRIAGES[n.triage] || '待归类'}`);
  }

  parts.push(`**标签**：${tagLine(n.tags)}　|　**创建**：${fmtTime(n.createdAt)}　|　**更新**：${fmtTime(n.updatedAt || n.createdAt)}${n.pinned ? '　|　**置顶**' : ''}`);
  void meta;
  return parts;
}

/** 把正文里的 /media/xxx 图就地换成 data:base64，让单文件 md 自包含 */
function inlineMedia(md, meta = {}) {
  if (!meta.readImage) return md;
  return String(md).replace(/!\[([^\]]*)\]\((\/media\/[^)\s]+)\)/g, (all, alt, url) => {
    const buf = meta.readImage(url);
    if (!buf) return all;
    return `![${alt}](${embedDataUri(url, buf)})`;
  });
}

/**
 * 单文件 Markdown（ima 友好）
 * @param {Array} notes
 * @param {Object} meta  { scopeLabel, readImage(url)->Buffer|null, embedImages }
 */
function buildMarkdown(notes, meta = {}) {
  const list = [...notes].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const tagCount = new Map();
  const typeCount = new Map();
  const zoneCount = new Map();
  for (const n of list) {
    for (const t of n.tags || []) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    const ty = normalizeType(n.type);
    typeCount.set(ty, (typeCount.get(ty) || 0) + 1);
    const z = n.zone === 'review' ? 'review' : 'inspiration';
    zoneCount.set(z, (zoneCount.get(z) || 0) + 1);
  }
  const tagIndex = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `#${name}（${count}）`)
    .join('　');
  const typeIndex = [...typeCount.entries()]
    .map(([t, count]) => `${typeLabel(t)} ${count}`)
    .join('　｜　');
  const zoneIndex = [...zoneCount.entries()]
    .map(([z, count]) => `${ZONES[z]} ${count}`)
    .join('　｜　');

  const head = [
    `# 交易复盘与灵感 · ${fmtDate(Date.now())}`,
    '',
    `> 共 ${list.length} 条　｜　导出时间：${fmtTime(Date.now())}${meta.scopeLabel ? `　｜　范围：${meta.scopeLabel}` : ''}`,
  ];
  if (zoneIndex) head.push(`> 分区：${zoneIndex}`);
  if (typeIndex) head.push(`> 类型分布：${typeIndex}`);
  if (tagIndex) head.push(`> 标签索引：${tagIndex}`);
  head.push('> 来源：复盘 · Edge（本地复盘本）', '', '---', '');

  const body = list.flatMap((n) => {
    const title = noteTitle(n);
    const parts = [`## ${title}`, '', ...buildNoteBody(n, meta)];

    // 富文本正文已经把图就地排好了（且 base64 内嵌），这里只补「老记录 / 图不在正文里」的那批
    const inContent = new Set(richtext.imageSrcs(n.content || ''));
    for (const [i, img] of (n.images || []).entries()) {
      if (!img || !img.url || inContent.has(img.url)) continue;
      const buf = meta.readImage ? meta.readImage(img.url) : null;
      if (!buf) continue;
      const src = meta.embedImages === false
        ? `../images/${String(n.id).replace(/[^\w-]/g, '')}/${i + 1}.${String(img.url).split('.').pop()}`
        : embedDataUri(img.url, buf);
      parts.push('', `![${safeName(title, '图片')} ${i + 1}](${src})`);
    }

    parts.push('', '---', '');
    return parts;
  });

  return inlineMedia([...head, ...body].join('\n'), meta).replace(/\n{3,}$/, '\n');
}

function embedDataUri(url, buf) {
  const ext = String(url).split('.').pop().toLowerCase();
  return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buf.toString('base64')}`;
}

/* ------------------------------ 导出：单条 Markdown ------------------------------ */

function buildNoteMarkdown(note, meta = {}, refs) {
  const title = noteTitle(note).replace(/^#+\s*/, '');
  const t = note.trade || {};
  const bet = note.bet || {};
  const lines = [
    '---',
    `title: ${title}`,
    `zone: ${note.zone === 'review' ? 'review' : 'inspiration'}`,
    `type: ${normalizeType(note.type)}`,
    `date: ${fmtTime(note.createdAt)}`,
    `updated: ${fmtTime(note.updatedAt || note.createdAt)}`,
    `tags: [${(note.tags || []).join(', ')}]`,
    `did: ${note.did || 'none'}`,
    `triage: ${note.triage || 'inbox'}`,
  ];
  if (note.stage) lines.push(`stage: ${note.stage}`);
  if (bet.conf) lines.push(`conf: ${bet.conf}`);
  if (bet.horizon) lines.push(`horizon: ${bet.horizon}`);
  if (bet.invalid) lines.push(`invalid: ${bet.invalid}`);
  if (note.result && note.result.outcome) lines.push(`outcome: ${note.result.outcome}`);
  if (note.callRight) lines.push(`callRight: ${note.callRight}`);
  if (t.symbol) lines.push(`symbol: ${t.symbol}`);
  if (t.side) lines.push(`side: ${t.side}`);
  if (typeof t.pnl === 'number') lines.push(`pnl: ${t.pnl}`);
  if (t.qty) lines.push(`qty: ${t.qty}`);
  if (typeof t.entry === 'number') lines.push(`entry: ${t.entry}`);
  if (typeof t.stop === 'number') lines.push(`stop: ${t.stop}`);
  if (typeof t.target === 'number') lines.push(`target: ${t.target}`);
  if (t.risk) lines.push(`risk: ${t.risk}`);
  if (typeof t.rMultiple === 'number') lines.push(`r: ${t.rMultiple}`);
  if (t.rating) lines.push(`rating: ${t.rating}`);
  if (t.mistake) lines.push(`mistake: ${t.mistake}`);
  if (note.growth) lines.push(`growth: ${note.growth}`);
  if (note.derivedFrom) lines.push(`derivedFrom: ${note.derivedFrom}`);
  lines.push('source: 复盘 · Edge', note.pinned ? 'pinned: true' : null, '---', '', `# ${title}`, '');
  lines.push(...buildNoteBody(note, meta));

  // 图已经在正文里就地排好了（v5 富文本）：不再往文末补一份
  const inlineImages = richtext.imageSrcs(note.content || '');
  const pics = inlineImages.length
    ? []
    : (Array.isArray(refs)
      ? refs
      : (note.images || []).map((img, i) => (img && img.url
        ? `../images/${String(note.id).replace(/[^\w-]/g, '')}/${i + 1}.${String(img.url).split('.').pop()}`
        : null)).filter(Boolean));
  for (const [i, rel] of pics.entries()) {
    lines.push('', `![${safeName(title, '图片')} ${i + 1}](${rel})`);
  }

  return lines.filter((l) => l !== null).join('\n');
}

/**
 * 打包成 zip：00-索引.md + notes/*.md + images/<id>/*
 * 条数过多时按「月」合并成月度合集。
 */
function buildPack(notes, meta = {}, splitThreshold = 200) {
  const list = [...notes].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const files = [{ name: '00-索引.md', data: buildMarkdown(list, { ...meta, embedImages: false }) }];
  const imageFiles = [];
  const used = new Set();

  const collectImages = (note) => {
    const id = String(note.id).replace(/[^\w-]/g, '');
    const map = new Map();
    // v5：正文里的图（编辑器顺序）排在前面，images[] 里没进正文的补在后面
    const srcs = [...new Set([
      ...richtext.imageSrcs(note.content || ''),
      ...(note.images || []).map((img) => (img && img.url ? img.url : null)).filter(Boolean),
    ])];
    srcs.forEach((url, i) => {
      const buf = meta.readImage ? meta.readImage(url) : null;
      if (!buf) return;
      const ext = String(url).split('.').pop().toLowerCase();
      const name = `images/${id}/${i + 1}.${ext}`;
      imageFiles.push({ name, data: buf });
      map.set(url, `../${name}`);
    });
    return map;
  };

  /** 正文里的 /media/xxx 换成包内相对路径 */
  const relink = (md, map) => String(md).replace(/\]\((\/media\/[^)\s]+)\)/g, (all, url) => {
    const rel = map.get(url);
    return rel ? `](${rel})` : all;
  });

  if (list.length > splitThreshold) {
    const months = new Map();
    for (const n of list) {
      const key = fmtDate(n.createdAt).slice(0, 7);
      if (!months.has(key)) months.set(key, []);
      months.get(key).push(n);
    }
    for (const [month, group] of months) {
      const chapters = group.flatMap((n) => {
        const map = collectImages(n);
        const parts = [`## ${noteTitle(n)}`, ''];
        buildNoteBody(n).forEach((line) => parts.push(relink(line, map)));
        [...map.values()].forEach((r) => parts.push('', `![](${r})`));
        parts.push('', '---', '');
        return parts;
      });
      files.push({
        name: `notes/${month}.md`,
        data: [`# 复盘 · ${month}（${group.length} 条）`, '', ...chapters].join('\n'),
      });
    }
  } else {
    for (const n of list) {
      const map = collectImages(n);   // 先把图片收进包里，md 里的相对路径才对得上
      const base = `${fmtDate(n.createdAt)} ${typeLabel(n.type)} ${safeName(noteTitle(n))}`;
      let name = `notes/${base}.md`;
      let i = 2;
      while (used.has(name)) name = `notes/${base} (${i += 1}).md`;
      used.add(name);
      files.push({ name, data: relink(buildNoteMarkdown(n, meta, [...map.values()]), map) });
    }
  }

  files.push(...imageFiles);
  files.push({
    name: 'README.txt',
    data: [
      '交易复盘 · Spark 导出包',
      '',
      `共 ${list.length} 条，导出时间 ${fmtTime(Date.now())}`,
      '',
      '目录说明：',
      '  notes/     每条记录一个 .md（超过 200 条时按月合并）',
      '  images/    复盘截图，md 里用 ../images/ 相对路径引用',
      '  00-索引.md  全量合集，方便一次看完整时间线',
      '',
      '导入 ima 知识库的方法：',
      '1. 解压本压缩包，保持 notes/ 与 images/ 的相对位置；',
      '2. 打开 ima → 知识库 → 目标知识库 → 导入 / 上传本地文件；',
      '3. 把 notes 里的 .md 全选拖进去；图片若在 ima 里不显示，',
      '   可以把 images 目录里的截图单独上传（ima 支持图片 OCR）。',
      '',
      '想一步到位就回网页用「IMA 合集 Markdown」，那是单个自包含 md（图片已内嵌）。',
    ].join('\n'),
  });

  return makeZip(files);
}

/* ------------------------------ 导出：JSON 备份 ------------------------------ */

function buildJson(notes) {
  return JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), notes }, null, 2);
}

/* ------------------------------ 导入：解析 ------------------------------ */

const stripFrontmatter = (text) => text.replace(/^\uFEFF/, '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');

function extractTags(chunk) {
  const m = chunk.match(/^[\s>*_-]*(?:\*\*)?标签(?:\*\*)?[:：]\s*(.+)$/m);
  if (!m) {
    return [...new Set(
      [...chunk.matchAll(/(?:^|[\s（(，,])#([^\s#，,。；;：:|]+)/g)]
        .map((x) => x[1].trim().slice(0, 24))
        .filter((t) => t && !/^\d+$/.test(t))
    )].slice(0, 8);
  }
  const raw = m[1].split(/[|｜]/)[0].split(/(?:创建|更新|date)\s*[:：]/i)[0];
  return [...new Set(
    raw.split(/[\s,，、]+/)
      .map((t) => t.replace(/^[#\-*]+/, '').replace(/[*|].*$/, '').trim())
      .filter((t) => t && t !== '无标签')
  )].slice(0, 8);
}

function extractDate(chunk) {
  const m = chunk.match(/(?:创建|date)\**[ \t]*[:：][ \t]*(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/i);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0'] = m;
  const ts = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)).getTime();
  return Number.isFinite(ts) ? ts : null;
}

const TYPE_BY_LABEL = { 复盘: 'review', 策略: 'strategy', 心得: 'insight', 灵感: 'idea' };

function extractType(chunk) {
  const m = chunk.match(/(?:类型|type)\**[ \t]*[:：][ \t]*\**([^\s|｜*]+)/i);
  if (!m) return 'idea';
  const raw = m[1].replace(/\*/g, '').trim();
  if (TYPE_BY_LABEL[raw]) return TYPE_BY_LABEL[raw];
  if (TYPES[raw]) return raw;
  return 'idea';
}

function extractTrade(chunk) {
  const trade = {};
  const sym = chunk.match(/标的\**[ \t]*[:：][ \t]*\**([^\s|｜*　]+)/);
  if (sym) trade.symbol = sym[1].trim().slice(0, 24);
  const side = chunk.match(/方向\**[ \t]*[:：][ \t]*\**([^\s|｜*　]+)/);
  if (side) {
    const s = side[1].trim();
    trade.side = s.includes('空') ? 'short' : s.includes('观望') ? 'flat' : s.includes('多') ? 'long' : '';
  }
  const pnl = chunk.match(/盈亏\**[ \t]*[:：][ \t]*\**([+-]?[\d,]+(?:\.\d+)?)/);
  if (pnl) trade.pnl = Number(pnl[1].replace(/,/g, ''));
  const rating = chunk.match(/执行\**[ \t]*[:：][ \t]*\**([1-5])/);
  if (rating) trade.rating = Number(rating[1]);
  // 事后回填的交易要素（可空）：手数 / 入场 / 止损 / 目标 / R
  const numField = (label, key) => {
    const m = chunk.match(new RegExp(`${label}\\**\\s*[:：]\\s*\\**([+-]?[\\d,]+(?:\\.\\d+)?)`));
    if (m) trade[key] = Number(m[1].replace(/,/g, ''));
  };
  numField('手数', 'qty');
  numField('入场', 'entry');
  numField('止损', 'stop');
  numField('目标', 'target');
  numField('R', 'rMultiple');
  // frontmatter 兜底
  const fSym = chunk.match(/^symbol:\s*(.+)$/m);
  if (!trade.symbol && fSym) trade.symbol = fSym[1].trim().slice(0, 24);
  const fSide = chunk.match(/^side:\s*(long|short|flat)$/m);
  if (!trade.side && fSide) trade.side = fSide[1];
  const fPnl = chunk.match(/^pnl:\s*(-?\d+(?:\.\d+)?)$/m);
  if (trade.pnl === undefined && fPnl) trade.pnl = Number(fPnl[1]);
  const fmNum = (key) => {
    const m = chunk.match(new RegExp(`^${key}:\\s*(-?\\d+(?:\\.\\d+)?)$`, 'm'));
    if (m && trade[key] === undefined) trade[key] = Number(m[1]);
  };
  ['qty', 'entry', 'stop', 'target', 'risk', 'r'].forEach(fmNum);
  if (trade.r !== undefined) trade.rMultiple = trade.r;
  delete trade.r;
  const keep = Object.keys(trade).filter((k) => trade[k] !== undefined && trade[k] !== '');
  return keep.length ? trade : null;
}

/** 抽出图片引用：data URI 直接解码，相对路径交给 server 到 zip 里找 */
function extractImages(chunk) {
  const out = [];
  for (const m of chunk.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^data:image\//i.test(target)) {
      const mm = /^data:image\/[a-z+]+;base64,([\s\S]+)$/i.exec(target);
      if (mm) out.push({ data: Buffer.from(mm[1].replace(/\s/g, ''), 'base64') });
    } else if (!/^https?:\/\//i.test(target)) {
      out.push({ ref: decodeURI(target) });
    }
  }
  return out;
}

/* ---------------- 四段式解析：看到 / 想到 / 结果 / 事后 ---------------- */

const SECTION_KEY = { 看到: 'seen', 想到: 'think', 结果: 'resultRaw', 事后: 'afterRaw' };

/**
 * 把一段 md 拆成四段 + 剩余正文。
 * 段落以任意 `**标签**：` 行结束 —— 所以「把握/周期/失效条件/类型/标的…」这些
 * 单行元信息不会被吞进上一段。
 */
function parseSections(chunk) {
  const out = { seen: '', think: '', resultRaw: '', afterRaw: '', rest: [] };
  let current = null;

  for (const line of chunk.split('\n')) {
    const sec = /^\*\*(看到|想到|结果|事后)\*\*\s*[:：]\s*([\s\S]*)$/.exec(line);
    if (sec) {
      current = SECTION_KEY[sec[1]];
      out[current] = sec[2];
      continue;
    }
    // 任何 `**xx**：` 都是元信息行，结束当前段
    if (/^\s*\*\*[^*]{1,10}\*\*\s*[:：]/.test(line)) { current = null; continue; }
    if (/^\s*-{3,}\s*$/.test(line)) { current = null; continue; }
    if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line)) continue;

    if (current) {
      const text = line.trimEnd();
      out[current] = out[current] ? `${out[current]}\n${text}` : text;
    } else {
      out.rest.push(line);
    }
  }

  return {
    seen: tidy(out.seen),
    think: tidy(out.think),
    resultRaw: tidy(out.resultRaw),
    afterRaw: tidy(out.afterRaw),
    rest: tidy(out.rest.join('\n')),
  };
}

/** 结果行：`错｜走了 20 点就回头` */
function parseResultRaw(raw) {
  if (!raw) return null;
  const [head, ...tail] = raw.split(/[｜|]/);
  const word = head.trim();
  const outcome = OUTCOME_EN[word] || (/^(right|wrong|unclear)$/i.test(word) ? word.toLowerCase() : null);
  if (!outcome) return null;
  return { outcome, note: tail.join('｜').trim() };
}

/** 把握 / 周期 / 失效条件（可能在同一行，也可能分行） */
function extractBet(chunk) {
  const bet = {};
  const conf = chunk.match(/把握\**[ \t]*[:：][ \t]*\**([1-5])/);
  if (conf) bet.conf = Number(conf[1]);
  const horizon = chunk.match(/周期\**[ \t]*[:：][ \t]*([^\n|｜*]+)/);
  if (horizon) {
    const h = horizon[1].trim();
    bet.horizon = HORIZON_EN[h] || (HORIZONS_KEYS.includes(h) ? h : undefined);
  }
  const invalid = chunk.match(/失效条件\**[ \t]*[:：][ \t]*([^\n]+)/);
  if (invalid) bet.invalid = invalid[1].replace(/\*\*/g, '').trim().slice(0, 200);
  const fConf = chunk.match(/^conf:\s*([1-5])$/m);
  if (!bet.conf && fConf) bet.conf = Number(fConf[1]);
  const fHorizon = chunk.match(/^horizon:\s*(\w+)$/m);
  if (!bet.horizon && fHorizon && HORIZONS_KEYS.includes(fHorizon[1])) bet.horizon = fHorizon[1];
  const keep = Object.keys(bet).filter((k) => bet[k] !== undefined);
  return keep.length ? bet : null;
}

const HORIZONS_KEYS = ['intraday', '3d', '1w', '1m', '3m'];

/** 做了 / 想做没做 / 只是想想（可带原因） */
function extractDid(chunk) {
  const m = chunk.match(/动作\**[ \t]*[:：][ \t]*([^\n]+)/);
  const fDid = chunk.match(/^did:\s*(acted|skipped|none)$/m);
  if (!m) return { did: fDid ? fDid[1] : 'none', skipReason: '' };
  const raw = m[1].replace(/\*\*/g, '').trim();
  const [head, ...tail] = raw.split(/[｜|]/);
  const key = head.trim();
  return {
    did: DID_EN[key] || (['acted', 'skipped', 'none'].includes(key) ? key : 'none'),
    skipReason: tail.join('｜').trim().slice(0, 200),
  };
}

/* ---- v3.1 新字段的读取（中文标签 ↔ 英文 key） ---- */

const ZONE_EN = { 灵感: 'inspiration', 复盘: 'review' };
const STAGE_EN = { 想法: 'idea', 判断: 'judgment', 交易: 'trade' };
const GROWTH_EN = { '↑': 'up', '=': 'equal', '↓': 'down', up: 'up', equal: 'equal', down: 'down' };

function extractZone(chunk) {
  const m = chunk.match(/区\**[ \t]*[:：][ \t]*([^\s|｜*　]+)/);
  if (m) {
    const raw = m[1].replace(/\*/g, '');
    for (const [cn, en] of Object.entries(ZONE_EN)) if (raw.includes(cn)) return en;
    if (ZONES[raw]) return raw;
  }
  const f = chunk.match(/^zone:\s*(inspiration|review)$/m);
  return f ? f[1] : null;
}

function extractStage(chunk) {
  const m = chunk.match(/层级\**[ \t]*[:：][ \t]*([^\s|｜*　]+)/);
  if (m) {
    const raw = m[1].replace(/\*/g, '');
    if (STAGE_EN[raw]) return STAGE_EN[raw];
    if (STAGES[raw]) return raw;
  }
  const f = chunk.match(/^stage:\s*(idea|judgment|trade)$/m);
  return f ? f[1] : null;
}

function extractTriage(chunk) {
  const m = chunk.match(/归类\**[ \t]*[:：][ \t]*([^\s|｜*　]+)/);
  if (m) return m[1].includes('已') ? 'filed' : 'inbox';
  const f = chunk.match(/^triage:\s*(inbox|filed)$/m);
  return f ? f[1] : null;
}

function extractMistake(chunk) {
  const m = chunk.match(/归因\**[ \t]*[:：][ \t]*([^\s|｜*　]+)/);
  const f = chunk.match(/^mistake:\s*(.+)$/m);
  const name = String(m ? m[1] : (f ? f[1].trim() : '')).replace(/\*/g, '').trim();
  return MISTAKES.includes(name) ? name : null;
}

function extractDerivedFrom(chunk) {
  const m = chunk.match(/^derivedFrom:\s*([\w-]{6,64})$/m);
  return m ? m[1] : null;
}

function extractGrowth(chunk) {
  const m = chunk.match(/成长\**[ \t]*[:：][ \t]*([↑=↓]|up|equal|down)/);
  const f = chunk.match(/^growth:\s*(up|equal|down)$/m);
  const raw = String(m ? m[1] : (f ? f[1] : '')).trim();
  return GROWTH_EN[raw] || null;
}

function extractCallRight(chunk) {
  const m = chunk.match(/思路\**[ \t]*[:：][ \t]*([^\s|｜*　]+)/);
  const f = chunk.match(/^callRight:\s*(right|wrong|unclear)$/m);
  const raw = String(m ? m[1] : (f ? f[1] : '')).replace(/\*/g, '').trim();
  return OUTCOME_EN[raw] || (['right', 'wrong', 'unclear'].includes(raw) ? raw : null);
}

const tidy = (s) => s.replace(/^\s*-{3,}\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

const looksLikeHeader = (chunk) => /导出时间|共\s*\d+\s*条|标签索引|类型分布/.test(chunk);

function blocksFromMarkdown(text) {
  const clean = stripFrontmatter(text);

  if (/^#{1,2}\s+/m.test(clean)) {
    const parts = clean.split(/^(#{1,2})\s+/m);
    const items = [];
    for (let i = 1; i + 1 < parts.length; i += 2) {
      items.push({ level: parts[i].length, body: parts[i + 1] });
    }
    const hasSection = items.some((it) => it.level === 2);
    const chunks = [];
    items.forEach((it, idx) => {
      const lines = it.body.split('\n');
      const title = lines.shift().replace(/^\d+[.、]\s*/, '').trim();
      const rest = lines.join('\n');
      if (idx === 0 && looksLikeHeader(`${title}${rest}`)) return;
      if (idx === 0 && it.level === 1 && hasSection) return;
      chunks.push(`${title}\n${rest}`);
    });
    if (chunks.length) return chunks;
  }

  const byRule = clean.split(/\n\s*-{3,}\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (byRule.length > 1) return byRule;
  return clean.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
}

function blocksFromText(text) {
  return stripFrontmatter(text)
    .split(/\n{2,}/)
    .map((s) => s.replace(/^\s*(?:[-*+]|\d+[.、])\s*/, '').trim())
    .filter(Boolean);
}

/**
 * @param {string} name 文件名
 * @param {Buffer} buf  文件内容
 * @returns {Array<{seen,think,bet,did,skipReason,result,after,tags,pinned,createdAt,type,trade,images,legacy}>}
 */
function parseFile(name, buf) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.json')) {
    const parsed = JSON.parse(buf.toString('utf8'));
    const arr = Array.isArray(parsed) ? parsed : parsed.notes;
    if (!Array.isArray(arr)) throw new Error('JSON 里找不到 notes 数组');
    return arr.map((n) => ({
      zone: n.zone,
      stage: n.stage,
      seen: String(n.seen || ''),
      think: String(n.think || n.text || ''),
      bet: n.bet || null,
      did: ['acted', 'skipped', 'none'].includes(n.did) ? n.did : 'none',
      skipReason: String(n.skipReason || ''),
      result: n.result || null,
      after: n.after || null,
      callRight: n.callRight || null,
      growth: n.growth || null,
      growthAt: Number(n.growthAt) || null,
      triage: n.triage || null,
      derivedFrom: typeof n.derivedFrom === 'string' ? n.derivedFrom : null,
      legacy: n.legacy !== undefined ? Boolean(n.legacy) : false,
      tags: Array.isArray(n.tags) ? n.tags : String(n.tags || '').split(/[\s,，、]+/),
      pinned: Boolean(n.pinned),
      createdAt: Number(n.createdAt) || null,
      type: normalizeType(n.type),
      trade: n.trade || null,
      images: (Array.isArray(n.images) ? n.images : [])
        .map((img) => (typeof img === 'string' ? { ref: img } : img && img.url ? { ref: img.url } : null))
        .filter(Boolean),
    }));
  }

  const text = buf.toString('utf8');
  const rawPinned = /^pinned:\s*true\s*$/im.test(text);
  const fmOutcome = (/^outcome:\s*(right|wrong|unclear)$/m.exec(text) || [])[1];
  const chunks = lower.endsWith('.txt') ? blocksFromText(text) : blocksFromMarkdown(text);

  return chunks.map((chunk) => {
    const sec = parseSections(chunk);
    const did = extractDid(chunk);
    const result = parseResultRaw(sec.resultRaw)
      || (fmOutcome ? { outcome: fmOutcome, note: '' } : null);
    // 没有四段结构的内容（灵感条目、老 md）：整段当「想到」
    const hasStructure = Boolean(sec.seen || sec.think);
    const heading = chunk.split('\n')[0].trim();

    // 标题本来就是正文第一行（导出时 `## 标题` 再抄一遍正文），回读要去掉这层重复
    let body = sec.think || sec.rest;
    if (!sec.think) {
      const lines = body.split('\n');
      if (lines[0] && lines[0].trim() === heading) body = lines.slice(1).join('\n').replace(/^\n+/, '');
    }
    const think = body.trim() ? body : (sec.seen ? '' : heading);

    const type = extractType(chunk);
    const zone = extractZone(chunk) || (type === 'review' || type === 'strategy' ? 'review' : 'inspiration');
    const trade = extractTrade(chunk);
    const mistake = extractMistake(chunk);
    if (trade && mistake) trade.mistake = mistake;
    const growth = extractGrowth(chunk);
    return {
      zone,
      stage: extractStage(chunk),
      seen: unescapeMd(sec.seen),
      think: unescapeMd(think),
      bet: extractBet(chunk),
      did: did.did,
      skipReason: did.skipReason,
      result: result ? { ...result, at: extractDate(chunk) || Date.now() } : null,
      after: sec.afterRaw ? { text: unescapeMd(sec.afterRaw), at: extractDate(chunk) || Date.now() } : null,
      callRight: extractCallRight(chunk),
      growth,
      growthAt: growth ? (extractDate(chunk) || Date.now()) : null,
      triage: extractTriage(chunk) || (result && result.outcome ? 'filed' : 'inbox'),
      derivedFrom: extractDerivedFrom(chunk),
      legacy: !hasStructure,
      tags: extractTags(chunk),
      createdAt: extractDate(chunk),
      type,
      trade: trade || (mistake ? { mistake } : null),
      pinned: rawPinned || /置顶/.test(chunk) || /pinned:\s*true/i.test(chunk),
      images: extractImages(chunk),
    };
  }).filter((n) => n.seen || n.think || (n.images && n.images.length));
}

/* ------------------------------ 导入：去重 ------------------------------ */

const dedupeKey = (text) => String(text || '').replace(/\s+/g, '').toLowerCase();

module.exports = {
  TYPES,
  SIDES,
  typeLabel,
  normalizeType,
  buildMarkdown,
  buildNoteMarkdown,
  buildPack,
  buildJson,
  parseFile,
  dedupeKey,
  fmtDate,
  fmtTime,
  noteTitle,
  safeName,
  OUTCOME_CN,
  DID_CN,
  HORIZON_CN,
  EMBED_WARN_BYTES,
};
