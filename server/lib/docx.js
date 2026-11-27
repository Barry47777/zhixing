'use strict';
/**
 * Word(.docx) 导出 —— 零依赖，只复用 lib/zip.js 打一个最小的 OOXML 包。
 *
 * 为什么手写而不是引 docx 库：本项目的红线是零第三方依赖（见
 * docs/复盘简化重构-执行提示词.md §8 与 package.json 的 dependencies 为空）。
 * 我们只需要「段落 + 粗斜下划线 + 字号颜色 + 对齐 + 内嵌图片」这六件事，
 * 用不到样式表、页眉页脚、批注这些，一个 300 行的生成器足够。
 *
 * 包结构（最小可打开）：
 *   [Content_Types].xml
 *   _rels/.rels                        → word/document.xml
 *   word/document.xml                  正文
 *   word/_rels/document.xml.rels       → word/media/imageN.ext
 *   word/media/imageN.ext              图片本体
 *
 * 图片**紧跟它所属的段落**（richtext.htmlToBlocks 已经把图文顺序拆好），
 * 不会被堆到文末 —— 这是提示词 §8.2 的硬性要求。
 */

const { makeZip } = require('./zip');
const richtext = require('./richtext');
const transfer = require('./transfer');

const EMU_PER_PX = 9525;          // 96dpi → EMU
const MAX_W_PX = 601;             // A4 减去左右边距后的可用宽度
const MIME_EXT = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp' };

const xmlEscape = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/* ------------------------------ 图片尺寸 ------------------------------ */

/** 从文件头读像素尺寸（不引图像库）。读不出来就按 4:3 估一个，docx 仍然能打开。 */
function imageSize(buf, ext) {
  try {
    if (ext === 'png' && buf.length > 24) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    if (ext === 'gif' && buf.length > 10) {
      return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    }
    if (ext === 'jpg' || ext === 'jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const marker = buf[i + 1];
        const size = buf.readUInt16BE(i + 2);
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        i += 2 + size;
      }
    }
    if (ext === 'webp' && buf.length > 30) {
      const kind = buf.toString('ascii', 12, 16);
      if (kind === 'VP8X') {
        const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
        const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
        return { w, h };
      }
      if (kind === 'VP8 ') {
        return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      }
    }
  } catch (_) { /* 头坏了就退化成估值 */ }
  return { w: 800, h: 600 };
}

/* ------------------------------ 段落 / 文字 ------------------------------ */

function runXml(text, run) {
  const props = [];
  if (run.bold) props.push('<w:b/>');
  if (run.italic) props.push('<w:i/>');
  if (run.underline) props.push('<w:u w:val="single"/>');
  if (run.strike) props.push('<w:strike/>');
  if (run.size) props.push(`<w:sz w:val="${Math.round(Math.min(44, Math.max(9, run.size)) * 2)}"/>`);
  if (run.color) {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(run.color);
    if (hex) {
      const v = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
      props.push(`<w:color w:val="${v.toUpperCase()}"/>`);
    }
  }
  // 手工换行要拆成 <w:br/>，不然 Word 里会挤成一行
  const chunks = String(text).split('\n');
  const inner = chunks
    .map((c, i) => `${i ? '<w:br/>' : ''}${c ? `<w:t xml:space="preserve">${xmlEscape(c)}</w:t>` : ''}`)
    .join('');
  return `<w:r>${props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''}${inner || '<w:t/>'}</w:r>`;
}

function paraXml(text, run = {}, { align = 'left', list = null, heading = 0, styleExtra = '' } = {}) {
  const pPr = [];
  if (heading) pPr.push(`<w:pStyle w:val="Heading${heading}"/>`);
  const jc = { center: 'center', right: 'right', justify: 'both' }[align] || 'left';
  if (jc !== 'left' || heading) pPr.push(`<w:jc w:val="${jc}"/>`);
  pPr.push('<w:spacing w:after="120" w:line="300" w:lineRule="auto"/>');
  if (list) pPr.push('<w:ind w:left="360" w:hanging="240"/>');
  const body = `${heading ? '' : ''}${runXml(text, run)}`;
  return `<w:p>${styleExtra}${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${body}</w:p>`;
}

