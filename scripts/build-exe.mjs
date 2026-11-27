/**
 * 知行 · 打包成 Windows 单文件 exe（Node SEA）
 * 用法：npm run build:exe
 * 产物：release/知行.exe
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, readdirSync, statSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'build');
const RELEASE = join(ROOT, 'release');
const DIST = join(ROOT, 'dist');
const NODE_EXE = process.execPath;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} 执行失败（${r.status}）`);
}

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split('\\').join('/'));
  }
  return out;
}

function main() {
  console.log('\n◈  知行 · 打包单文件 exe\n');

  /* 0. 前置检查 */
  if (!existsSync(NODE_EXE)) throw new Error('找不到 Node 运行时');
  if (!existsSync(join(ROOT, 'node_modules', 'esbuild'))) throw new Error('缺少 esbuild，请先 npm install');
  if (!existsSync(join(ROOT, 'node_modules', 'postject'))) throw new Error('缺少 postject，请先 npm install');

  /* 1. 前端构建 */
  console.log('[1/6] 构建前端…');
  run(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);
  // public/ 会被 Vite 复制进 dist，splash.html 随之前端资源一起打包
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('前端构建没有产出 dist/index.html');
  if (!existsSync(join(DIST, 'splash.html'))) throw new Error('dist 缺少 splash.html（启动页）');
  if (!existsSync(join(DIST, 'login.html'))) throw new Error('dist 缺少 login.html（登录页）');

  mkdirSync(BUILD, { recursive: true });
  mkdirSync(RELEASE, { recursive: true });

  /* 2. esbuild 把 server 打成一个 CJS 入口（SEA 只认单文件） */
  console.log('[2/6] 打包服务端代码…');
  const bundle = join(BUILD, 'server.bundle.cjs');
  run(process.execPath, [join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild'),
    join(ROOT, 'server', 'sea-entry.cjs'),
    '--bundle', '--platform=node', '--format=cjs', '--target=node22',
    '--outfile=' + bundle,
    '--external:node:sea',
  ]);

  /* 3. 生成静态资源清单，供运行时释放 */
  console.log('[3/6] 收集前端资源…');
  const files = walk(DIST).sort();
  const manifest = join(BUILD, 'dist-manifest.json');
  writeFileSync(manifest, JSON.stringify(files), 'utf8');

  /* 4. 生成 SEA 配置（主脚本 + 静态资源） */
  console.log('[4/6] 生成 SEA 配置…');
  const seaConfigPath = join(BUILD, 'sea-config.json');
  // SEA 配置一律用相对路径：避免把构建机的绝对路径写进 exe
  const toRel = (p) => relative(ROOT, p).split('\\').join('/');
  const assets = { 'dist-manifest.json': toRel(manifest) };
  for (const file of files) assets['dist/' + file] = toRel(join(DIST, file));
  const seaConfig = {
    main: toRel(bundle),
    output: toRel(join(BUILD, 'sea-prep.blob')),
    assets,
    disableExperimentalSEAWarning: true,
  };
  writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2), 'utf8');

  run(process.execPath, ['--experimental-sea-config', seaConfigPath]);
  const blob = join(BUILD, 'sea-prep.blob');
  if (!existsSync(blob)) throw new Error('SEA blob 生成失败');

  /* 5. 复制 node.exe 并注入 blob */
  console.log('[5/6] 注入单文件 executable…');
  const exe = join(RELEASE, '知行.exe');
  try { rmSync(exe, { force: true }); } catch (_) { /* 忽略 */ }
  copyFileSync(NODE_EXE, exe);

  const postject = join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js');
  run(process.execPath, [postject, exe, 'NODE_SEA_BLOB', blob,
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    '--overwrite',
  ]);

  /* 6. 附带说明 */
  console.log('[6/6] 完成');
  const sizeMB = (statSync(exe).size / 1024 / 1024).toFixed(1);
  console.log(`\n  ✓ 产物：${exe}（${sizeMB} MB）`);
  console.log('  ✓ 首次运行会在 exe 同目录释放 _assets 与 data，不写入程序安装目录之外的位置');
  console.log('  ✓ 数据目录：<exe 同目录>/data，可用环境变量 ZHIXING_DATA 覆盖\n');
}

try {
  main();
} catch (err) {
  console.error('\n打包失败：' + (err && err.stack ? err.stack : err));
  process.exit(1);
}
