/**
 * 把 inspiration 的 CSS 收进「边缘皮肤」作用域。
 *
 * 原文件是整站 CSS，选择器直接作用在 :root / body / html 上。知行的边缘皮肤
 * 只在一部分地区生效（灵感、复盘），所以这里做一次机械改写：
 *   :root                → :root[data-skin="edge"]
 *   [data-theme="light"] → [data-skin="edge"][data-theme="light"]
 *   html[...]            → [data-skin="edge"][...]
 *   body / 普通选择器     → .edge-app 前缀
 * 只跑一次，产出 src/styles/edge/*.scoped.css；以后改皮肤直接改产出文件。
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || 'src/styles/edge');
const files = ['styles.css', 'tech.css', 'feat.css', 'desk.css', 'record.css'];

const KEEP_GLOBAL = /^(\*|::selection|\[hidden\]|@)/;

function prefixSelector(sel) {
  let s = sel.trim();
  if (!s) return s;
  if (KEEP_GLOBAL.test(s)) return s;
  if (s.startsWith(':root')) return s.replace(/^:root/, ':root[data-skin="edge"]');
  if (s.includes('[data-theme="light"]')) {
    // 已经是「亮色下的某元素」，把皮肤属性插在主题属性前面即可
    s = s.replace(/\[data-theme="light"\]/, '[data-skin="edge"][data-theme="light"]');
    return s;
  }
  if (s.startsWith('html')) return s.replace(/^html/, '[data-skin="edge"]');
  if (s.startsWith('body')) return s.replace(/^body/, '.edge-app');
  return `.edge-app ${s}`;
}

function splitTop(sel) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of sel) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

function rewrite(src, insideAt = false) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) { out += src.slice(i); break; }
    const head = src.slice(i, open).trim();
    // 找到配对的右括号
    let depth = 0;
    let j = open;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) break; }
    }
    const body = src.slice(open + 1, j);
    const tail = src.slice(j + 1);

    if (head.startsWith('@keyframes') || head.startsWith('@-webkit-keyframes') || head.startsWith('@font-face')) {
      out += `${head}{${body}}\n`;
    } else if (head.startsWith('@')) {
      out += `${head}{\n${rewrite(body, true)}}\n`;
    } else {
      const sel = splitTop(head).map(prefixSelector).join(',\n');
      out += `${sel}{${body}}\n`;
    }
    i = j + 1;
    if (!tail.trim()) break;
  }
  return out;
}

for (const name of files) {
  const src = fs.readFileSync(path.join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = rewrite(src);
  fs.writeFileSync(path.join(dir, name.replace('.css', '.scoped.css')), out);
  console.log(name, '→', name.replace('.css', '.scoped.css'), `${src.length} → ${out.length}`);
}
