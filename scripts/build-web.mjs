/** 知行 · 构建 GitHub Pages 纯浏览器版 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32',
    env: { ...process.env, VITE_WEB: '1' } });
  if (r.status !== 0) throw new Error(`${cmd} 失败（${r.status}）`);
}

console.log('\n◈  知行 · 构建网页版（GitHub Pages）\n');
console.log('[1/3] 生成浏览器库…');
run(process.execPath, [join(ROOT, 'scripts', 'gen-web-libs.mjs')]);
console.log('[2/3] 构建前端…');
run(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);

// 网页版不需要桌面版的启动页与登录页，删掉避免误访问
console.log('[3/3] 清理桌面版专属页面…');
const { rmSync, existsSync } = await import('node:fs');
const out = join(ROOT, 'gh-pages');
for (const f of ['splash.html', 'login.html']) {
  const p = join(out, f);
  if (existsSync(p)) rmSync(p);
}
console.log('完成，产物在 gh-pages/\n');
