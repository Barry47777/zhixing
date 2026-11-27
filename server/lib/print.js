'use strict';
/**
 * 打印视图（给「导出 PDF」用）—— 零依赖，服务端只吐一页 HTML，
 * 真正的 PDF 由浏览器打印对话框「另存为 PDF」生成（提示词 §9 路径一）。
 *
 * 三条硬性要求落在 buildPrintHtml 里：
 *   1. 图片紧跟所属段落之后 —— 用 richtext.htmlToBlocks 的顺序，逐块渲染；
 *   2. 图文顺序与编辑器内一致 —— 不排序、不汇总、不把图堆到文末；
 *   3. 缺图不静默跳过 —— 换成「图片缺失」占位块。
 */

const richtext = require('./richtext');
const transfer = require('./transfer');

const escape = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const ALIGN = { left: 'left', center: 'center', right: 'right', justify: 'justify' };

function runHtml(run) {
  let s = escape(run.text).replace(/\n/g, '<br />');
  if (run.bold) s = `<strong>${s}</strong>`;
  if (run.italic) s = `<em>${s}</em>`;
  if (run.underline) s = `<u>${s}</u>`;
  if (run.strike) s = `<s>${s}</s>`;
  const style = [];
  if (run.color) style.push(`color:${run.color}`);
  if (run.size) style.push(`font-size:${run.size}px`);
  return style.length ? `<span style="${style.join(';')}">${s}</span>` : s;
}

function blockHtml(block, meta) {
  if (block.type === 'img') {
    const buf = meta.readImage ? meta.readImage(block.src) : null;
    if (!buf) {
      return `<p class="missing">[图片缺失] ${escape(block.src.split('/').pop())}</p>`;
    }
    const ext = String(block.src).split('.').pop().toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : (ext || 'png');
    return `<p class="pic"><img src="data:image/${mime};base64,${buf.toString('base64')}" alt="" /></p>`;
  }

  const inner = block.runs.map(runHtml).join('') || '&nbsp;';
  const align = ALIGN[block.align];
  const style = align && align !== 'left' ? ` style="text-align:${align}"` : '';
  if (block.list === 'ol') return `<p class="li"${style}><span class="idx">${block.index}.</span>${inner}</p>`;
  if (block.list === 'ul') return `<p class="li"${style}><span class="idx">•</span>${inner}</p>`;
  return `<p${style}>${inner}</p>`;
}

/** 一条记录一节：标题 → 正文（图文按序）→ 元信息 */
function noteSection(note, index, meta) {
  const title = `#${note.seq || index + 1}　${escape(transfer.noteTitle(note) || '（无标题）')}`;
  const parts = [`<section class="note">`, `<h2>${title}</h2>`];

  const content = String(note.content || '');
  if (content && richtext.htmlToText(content)) {
    for (const block of richtext.htmlToBlocks(content)) parts.push(blockHtml(block, meta));
  } else if (note.zone === 'review') {
    const legacy = [note.seen, note.think, note.after && note.after.text].filter((s) => String(s || '').trim());
    for (const s of legacy) {
      for (const line of String(s).split(/\n/)) parts.push(`<p>${escape(line) || '&nbsp;'}</p>`);
    }
  }

  // 正文里没引用的图（老数据）补在后面，保持「不丢图」
  const inline = new Set(richtext.imageSrcs(content));
  const extras = (note.images || []).filter((img) => img && img.url && !inline.has(img.url));
  for (const img of extras) {
    parts.push(blockHtml({ type: 'img', src: img.url }, meta));
  }

  const bits = [transfer.typeLabel(note.type)];
  if (note.result && note.result.outcome) bits.push(`结果：${transfer.OUTCOME_CN[note.result.outcome] || note.result.outcome}`);
  if (note.tags && note.tags.length) bits.push(note.tags.map((t) => `#${t}`).join(' '));
  bits.push(transfer.fmtTime(note.createdAt));
  parts.push(`<p class="meta">${escape(bits.join('　·　'))}</p>`, '</section>');
  return parts.join('\n');
}

/**
 * 整页 HTML。
 * @param {Array} notes
 * @param {{scopeLabel?:string, readImage?:(url:string)=>Buffer|null, autoPrint?:boolean}} meta
 */
function buildPrintHtml(notes, meta = {}) {
  const list = [...notes].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const title = `交易复盘 · ${meta.scopeLabel || '全部'}`;
  const body = list.map((n, i) => noteSection(n, i, meta)).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<title>${escape(title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #16181d;
    font: 15px/1.75 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  header { margin: 0 0 18px; padding-bottom: 10px; border-bottom: 1px solid #e3e5ea; }
  h1 { margin: 0 0 6px; font-size: 20px; }
  .sub { margin: 0; color: #6b7280; font-size: 12px; }
  section.note { padding: 0 0 14px; margin: 0 0 16px; border-bottom: 1px dashed #e3e5ea; break-inside: avoid; }
  section.note:last-child { border-bottom: 0; }
  h2 { margin: 0 0 10px; font-size: 16px; line-height: 1.5; }
  p { margin: 0 0 8px; white-space: pre-wrap; word-break: break-word; }
  p.li { padding-left: 18px; text-indent: -18px; }
  p.li .idx { display: inline-block; width: 18px; }
  p.pic { margin: 4px 0 10px; }
  p.pic img { max-width: 100%; max-height: 220mm; border-radius: 4px; }
  p.missing { color: #b91c1c; font-style: italic; font-size: 12px; }
  p.meta { margin-top: 10px; color: #6b7280; font-size: 12px; }
  /* 屏幕预览也像一张纸：居中、限宽、留白；打印时交回 @page 管 */
  @media screen {
    body { max-width: 820px; margin: 0 auto; padding: 40px 32px 96px; }
  }
  @media print { a { color: inherit; text-decoration: none; } }
</style></head>
<body>
<header><h1>${escape(title)}</h1>
<p class="sub">共 ${list.length} 条　·　导出时间 ${escape(transfer.fmtTime(Date.now()))}</p></header>
${body}
${meta.autoPrint ? '<script>window.addEventListener("load", () => setTimeout(() => window.print(), 120));</script>' : ''}
</body></html>`;
}

module.exports = { buildPrintHtml };