function imageXml(relId, name, id, wPx, hPx) {
  const scale = Math.min(1, MAX_W_PX / Math.max(1, wPx));
  const cx = Math.round(wPx * scale * EMU_PER_PX);
  const cy = Math.round(hPx * scale * EMU_PER_PX);
  return `<w:p><w:pPr><w:spacing w:before="60" w:after="120"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>
<wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>
<wp:docPr id="${id}" name="Picture ${id}"/>
<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:nvPicPr><pic:cNvPr id="${id}" name="${xmlEscape(name)}"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

/* ------------------------------ 组装 ------------------------------ */

/**
 * @param {Array} notes
 * @param {Object} meta { scopeLabel, readImage(url)->Buffer|null, title }
 * @returns {Buffer} docx
 */
function buildDocx(notes, meta = {}) {
  const list = [...notes].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const media = [];            // { name, ext, buf }
  const rels = [];             // { id, target }
  let picId = 1;
  const bodyParts = [];

  bodyParts.push(paraXml(`复盘 · Edge 导出 ${transfer.fmtDate(Date.now())}`, { bold: true, size: 18 }, { align: 'left', heading: 0 }));
  const sub = [`共 ${list.length} 条`, `导出时间：${transfer.fmtTime(Date.now())}`];
  if (meta.scopeLabel) sub.push(`范围：${meta.scopeLabel}`);
  bodyParts.push(paraXml(sub.join('　|　'), { size: 10, color: '#666666' }, { align: 'left' }));

  list.forEach((note, index) => {
    if (index > 0) bodyParts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');

    const seq = Number(note.seq) || 0;
    const title = (note.content ? richtext.summary(note.content, 40) : '')
      || transfer.noteTitle(note) || '（无标题）';
    bodyParts.push(paraXml(`${seq ? `#${seq}　` : ''}${title}`, { bold: true, size: 16 }, { heading: 1 }));

    // 正文：按编辑器顺序逐块输出，图片紧跟所属段落
    const blocks = richtext.htmlToBlocks(note.content || '');
    for (const block of blocks) {
      if (block.type === 'img') {
        const buf = meta.readImage ? meta.readImage(block.src) : null;
        const nameOnDisk = String(block.src).split('/').pop();
        if (!buf) {
          bodyParts.push(paraXml(`[图片缺失] ${nameOnDisk}`, { italic: true, color: '#999999' }, { align: 'left' }));
          continue;
        }
        const ext = (MIME_EXT[String(block.src).split('.').pop().toLowerCase()] || 'png');
        const name = `image${media.length + 1}.${ext}`;
        media.push({ name, buf, ext });
        const relId = `rIdImg${media.length}`;
        rels.push({ id: relId, target: `media/${name}` });
        const size = imageSize(buf, ext === 'jpeg' ? 'jpg' : ext);
        bodyParts.push(imageXml(relId, name, picId, size.w, size.h));
        picId += 1;
        continue;
      }
      const prefix = block.list === 'ul' ? '• ' : block.list === 'ol' ? `${block.index || 1}. ` : '';
      const text = prefix + block.runs.map((r) => r.text).join('');
      // 一段里可能混着不同样式：按 run 逐个吐，保留粗体/颜色
      const runs = block.runs.map((r) => runXml(r.text, r)).join('');
      const pPrJc = { center: 'center', right: 'right', justify: 'both' }[block.align] || 'left';
      bodyParts.push(`<w:p><w:pPr>${pPrJc !== 'left' ? `<w:jc w:val="${pPrJc}"/>` : ''}${block.list ? '<w:ind w:left="360" w:hanging="240"/>' : ''}<w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr>${prefix ? runXml(prefix, {}) : ''}${runs}</w:p>`);
      void text;
    }

    // 元信息：标签 / 时间 / 区
    const metaBits = [];
    if (note.tags && note.tags.length) metaBits.push(`标签：${note.tags.map((t) => `#${t}`).join(' ')}`);
    metaBits.push(`建立：${transfer.fmtTime(note.createdAt)}`);
    if (note.result && note.result.outcome) metaBits.push(`结果：${transfer.OUTCOME_CN[note.result.outcome] || note.result.outcome}`);
    bodyParts.push(paraXml(metaBits.join('　|　'), { size: 9, color: '#888888' }, { align: 'left' }));
  });

  bodyParts.push(`<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>`);

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${bodyParts.join('')}</w:body></w:document>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map((r) => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${xmlEscape(r.target)}"/>`).join('')}</Relationships>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  const exts = [...new Set(media.map((m) => m.ext))];
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${exts.map((e) => `<Default Extension="${e}" ContentType="image/${e === 'jpg' ? 'jpeg' : e}"/>`).join('')}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

  const entries = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'word/document.xml', data: docXml },
    { name: 'word/_rels/document.xml.rels', data: relsXml },
    ...media.map((m) => ({ name: `word/media/${m.name}`, data: m.buf })),
  ];
  return makeZip(entries);
}

