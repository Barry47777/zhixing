/**
 * 把服务端纯函数库（无 Node 依赖部分）转成浏览器 ESM，输出到 src/web/lib/
 * 用法：node scripts/gen-web-libs.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'web', 'lib');
mkdirSync(OUT, { recursive: true });

// [源文件, [具名导入映射], 需要 default/namespace 导入的映射]
const files = [
  ['server/lib/constants.js', {}],
  ['server/lib/richtext.js', {}],
  ['server/lib/links.js', { richtext: "import * as richtext from './richtext.js';" }],
  ['server/lib/review.js', { MISTAKE_GROUP_OF: "import { MISTAKE_GROUP_OF } from './constants.js';" }],
];

for (const [rel, imports] of files) {
  let src = readFileSync(join(ROOT, rel), 'utf8');

  // 替换 require 行为 ESM import
  src = src.replace(/^const richtext = require\('\.\/richtext'\);$/m, "import * as richtext from './richtext.js';");
  src = src.replace(/^const \{ MISTAKE_GROUP_OF \} = require\('\.\/constants'\);$/m, "import { MISTAKE_GROUP_OF } from './constants.js';");

  // richtext.js：网页版没有文件服务，图片以 data URL 存在正文里，
  // 因此放宽 cleanImgSrc，允许 data:image/*（仅图片，仍拒绝 javascript: 等）
  if (rel.endsWith('richtext.js')) {
    src = src.replace(
      "  if (!/^\\/media\\/[\\w./-]+$/.test(v) || v.includes('..')) return null;",
      "  if (/^data:image\\/(png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=\\s]+$/i.test(v)) return v;\n  if (!/^\\/media\\/[\\w./-]+$/.test(v) || v.includes('..')) return null;",
    );
    // data URL 图片体积大，正文上限放宽到 4MB（浏览器版数据存 IndexedDB）
    src = src.replace('const MAX_HTML = 60000;', 'const MAX_HTML = 4000000;');
  }

  // module.exports = { A, B, ... }  ->  export { A, B, ... }
  src = src.replace(/module\.exports\s*=\s*\{([\s\S]*?)\};\s*$/m, (_m, body) => {
    const names = body.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.split(':')[0].trim());
    return `export { ${names.join(', ')} };\n`;
  });

  // 顶部加注释
  src = `// 由 scripts/gen-web-libs.mjs 从 ${rel} 自动生成，请勿手改\n${src}`;

  const name = rel.split('/').pop();
  writeFileSync(join(OUT, name), src, 'utf8');

  // 生成同名 .d.ts：把每个导出声明成 any，避免隐式 any 报错
  const exportLine = src.match(/export \{([^}]*)\};\s*$/m);
  const names = exportLine ? exportLine[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
  const dts = names.map((n) => `export const ${n}: any;`).join('\n') + '\n';
  writeFileSync(join(OUT, name.replace(/\.js$/, '.d.ts')), dts, 'utf8');
  console.log('生成', join(OUT, name));
}
