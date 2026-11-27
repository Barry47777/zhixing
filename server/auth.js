'use strict';

/**
 * 知行 · 本地账户与会话
 *
 * 设计要点：
 *  - 只存 scrypt 加盐哈希，任何情况下都不落明文密码
 *  - 恢复码同样哈希存储，注册时只展示一次
 *  - 会话是内存态 session cookie：关浏览器 / 重启程序即失效
 *  - 空闲自动锁定 + 绝对有效期，离开电脑后不会被直接看到数据
 *  - 密码连续错误做指数后退，挡住本机脚本爆破
 *  - 零第三方依赖，可直接打进 SEA 单文件
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const config = require('./config');
const { sendJson, sendError, readBody, logError } = require('./util');

const COOKIE = 'zx_session';
const SESSION_TTL = 12 * 3600 * 1000;      // 绝对有效期 12 小时
const DEFAULT_IDLE_MIN = 30;               // 默认空闲 30 分钟锁定
const MIN_IDLE_MIN = 1;
const MAX_IDLE_MIN = 720;
const MAX_FAIL = 5;
const FAIL_WINDOW = 60 * 1000;
const KEYLEN = 64;

let account = null;                        // { username, salt, hash, recoverySalt, recoveryHash, createdAt, autoLockMinutes }
let loaded = false;
const sessions = new Map();                // token -> { createdAt, lastSeen }
const failures = new Map();                // ip -> { count, until }

/* ------------------------------------------------------------ 持久化 */

function load() {
  if (loaded) return account;
  loaded = true;
  try {
    if (!fs.existsSync(config.AUTH_FILE)) return null;
    const raw = fs.readFileSync(config.AUTH_FILE, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || !obj.hash || !obj.salt || !obj.username) return null;
    account = obj;
    if (!Number.isFinite(account.autoLockMinutes)) account.autoLockMinutes = DEFAULT_IDLE_MIN;
    return account;
  } catch (err) {
    logError('auth-load', err);
    return null;
  }
}

function save() {
  try {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
    fs.writeFileSync(config.AUTH_FILE, JSON.stringify(account, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(config.AUTH_FILE, 0o600); } catch (_) { /* Windows 上尽力而为 */ }
    return true;
  } catch (err) {
    logError('auth-save', err);
    return false;
  }
}

/* ------------------------------------------------------------ 密码学 */

function hashSecret(secret, salt) {
  return crypto.scryptSync(String(secret), salt, KEYLEN).toString('hex');
}

function makeSecret(secret, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  return { salt: salt.toString('hex'), hash: hashSecret(secret, salt) };
}

function equalHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch (_) { return false; }
}

