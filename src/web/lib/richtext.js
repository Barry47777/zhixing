// 由 scripts/gen-web-libs.mjs 从 server/lib/richtext.js 自动生成，请勿手改
'use strict';
/**
 * 富文本（零依赖）
 *
 * 记录区现在是一个 contenteditable 大框，正文以 **消毒后的 HTML 片段** 存在 note.content。
 * 这个文件只做三件事：
 *   1. sanitizeHtml —— 白名单重建标签（不复制原始属性，天然免疫 on* / javascript:）
 *   2. htmlToText   —— 给搜索 / 去重 / 引用扫描 / 摘要用的纯文本
 *   3. htmlToBlocks —— 给 docx / 打印用的结构化块（段落 + 内联 run + 图片，保持图文顺序）
 * 另外两个小工具：fromLegacy（老记录 seen+think → content）、htmlToMarkdown（导出降级）。
 *
 * 白名单之外的一切：普通标签拆掉保留文字（span/div/a…），危险标签连内容一起丢（script/style…）。
 */

const ALLOWED = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del',
  'ul', 'ol', 'li', 'span', 'div', 'img',
  'h2', 'h3', 'blockquote',   // 编辑器的小标题 / 引用；属性仍走同一套白名单清洗
]);

// 连内容一起丢：这些标签里的东西不该出现在一篇笔记里
const DROP_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript']);

// 这些标签直接展开（保留子节点）—— 链接、字体、表格等
const UNWRAP = new Set(['a', 'font', 'sub', 'sup', 'code', 'pre', 'h1', 'h4', 'h5', 'h6', 'textarea', 'button', 'label']);

const STYLE_PROPS = ['font-size', 'color', 'text-align', 'font-weight', 'font-style', 'text-decoration'];

const MAX_HTML = 4000000;      // 单条正文上限（字符）
const MAX_DEPTH = 24;

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function unescapeHtml(s) {
  return String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    const k = String(code).toLowerCase();
    if (k[0] === '#') {
      const num = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(num) && num > 0 && num < 0x10000 ? String.fromCharCode(num) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITY, k) ? ENTITY[k] : m;
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------ 样式白名单 ------------------------------ */

const SIZE_RE = /^(\d{1,2}(?:\.\d)?)(px|pt|em|rem|%)$/;
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]{3,40}\))$/i;
const ALIGN_OK = new Set(['left', 'center', 'right', 'justify']);
const WEIGHT_OK = new Set(['normal', 'bold', '400', '500', '600', '700', '800', '900']);
const DECOR_OK = new Set(['none', 'underline', 'line-through', 'underline line-through']);

function cleanStyle(raw) {
  const out = [];
  String(raw || '').split(';').forEach((decl) => {
    const i = decl.indexOf(':');
    if (i < 0) return;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim().toLowerCase();
    if (!value || value.length > 60) return;
    if (!STYLE_PROPS.includes(prop)) return;
    if (/url\s*\(|expression|javascript|\\/.test(value)) return;
    if (prop === 'font-size') {
      const m = SIZE_RE.exec(value);
      if (!m) return;
      const n = Number(m[1]);
      const px = m[2] === 'px' ? n : m[2] === 'pt' ? n * 1.333 : m[2] === 'em' || m[2] === 'rem' ? n * 16 : 16;
      if (px < 9 || px > 44) return;             // 字号只收小/中/大之间
      out.push(`font-size: ${Math.round(px)}px`);
      return;
    }
    if (prop === 'color') { if (COLOR_RE.test(value)) out.push(`color: ${value}`); return; }
    if (prop === 'text-align') { if (ALIGN_OK.has(value)) out.push(`text-align: ${value}`); return; }
    if (prop === 'font-weight') { if (WEIGHT_OK.has(value)) out.push(`font-weight: ${value}`); return; }
    if (prop === 'font-style') { if (value === 'normal' || value === 'italic') out.push(`font-style: ${value}`); return; }
    if (prop === 'text-decoration') { if (DECOR_OK.has(value)) out.push(`text-decoration: ${value}`); }
  });
  return out.join('; ');
}

/** 只认本机图库里的图；data: 一律不进正文（导入时先落盘换成 /media/） */
function cleanImgSrc(src) {
  const v = unescapeHtml(String(src || '')).trim();
  if (/^data:image\/(png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=\s]+$/i.test(v)) return v;
  if (!/^\/media\/[\w./-]+$/.test(v) || v.includes('..')) return null;
  return v;
}

/* ------------------------------ 消毒 ------------------------------ */

function parseAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z_:][-\w:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
    if (!(name in attrs)) attrs[name] = value;   // 同名取第一个（后写的可能想覆盖）
  }
  return attrs;
}

