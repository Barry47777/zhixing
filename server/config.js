'use strict';

/**
 * 知行 · 全局配置
 * 数据目录可用 ZHIXING_DATA 覆盖（测试用多套隔离数据）。
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const DATA_DIR = process.env.ZHIXING_DATA
  ? path.resolve(process.env.ZHIXING_DATA)
  : path.join(ROOT, 'data');

const DB_FILE = path.join(DATA_DIR, 'workspace.json');
const BACKUP_FILE = path.join(DATA_DIR, 'workspace.bak.json');
const MEDIA_DIR = path.join(DATA_DIR, 'media');          // /media/ 映射到这里
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');
const PRE_UPGRADE_DIR = path.join(DATA_DIR, 'pre-upgrade');
const ERROR_LOG = path.join(DATA_DIR, 'errors.log');
const LOCK_FILE = path.join(DATA_DIR, 'instance.lock');
const AUTH_FILE = path.join(DATA_DIR, 'account.json');  // 账户：只存加盐哈希与恢复码哈希
const MIGRATE_FLAG = path.join(DATA_DIR, 'migrated-v2.flag');

const EMBEDDED = process.env.ZHIXING_EMBEDDED === '1';

// 单文件 exe：静态资源释放到 exe 同目录的 _assets，优先从那里读
const STATIC_DIR = process.env.ZHIXING_STATIC_DIR || null;
const PUBLIC_DIR = STATIC_DIR || path.join(ROOT, 'public');   // 生产静态资源（dist 复制进来）
const DIST_DIR = STATIC_DIR || path.join(ROOT, 'dist');

/** 取 `--name=value` 形式的命令行参数，没写则返回 undefined。 */
function argValue(name) {
  const hit = process.argv.find((a) => a === name || a.startsWith(name + '='));
  if (!hit) return undefined;
  const eq = hit.indexOf('=');
  return eq === -1 ? '' : hit.slice(eq + 1);
}

const PORT = Number(argValue('--port')) || Number(process.env.PORT) || 7900;
const HOST = argValue('--host') || process.env.HOST || '127.0.0.1';
const PORT_TRIES = 12;

const MAX_BODY = 1024 * 1024;             // 普通 JSON
const MAX_IMPORT = 96 * 1024 * 1024;      // 导入（zip / 备份含附件）
const MAX_UPLOAD = 24 * 1024 * 1024;      // 单个附件 base64 请求体

const DB_VERSION = 2;
const SNAPSHOT_KEEP = 5;                  // 每日启动快照
const SNAPSHOT_INTERVAL_KEEP = 24;        // 自动间隔快照
const PRE_UPGRADE_KEEP = 20;
const TRASH_DAYS = 30;

const TRASH_DAYS_MS = TRASH_DAYS * 864e5;
const FROZEN_FIELDS = ['content', 'seen', 'think', 'bet', 'did', 'skipReason', 'type', 'zone', 'stage'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json',
};

module.exports = {
  ROOT,
  DATA_DIR,
  DB_FILE,
  BACKUP_FILE,
  MEDIA_DIR,
  SNAPSHOT_DIR,
  PRE_UPGRADE_DIR,
  ERROR_LOG,
  LOCK_FILE,
  AUTH_FILE,
  MIGRATE_FLAG,
  PUBLIC_DIR,
  DIST_DIR,
  EMBEDDED,
  PORT,
  HOST,
  PORT_TRIES,
  MAX_BODY,
  MAX_IMPORT,
  MAX_UPLOAD,
  DB_VERSION,
  SNAPSHOT_KEEP,
  SNAPSHOT_INTERVAL_KEEP,
  PRE_UPGRADE_KEEP,
  TRASH_DAYS,
  TRASH_DAYS_MS,
  FROZEN_FIELDS,
  MIME,
};