/** 恢复码：ZX-XXXX-XXXX-XXXX，去掉易混淆字符 */
function newRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return `ZX-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

const normalizeCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function validPassword(pw) {
  const s = String(pw || '');
  if (s.length < 8) return '密码至少 8 位';
  if (s.length > 200) return '密码太长';
  return null;
}

function validUsername(name) {
  const s = String(name || '').trim();
  if (s.length < 1) return '请填写账户名';
  if (s.length > 32) return '账户名最多 32 个字';
  if (/[\r\n]/.test(s)) return '账户名不能包含换行';
  return null;
}

/* ------------------------------------------------------------ 会话 */

function cookieValue(req, name = COOKIE) {
  const raw = req.headers && req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function setCookie(res, token) {
  const attrs = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
  ];
  // 本地是 http，不能用 Secure；但 Strict + HttpOnly 已足够挡住跨站读取
  const prev = res.getHeader('Set-Cookie');
  const list = Array.isArray(prev) ? prev : (prev ? [prev] : []);
  res.setHeader('Set-Cookie', [...list.filter((c) => !String(c).startsWith(COOKIE + '=')), attrs.join('; ')]);
}

function clearCookie(res) {
  const prev = res.getHeader('Set-Cookie');
  const list = Array.isArray(prev) ? prev : (prev ? [prev] : []);
  res.setHeader('Set-Cookie', [...list.filter((c) => !String(c).startsWith(COOKIE + '=')),
    `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`]);
}

function idleMs() {
  return Math.max(MIN_IDLE_MIN, Math.min(MAX_IDLE_MIN, account?.autoLockMinutes || DEFAULT_IDLE_MIN)) * 60 * 1000;
}

/** 守卫用：校验当前请求是否带着有效会话；顺手滑动空闲时间 */
function isAuthed(req, touch = true) {
  if (!account) return false;
  const token = cookieValue(req);
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  const now = Date.now();
  if (now - s.createdAt > SESSION_TTL || now - s.lastSeen > idleMs()) {
    sessions.delete(token);
    return false;
  }
  if (touch) s.lastSeen = now;
  req.zxSession = token;
  return true;
}

function createSession(req, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  sessions.set(token, { createdAt: now, lastSeen: now });
  setCookie(res, token);
  return token;
}

function dropSession(req, res, all = false) {
  if (all) sessions.clear();
  else {
    const token = cookieValue(req);
    if (token) sessions.delete(token);
  }
  clearCookie(res);
}

function remainingMs(req) {
  const token = cookieValue(req);
  const s = token && sessions.get(token);
  if (!s) return 0;
  const now = Date.now();
  return Math.max(0, Math.min(
    SESSION_TTL - (now - s.createdAt),
    idleMs() - (now - s.lastSeen),
  ));
}

/* ------------------------------------------------------------ 防爆破 */

function clientKey(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  return String(fwd || (req.socket && req.socket.remoteAddress) || 'local').slice(0, 64);
}

function failState(req) {
  const key = clientKey(req);
  const st = failures.get(key);
  if (!st || Date.now() > st.until) return { count: 0, until: 0 };
  return st;
}

function noteFailure(req) {
  const key = clientKey(req);
  let st = failState(req);
  st.count += 1;
  st.until = Date.now() + (st.count >= MAX_FAIL ? FAIL_WINDOW : Math.min(8000, 250 * st.count));
  failures.set(key, st);
  return st;
}

function clearFailure(req) { failures.delete(clientKey(req)); }

function throttled(req, res) {
  const st = failState(req);
  if (st.count < MAX_FAIL || Date.now() > st.until) return false;
  sendError(res, 429, '密码错太多次了，请稍后再试。', { retryAfter: Math.ceil((st.until - Date.now()) / 1000) });
  return true;
}

/* ------------------------------------------------------------ 接口 */

/** 只检查不续期：前端定时轮询用它判断是否该自动盖屏 */
function check(req, res) {
  load();
  return sendJson(res, 200, {
    ok: true,
    configured: !!account,
    authenticated: !!account && isAuthed(req, false),
  });
}

function status(req, res, url) {
  const configured = !!account;
  const authed = configured && isAuthed(req);
  return sendJson(res, 200, {
    ok: true,
    configured,
    authenticated: authed,
    username: authed ? account.username : null,
    autoLockMinutes: authed ? account.autoLockMinutes : null,
    remainingMs: authed ? remainingMs(req) : 0,
  });
}

async function register(req, res, url) {
  if (account) return sendError(res, 409, '已经注册过了，直接登录即可。', { configured: true });
  let body;
  try { body = await readBody(req); } catch (err) { return sendError(res, 400, err.message); }
  const nameErr = validUsername(body.username);
  if (nameErr) return sendError(res, 400, nameErr);
  const pwErr = validPassword(body.password);
  if (pwErr) return sendError(res, 400, pwErr);
  if (body.password !== body.confirm) return sendError(res, 400, '两次输入的密码不一样');

  const primary = makeSecret(body.password, null);
  const recoveryCode = newRecoveryCode();
  const recovery = makeSecret(normalizeCode(recoveryCode), null);
  account = {
    username: String(body.username).trim(),
    salt: primary.salt,
    hash: primary.hash,
    recoverySalt: recovery.salt,
    recoveryHash: recovery.hash,
    createdAt: Date.now(),
    autoLockMinutes: DEFAULT_IDLE_MIN,
  };
  if (!save()) {
    account = null;
    return sendError(res, 500, '账户没能写入磁盘，请检查 data 目录权限后重试。');
  }
  clearFailure(req);
  createSession(req, res);
  return sendJson(res, 200, { ok: true, username: account.username, recoveryCode });
}

async function login(req, res, url) {
  if (!account) return sendError(res, 409, '还没有注册账户。', { configured: false });
  if (throttled(req, res)) return;
  let body;
  try { body = await readBody(req); } catch (err) { return sendError(res, 400, err.message); }
  const name = String(body.username || '').trim();
  const okName = name === account.username;
  const okPw = equalHex(hashSecret(String(body.password || ''), Buffer.from(account.salt, 'hex')), account.hash);
  if (!okName || !okPw) {
    const st = noteFailure(req);
    const left = Math.max(0, MAX_FAIL - st.count);
    return sendError(res, 401, left > 0 ? `账户或密码不对，还可以试 ${left} 次` : '错太多次了，请稍后再试', { left });
  }
  clearFailure(req);
  createSession(req, res);
  return sendJson(res, 200, { ok: true, username: account.username, autoLockMinutes: account.autoLockMinutes });
}

async function reset(req, res, url) {
  if (!account) return sendError(res, 409, '还没有注册账户。', { configured: false });
  if (throttled(req, res)) return;
  let body;
  try { body = await readBody(req); } catch (err) { return sendError(res, 400, err.message); }
  const code = normalizeCode(body.recoveryCode);
  const okCode = equalHex(hashSecret(code, Buffer.from(account.recoverySalt, 'hex')), account.recoveryHash);
  if (!okCode) {
    const st = noteFailure(req);
    return sendError(res, 401, `恢复码不对，还可以试 ${Math.max(0, MAX_FAIL - st.count)} 次`);
  }
  const pwErr = validPassword(body.newPassword);
  if (pwErr) return sendError(res, 400, pwErr);
  const primary = makeSecret(body.newPassword, null);
  const recoveryCode = newRecoveryCode();
  const recovery = makeSecret(normalizeCode(recoveryCode), null);
  account.salt = primary.salt;
  account.hash = primary.hash;
  account.recoverySalt = recovery.salt;
  account.recoveryHash = recovery.hash;
  if (!save()) return sendError(res, 500, '写入失败，密码没有修改。');
  clearFailure(req);
  sessions.clear();                    // 改密码后踢掉所有旧会话
  createSession(req, res);
  return sendJson(res, 200, { ok: true, username: account.username, recoveryCode });
}

async function changePassword(req, res, url) {
  if (!isAuthed(req)) return sendError(res, 401, '会话已失效，请重新登录。', { authRequired: true });
  if (throttled(req, res)) return;
  let body;
  try { body = await readBody(req); } catch (err) { return sendError(res, 400, err.message); }
  const okOld = equalHex(hashSecret(String(body.oldPassword || ''), Buffer.from(account.salt, 'hex')), account.hash);
  if (!okOld) { noteFailure(req); return sendError(res, 401, '当前密码不对'); }
  const pwErr = validPassword(body.newPassword);
  if (pwErr) return sendError(res, 400, pwErr);
  if (body.newPassword === body.oldPassword) return sendError(res, 400, '新密码和旧密码一样');
  const primary = makeSecret(body.newPassword, null);
  account.salt = primary.salt;
  account.hash = primary.hash;
  if (!save()) return sendError(res, 500, '写入失败，密码没有修改。');
  clearFailure(req);
  const keep = cookieValue(req);
  const mine = keep && sessions.get(keep);
  sessions.clear();
  if (mine) sessions.set(keep, mine);   // 只保留当前会话
  return sendJson(res, 200, { ok: true });
}

async function regenerateRecovery(req, res, url) {
  if (!isAuthed(req)) return sendError(res, 401, '会话已失效，请重新登录。', { authRequired: true });
  let body;
  try { body = await readBody(req); } catch (err) { return sendError(res, 400, err.message); }
  const okPw = equalHex(hashSecret(String(body.password || ''), Buffer.from(account.salt, 'hex')), account.hash);
  if (!okPw) return sendError(res, 401, '密码不对，恢复码没有更换');
  const recoveryCode = newRecoveryCode();
  const recovery = makeSecret(normalizeCode(recoveryCode), null);
  account.recoverySalt = recovery.salt;
  account.recoveryHash = recovery.hash;
  if (!save()) return sendError(res, 500, '写入失败，恢复码没有更换。');
  return sendJson(res, 200, { ok: true, recoveryCode });
}

async function setAutoLock(req, res, url) {
  if (!isAuthed(req)) return sendError(res, 401, '会话已失效，请重新登录。', { authRequired: true });
  let body;
  try { body = await readBody(req); } catch (err) { return sendError(res, 400, err.message); }
  const n = Number(body.minutes);
  if (!Number.isFinite(n) || n < MIN_IDLE_MIN || n > MAX_IDLE_MIN) {
    return sendError(res, 400, `请在 ${MIN_IDLE_MIN}–${MAX_IDLE_MIN} 分钟之间选择`);
  }
  account.autoLockMinutes = n;
  if (!save()) return sendError(res, 500, '写入失败，设置没有保存。');
  return sendJson(res, 200, { ok: true, autoLockMinutes: n });
}

function logout(req, res) {
  dropSession(req, res, false);
  return sendJson(res, 200, { ok: true });
}

function lock(req, res) {
  dropSession(req, res, true);
  return sendJson(res, 200, { ok: true });
}

function ping(req, res) {
  if (!isAuthed(req)) return sendError(res, 401, '会话已失效，请重新登录。', { authRequired: true });
  return sendJson(res, 200, { ok: true, remainingMs: remainingMs(req) });
}

/** 统一分发：只有 /api/auth/* 会走到这里 */
async function handle(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method || 'GET';
  load();
  const route = p.replace(/^\/api\/auth/, '') || '/';

  if (method === 'GET' && route === '/status') return status(req, res, url);
  if (method === 'GET' && route === '/check') return check(req, res);
  if (method === 'POST' && route === '/register') return register(req, res, url);
  if (method === 'POST' && route === '/login') return login(req, res, url);
  if (method === 'POST' && route === '/reset') return reset(req, res, url);
  if (method === 'POST' && route === '/logout') return logout(req, res);
  if (method === 'POST' && route === '/lock') return lock(req, res);
  if (method === 'POST' && route === '/password') return changePassword(req, res, url);
  if (method === 'POST' && route === '/recovery') return regenerateRecovery(req, res, url);
  if (method === 'POST' && route === '/autolock') return setAutoLock(req, res, url);
  if (method === 'POST' && route === '/ping') return ping(req, res);
  return sendError(res, 404, '没有这个账户接口');
}

/** 供 index.js 在健康接口里回传， splash 据此决定去登录页还是工作台 */
function publicStatus(req) {
  load();
  return {
    configured: !!account,
    authenticated: !!account && isAuthed(req, false),
  };
}

module.exports = {
  handle,
  isAuthed,
  publicStatus,
  load,
  get configured() { load(); return !!account; },
};
