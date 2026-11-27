'use strict';

/**
 * 知行 · 单文件 exe 入口（Node SEA）
 *
 * SEA 把本文件与前端 dist 作为资源一起打进 exe。启动时：
 *   1) 把前端静态资源从 SEA asset 释放到 exe 同目录的 _assets（一次解压，之后复用）
 *   2) 数据目录固定为 exe 同目录的 data/（可用 ZHIXING_DATA 覆盖）
 *   3) 启动浏览器打开启动页 → 就绪后自动进入工作台
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

let sea = null;
try { sea = require('node:sea'); } catch (_) { /* 非 SEA 环境下不释放资源 */ }

const exePath = process.execPath;
const exeDir = path.dirname(exePath);
const assetDir = path.join(exeDir, '_assets');

/** SEA asset 名称与 dist 相对路径一致，例如 assets/index-xxx.js */
function releaseAssets() {
  if (!sea || !sea.isSea()) return false;
  let names = [];
  try { names = sea.getAsset('dist-manifest.json', 'utf8'); } catch (_) { /* 没清单 */ }
  if (!names) return false;

  let list;
  try { list = JSON.parse(names); } catch (_) { return false; }
  if (!Array.isArray(list)) return false;

  // 用 manifest 的 hash 判断是否已经释放过，避免每次启动都写盘
  const stamp = path.join(assetDir, '.stamp');
  try {
    const cur = fs.readFileSync(stamp, 'utf8').trim();
    if (cur === list.join('|')) return true;
  } catch (_) { /* 需要释放 */ }

  fs.mkdirSync(assetDir, { recursive: true });
  for (const rel of list) {
    const safe = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!safe || safe.includes('..')) continue;
    const dest = path.join(assetDir, safe);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      const buf = sea.getRawAsset('dist/' + safe);
      fs.writeFileSync(dest, Buffer.from(buf));
    } catch (err) {
      console.error('[知行] 静态资源释放失败：' + safe + ' — ' + err.message);
      return false;
    }
  }
  fs.writeFileSync(stamp, list.join('|'), 'utf8');
  return true;
}

/** 告诉 config.js 静态资源去 _assets 找，数据放 exe 同目录 */
function setupEnv() {
  if (!process.env.ZHIXING_DATA) process.env.ZHIXING_DATA = path.join(exeDir, 'data');
  process.env.ZHIXING_EMBEDDED = '1';
  process.env.ZHIXING_STATIC_DIR = assetDir;
  // 关掉实验特性警告，启动画面更干净
  process.env.NODE_NO_WARNINGS = '1';
}

function openBrowser(url) {
  const cmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => { /* 打不开就算了 */ });
}

async function main() {
  const released = releaseAssets();
  setupEnv();

  const { boot } = require('./index');
  await boot();

  // boot() 内部监听成功后会从 argv 的 --open 打开根地址；exe 这里改为打开启动页
  // 用轮询探测端口，探测到再开，避免冷启动竞态
  const portArg = process.argv.find((a) => a.startsWith('--port='));
  const basePort = portArg ? Number(portArg.slice(7)) : 7900;
  const healthPaths = [];
  for (let p = basePort; p < basePort + 12; p += 1) healthPaths.push(p);

  const probe = async (port) => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(700) });
      return res.ok;
    } catch (_) { return false; }
  };

  let found = 0;
  for (let i = 0; i < 40 && !found; i += 1) {
    for (const p of healthPaths) {
      if (await probe(p)) { found = p; break; }
    }
    if (!found) await new Promise((r) => setTimeout(r, 150));
  }

  if (found) {
    openBrowser(`http://127.0.0.1:${found}/splash.html`);
  } else {
    console.error('  ◈  知行：服务没能启动，请查看 data/errors.log');
  }

  if (!released && process.env.ZHIXING_DEV !== '1') {
    // 非 SEA 环境跑这个文件属于调试，静态资源走项目 dist，不必报错
  }
}

main().catch((err) => {
  console.error('  ◈  知行启动失败：' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
