'use strict';

/**
 * 知行 · 服务入口
 *  - 单一数据源 workspace.json（原子写 + 备份 + 快照）
 *  - 单实例锁：同一份数据只允许一个窗口
 *  - 端口占用自动顺延（最多 12 个），仅监听 127.0.0.1
 *  - 路由分发：notes / work / transfer / core / migrate
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const config = require('./config');
const store = require('./store');
const auth = require('./auth');
const { sendJson, sendError, serveStatic, serveMedia, logError } = require('./util');

/* 登录页与账户接口必须公开，其余一切（含前端资源、图片、导出）都要登录 */
const PUBLIC_PAGES = new Set(['/login.html', '/favicon.svg', '/favicon.ico', '/manifest.webmanifest']);

/* ------------------------------------------------------------ 路由装配 */

/* 静态引入，保证 esbuild / SEA 能把这些模块一起打进单文件 */
const ROUTE_MODULES = {
  notes: require('./routes/notes'),
  work: require('./routes/work'),
  transfer: require('./routes/transfer'),
  core: require('./routes/core'),
  migrate: require('./routes/migrate'),
};
const routes = [];
for (const [name, mod] of Object.entries(ROUTE_MODULES)) {
  try {
    const handle = typeof mod === 'function' ? mod : (mod && typeof mod.handle === 'function' ? mod.handle : null);
    if (handle) routes.push({ name, handle });
  } catch (err) {
    console.error(`[知行] 路由模块 ${name} 加载失败：${err.message}`);
    logError(`route-${name}`, err);
  }
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const query = url.searchParams;
  for (const route of routes) {
    try {
      const handled = await route.handle(req, res, pathname, query);
      if (handled) return;
    } catch (err) {
      logError(`api-${route.name}`, err);
      if (!res.headersSent) sendError(res, 500, '服务器出了点问题，这次请求没有完成。详见 data/errors.log');
      else try { res.end(); } catch (_) { /* 忽略 */ }
      return;
    }
  }
  sendError(res, 404, '没有这个接口');
}

/* ------------------------------------------------------------ 单实例锁 */

const pidAlive = (pid) => {
  if (!pid || pid === process.pid) return pid === process.pid;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
};

function readLock() {
  try { return JSON.parse(fs.readFileSync(config.LOCK_FILE, 'utf8')); } catch (_) { return null; }
}

function writeLock(port) {
  try {
    fs.mkdirSync(path.dirname(config.LOCK_FILE), { recursive: true });
    fs.writeFileSync(config.LOCK_FILE, JSON.stringify({
      pid: process.pid, port, dataDir: config.DATA_DIR, startedAt: Date.now(),
    }, null, 2));
  } catch (err) { logError('lock', err); }
}

function releaseLock() {
  try {
    const lock = readLock();
    if (lock && lock.pid === process.pid) fs.unlinkSync(config.LOCK_FILE);
  } catch (_) { /* 忽略 */ }
}

function probeApp(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: config.HOST, port, path: '/api/health', timeout: 800 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      res.on('end', () => {
        try { const data = JSON.parse(body); resolve(res.statusCode === 200 && data.ok && data.app === 'zhixing'); }
        catch (_) { resolve(false); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function acquireLock() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.mkdirSync(path.dirname(config.LOCK_FILE), { recursive: true });
      const fd = fs.openSync(config.LOCK_FILE, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, port: null, dataDir: config.DATA_DIR, startedAt: Date.now() }, null, 2));
      fs.closeSync(fd);
      return { ok: true };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const lock = readLock();
      if (lock && pidAlive(lock.pid) && lock.pid !== process.pid) {
        await sleep(900);
        const fresh = readLock();
        const port = fresh && fresh.port;
        if (port && await probeApp(port)) return { ok: false, pid: fresh.pid, port };
      }
      // 残锁：进程已死或刚启动未写端口，回收后重试
      try { fs.unlinkSync(config.LOCK_FILE); } catch (_) { /* 忽略 */ }
      await sleep(250);
    }
  }
  return { ok: false, pid: null, port: null };
}

/* ------------------------------------------------------------ 启动 */

let server = null;
let closing = false;