/* ------------------------------ 导入：docx → 纯文本 ------------------------------ */

/** 从 document.xml 的一段里抽纯文本 */
function textOfChunk(chunk) {
  const texts = [];
  const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>|<w:br\s*\/>|<w:tab\s*\/>/g;
  let m;
  while ((m = re.exec(chunk)) !== null) {
    if (m[1] !== undefined) texts.push(richtext.unescapeHtml(m[1]));
    else if (m[0].startsWith('<w:br')) texts.push('\n');
    else if (m[0].startsWith('<w:tab')) texts.push('　');
  }
  return texts.join('');
}

/**
 * 从 .docx 里把正文抽成纯文本（段落用空行分隔）。
 * 只做「导回来还能读」这一件事：不还原样式。
 */
function readDocxText(buf) {
  let entries;
  try { entries = require('./zip').readZip(buf); } catch (err) { return ''; }
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) return '';
  return doc.data.toString('utf8')
    .split(/<\/w:p>/)
    .map((chunk) => textOfChunk(chunk).trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * 按「分页符」把 docx 拆回一条一条（我们自己导出的 docx 就是一条一页），
 * 连带把每节里引用的图片按出现顺序取回来 —— 这样 docx 也能参与导入回环。
 * @returns {Array<{text:string, images:Array<Buffer>, imageExts:string[]}>}
 */
function readDocxNotes(buf, maxImages = 9) {
  let entries;
  try { entries = require('./zip').readZip(buf); } catch (err) { return []; }
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) return [];
  const byName = new Map(entries.map((e) => [e.name, e.data]));

  // rIdN → word/media/xxx
  const relsEntry = entries.find((e) => e.name === 'word/_rels/document.xml.rels');
  const relMap = new Map();
  if (relsEntry) {
    const rels = relsEntry.data.toString('utf8');
    const re = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g;
    let m;
    while ((m = re.exec(rels)) !== null) {
      const target = m[2].replace(/^\.\//, '');
      relMap.set(m[1], target.startsWith('word/') ? target : `word/${target}`);
    }
  }

  const xml = doc.data.toString('utf8');
  const chunks = xml.split(/<w:br\s+w:type="page"\s*\/>/);

  const out = [];
  for (const chunk of chunks) {
    const text = chunk.split(/<\/w:p>/).map((p) => textOfChunk(p).trim()).filter(Boolean).join('\n\n');
    const images = [];
    const imageExts = [];
    const re = /<a:blip[^>]*r:embed="([^"]+)"/g;
    let m;
    while ((m = re.exec(chunk)) !== null) {
      const target = relMap.get(m[1]);
      const data = target ? byName.get(target) : null;
      if (!data) continue;
      images.push(data);
      imageExts.push(String(target).split('.').pop().toLowerCase());
      if (images.length >= maxImages) break;
    }
    if (text || images.length) out.push({ text, images, imageExts });
  }
  return out;
}

module.exports = { buildDocx, readDocxText, readDocxNotes, imageSize };