/**
 * 白名单重建。永远不复制来源标签的原始属性串 —— 输出的每个属性都是我们自己写的。
 * @param {string} html
 * @returns {string} 干净的 HTML 片段
 */
function sanitizeHtml(html) {
  let src = String(html == null ? '' : html);
  if (!src) return '';
  if (src.length > MAX_HTML) src = src.slice(0, MAX_HTML);

  // 注释先干掉（里面可能藏着伪装的闭合标签）
  src = src.replace(/<!--[\s\S]*?-->/g, '');

  const out = [];
  const stack = [];
  let skipUntil = '';        // 正在丢弃内容的标签名
  let skipDepth = 0;
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      const text = src.slice(i);
      if (!skipUntil) out.push(escapeHtml(unescapeHtml(text)));
      break;
    }
    if (lt > i) {
      const text = src.slice(i, lt);
      if (!skipUntil) out.push(escapeHtml(unescapeHtml(text)));
    }

    const gt = src.indexOf('>', lt);
    if (gt < 0) break;                        // 残缺标签：剩下的当文本
    const inner = src.slice(lt + 1, gt);
    i = gt + 1;

    const closing = inner[0] === '/';
    const body = closing ? inner.slice(1) : inner;
    const nameMatch = /^\s*([a-zA-Z][\w-]*)/.exec(body);
    if (!nameMatch) continue;                 // <!doctype>、<?xml> 之类：丢掉
    const name = nameMatch[1].toLowerCase();
    const selfClose = /\/\s*$/.test(body) || name === 'br' || name === 'img';

    if (skipUntil) {
      if (name === skipUntil) {
        if (closing) { skipDepth -= 1; if (skipDepth <= 0) skipUntil = ''; } else if (!selfClose) skipDepth += 1;
      }
      continue;
    }

    if (DROP_CONTENT.has(name)) {
      if (!closing && !selfClose) { skipUntil = name; skipDepth = 1; }
      continue;
    }

    if (closing) {
      for (let d = stack.length - 1; d >= 0; d -= 1) {
        if (stack[d] === name) {
          stack.length = d;
          out.push(`</${name}>`);
          break;
        }
      }
      continue;
    }

    if (UNWRAP.has(name) || !ALLOWED.has(name)) {
      continue;                               // 拆掉标签，保留里面的文字
    }
    if (stack.length >= MAX_DEPTH) continue;

    const attrs = parseAttrs(body.slice(nameMatch[0].length));

    if (name === 'img') {
      const src2 = cleanImgSrc(attrs.src);
      if (!src2) continue;
      out.push(`<img src="${escapeHtml(src2)}" alt="" />`);
      continue;
    }
    if (name === 'br') { out.push('<br />'); continue; }

    const style = cleanStyle(attrs.style);
    out.push(style ? `<${name} style="${style}">` : `<${name}>`);
    if (!selfClose) stack.push(name);
  }

  // 补全没闭合的标签，保证下游 innerHTML 不会把整页吞进去
  while (stack.length) out.push(`</${stack.pop()}>`);

  let clean = out.join('');
  // 空段落 / 连续空行收敛，省得正文里一眼全是空行
  clean = clean.replace(/(<p[^>]*>\s*(<br\s*\/?>\s*)*<\/p>){2,}/gi, '<p><br /></p>');
  clean = clean.replace(/\s+(style="[^"]*")\s*>/gi, ' $1>');
  return clean.trim();
}