function announce(port) {
  const db = store.db;
  console.log('');
  console.log('  ◈  知行 · 工作台 已启动');
  console.log(`     地址   http://${config.HOST}:${port}`);
  console.log(`     数据   ${config.DB_FILE}`);
  console.log(`     内容   ${db.notes.length} 条笔记 · ${db.entries.filter((e) => !e.deletedAt).length} 条记录 · ${db.projects.length} 个项目`);
  console.log('     退出   Ctrl+C（会自动落盘）');
  console.log('');
  if (process.argv.includes('--open') || process.env.ZHIXING_OPEN === '1') {
    const url = `http://${config.HOST}:${port}`;
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`;
    exec(cmd, () => { /* 打不开就算了 */ });
  }
}

function listenOn(port, tries = config.PORT_TRIES) {
  return new Promise((resolve, reject) => {
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${config.HOST}:${port || config.PORT}`);
      const pathname = decodeURIComponent(url.pathname);
      try {
        if (pathname.startsWith('/api/auth/')) {
          await auth.handle(req, res, url);
          return;
        }
        if (pathname === '/api/health') {
          // 探活公开，但不暴露数据条数、路径、进程号
          if (req.method === 'GET') {
            const pub = auth.publicStatus(req);
            return sendJson(res, 200, { ok: true, app: 'zhixing', ...pub });
          }
          return sendError(res, 405, 'method not allowed');
        }
        if (pathname.startsWith('/api/') || pathname.startsWith('/media/')) {
          if (!auth.isAuthed(req)) {
            return sendError(res, 401, '会话已失效，请先登录。', { authRequired: true });
          }
          if (pathname.startsWith('/api/')) await handleApi(req, res, url);
          else serveMedia(req, res, url.pathname);
          return;
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
          if (!PUBLIC_PAGES.has(pathname)) {
            if (!auth.isAuthed(req)) {
              const wantsHtml = /text\/html/.test(String(req.headers.accept || '')) ||
                pathname === '/' || pathname.endsWith('.html');
              if (wantsHtml) {
                res.writeHead(302, { Location: '/login.html', 'Cache-Control': 'no-store' });
                return res.end();
              }
              return sendError(res, 401, '请先登录', { authRequired: true });
            }
          }
          serveStatic(req, res, pathname);
          return;
        }
        sendError(res, 405, 'method not allowed');
      } catch (err) {
        logError('http', err);
        if (!res.headersSent) sendError(res, 500, '服务器出了点问题');
      }
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && tries > 0) {
        server.close(() => { listenOn(port + 1, tries - 1).then(resolve, reject); });
        return;
      }
      reject(err);
    });
    server.listen(port, config.HOST, () => resolve(port));
  });
}

async function boot() {
  store.ensureDirs();
  await store.load();

  // 第一次打开：播一份演示数据，首屏不是空白；设置里可以一键清空。
  try {
    const demo = require('./demo');
    if (demo.seedIfEmpty(store)) {
      const ok = await store.persist();
      if (ok) {
        const d = store.db;
        console.log(`  ◈  已放入演示数据：${d.projects.length} 个项目、${d.entries.length} 条记录、${d.notes.length} 条笔记`);
        console.log('     设置 → 数据安全 → 清空演示数据，可以随时移除。');
      }
    }
  } catch (err) {
    logError('demo', err);
  }

  const lock = await acquireLock();
  if (!lock.ok) {
    console.error('');
    console.error('  ◈  知行：另一个窗口正在使用这份数据');
    if (lock.pid) console.error(`     那个窗口的进程号是 ${lock.pid}${lock.port ? `，地址 http://${config.HOST}:${lock.port}` : ''}`);
    console.error('     关掉它，或者换一份数据目录（环境变量 ZHIXING_DATA）再开。');
    console.error('');
    process.exit(2);
  }

  try {
    const port = await listenOn(config.PORT);
    writeLock(port);
    announce(port);
  } catch (err) {
    releaseLock();
    console.error(`  ◈  知行启动失败：${err.message}`);
    process.exit(1);
  }
}

async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  try {
    await store.persist();
  } catch (err) {
    logError('shutdown-persist', err);
  }
  releaseLock();
  if (!server) process.exit(code);
  const timer = setTimeout(() => process.exit(code), 1500);
  if (timer.unref) timer.unref();
  server.close(() => {
    clearTimeout(timer);
    process.exit(code);
  });
}

process.on('SIGINT', () => { shutdown(0); });
process.on('SIGTERM', () => { shutdown(0); });
if (process.platform === 'win32') process.on('SIGBREAK', () => { shutdown(0); });
process.on('exit', releaseLock);

process.on('uncaughtException', (err) => {
  logError('uncaught', err);
  console.error(`[知行] 未捕获异常：${err.stack || err.message}`);
});
process.on('unhandledRejection', (err) => {
  logError('unhandled-rejection', err);
});

if (config.EMBEDDED) {
  module.exports = { routes, handleApi, boot };
} else {
  boot().catch((err) => {
    console.error(`  ◈  知行启动失败：${err.stack || err.message}`);
    process.exit(1);
  });
}