/* ------------------------------ 降级：纯文本 ------------------------------ */

const BLOCK_BREAK = /<\/(p|div|li|ul|ol|h[1-6]|blockquote)>/gi;

function htmlToText(html) {
  let s = String(html == null ? '' : html);
  if (!s) return '';
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(BLOCK_BREAK, '\n');
  s = s.replace(/<img[^>]*src="([^"]+)"[^>]*>/gi, '\n[图] $1\n');
  s = s.replace(/<[^>]+>/g, '');
  s = unescapeHtml(s);
  return s.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 富文本 → Markdown 降级。
 * 粗体→**、斜体→*、下划线→原样、删除线→~~、图片→![图](src)、段落→空行、列表→- / 1.
 */
function htmlToMarkdown(html) {
  const blocks = htmlToBlocks(html);
  const lines = [];
  for (const b of blocks) {
    if (b.type === 'img') { lines.push('', `![图](${b.src})`, ''); continue; }
    let text = '';
    for (const run of b.runs) {
      let t = run.text;
      if (!t) continue;
      if (run.bold) t = `**${t}**`;
      if (run.italic) t = `*${t}*`;
      if (run.strike) t = `~~${t}~~`;
      text += t;
    }
    if (!text.trim()) continue;
    if (b.list === 'ul') text = `- ${text}`;
    if (b.list === 'ol') text = `${b.index || 1}. ${text}`;
    lines.push(text, '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ------------------------------ 结构化块（docx / 打印用） ------------------------------ */

/**
 * 按编辑器里的顺序吐出块序列，图片夹在它所属的段落之后（不是全堆文末）。
 * @returns {Array<{type:'p',align:string,list:'ul'|'ol'|null,runs:Array}|{type:'img',src:string}>}
 */
function htmlToBlocks(html) {
  const src = String(html == null ? '' : html);
  const blocks = [];
  const styleStack = [];
  const listStack = [];
  let cur = null;
  let listIndex = 0;

  const pushCur = () => {
    if (!cur) return;
    const hasText = cur.runs.some((r) => typeof r.text === 'string' && r.text.trim());
    const hasImg = cur.runs.some((r) => r.img);
    if (!hasText && !hasImg) { cur = null; return; }
    // 段落里的图先抽成独立块，保证 docx 里能"图跟进段落"
    const texts = cur.runs.filter((r) => !r.img && r.text);
    if (texts.length) blocks.push({ ...cur, runs: texts });
    cur.runs.filter((r) => r.img).forEach((r) => blocks.push({ type: 'img', src: r.img }));
    cur = null;
  };

  const openBlock = (alignExp) => {
    if (cur) pushCur();
    const align = alignExp || 'left';
    const list = listStack.length ? listStack[listStack.length - 1] : null;
    if (list === 'ol') listIndex += 1;
    cur = { type: 'p', align, list, index: list === 'ol' ? listIndex : 0, runs: [] };
  };

  const inlineStyle = () => {
    const s = { bold: false, italic: false, underline: false, strike: false, size: 0, color: '' };
    for (const st of styleStack) {
      if (st.bold) s.bold = true;
      if (st.italic) s.italic = true;
      if (st.underline) s.underline = true;
      if (st.strike) s.strike = true;
      if (st.size) s.size = st.size;
      if (st.color) s.color = st.color;
    }
    return s;
  };

  const addText = (text, align) => {
    if (!text) return;
    if (!cur) openBlock(align);
    const st = inlineStyle();
    const last = cur.runs[cur.runs.length - 1];
    if (last && !last.img && last.bold === st.bold && last.italic === st.italic
      && last.underline === st.underline && last.strike === st.strike
      && last.size === st.size && last.color === st.color) {
      last.text += text;
      return;
    }
    cur.runs.push({ text, ...st });
  };

  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[4] !== undefined) { addText(unescapeHtml(m[4]).replace(/[ \t]+/g, ' '), 'left'); continue; }
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const attrs = closing ? {} : parseAttrs(m[3] || '');

    if (name === 'br') { if (cur) { cur.runs.push({ text: '\n', bold: false, italic: false, underline: false, strike: false, size: 0, color: '' }); } else openBlock('left'); continue; }

    if (name === 'img') {
      const s = closing ? null : cleanImgSrc(attrs.src);
      if (!s) continue;
      if (!cur) openBlock('left');
      cur.runs.push({ img: s });
      pushCur();                       // 图独占，紧跟它所在的段落
      continue;
    }

    if (name === 'ul' || name === 'ol') {
      pushCur();
      if (closing) { listStack.pop(); listIndex = 0; } else { listStack.push(name === 'ol' ? 'ol' : 'ul'); listIndex = 0; }
      continue;
    }
    if (name === 'li') { pushCur(); if (!closing) openBlock('left'); continue; }

    if (name === 'p' || name === 'div' || name === 'blockquote' || /^h[1-6]$/.test(name)) {
      pushCur();
      if (closing) { listIndex = listStack.length ? listIndex : 0; continue; }
      const style = cleanStyle(attrs.style || '');
      const align = (/text-align:\s*(left|center|right|justify)/.exec(style) || [])[1] || 'left';
      openBlock(align);
      continue;
    }

    if (name === 'b' || name === 'strong' || name === 'i' || name === 'em'
      || name === 'u' || name === 's' || name === 'strike' || name === 'del' || name === 'span') {
      if (!closing) {
        const style = cleanStyle(attrs.style || '');
        const sizePx = (/(?:^|;)\s*font-size:\s*(\d+(?:\.\d+)?)px/.exec(style) || [])[1];
        const color = (/color:\s*([^;]+)/.exec(style) || [])[1];
        styleStack.push({
          bold: name === 'b' || name === 'strong' || /font-weight:\s*(bold|[6-9]00)/.test(style),
          italic: name === 'i' || name === 'em' || /font-style:\s*italic/.test(style),
          underline: name === 'u' || /text-decoration:\s*underline/.test(style),
          strike: name === 's' || name === 'strike' || name === 'del' || /line-through/.test(style),
          size: sizePx ? Number(sizePx) : 0,
          color: color ? color.trim() : '',
        });
      } else {
        for (let d = styleStack.length - 1; d >= 0; d -= 1) {
          // 同名标签配对出栈（不配对也不至于崩）
          styleStack.splice(d, 1);
          break;
        }
      }
    }
  }
  pushCur();
  return blocks;
}

/* ------------------------------ 老数据迁移 ------------------------------ */

/** seen + think → content（幂等入口只在 loadDb 里调一次，已有 content 不动） */
function fromLegacy(seen, think) {
  const parts = [];
  for (const raw of [seen, think]) {
    const text = String(raw || '').replace(/\r\n/g, '\n').trim();
    if (!text) continue;
    const html = escapeHtml(text).replace(/\n/g, '<br />');
    parts.push(`<p>${html}</p>`);
  }
  return parts.join('');
}

/** 正文里出现过的图（顺序即编辑器顺序），给清理孤儿图 / 导出用 */
function imageSrcs(html) {
  const out = [];
  const re = /<img[^>]*src="([^"]+)"/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const src = cleanImgSrc(unescapeHtml(m[1]));
    if (src && !out.includes(src)) out.push(src);
  }
  return out;
}

/** 摘要：卡片标题、搜索结果都取正文前一段 */
function summary(html, max = 90) {
  const text = htmlToText(html).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export { sanitizeHtml, htmlToText, htmlToMarkdown, htmlToBlocks, fromLegacy, imageSrcs, summary, escapeHtml, unescapeHtml, cleanStyle, MAX_HTML };
