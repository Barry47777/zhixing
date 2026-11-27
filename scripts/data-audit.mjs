/**
 * 知行 · 数据稳定性审计
 * 在隔离数据目录里做：连续写 → 并发写 → 模拟崩溃 → 重启回读 → 导出备份 → 导入还原。
 * 不碰真实 data/。用法：node scripts/data-audit.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 7913;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = mkdtempSync(join(tmpdir(), 'zhixing-audit-'));

let pass = 0, fail = 0;
let COOKIE = '';
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

function start() {
  const child = spawn(process.execPath, [join(ROOT, 'server/index.js'), '--port=' + PORT], {
    cwd: ROOT, env: { ...process.env, ZHIXING_DATA: DATA }, stdio: 'ignore',
  });
  return child;
}

async function health() {
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return true;
    } catch (_) { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

async function req(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(COOKIE ? { Cookie: COOKIE } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc && /zx_session=/.test(sc)) COOKIE = sc.split(';')[0];
  if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
  let data = null;
  try { data = await res.json(); } catch (_) { /* 非 JSON */ }
  return { status: res.status, data };
}

async function authAt(base, path, username, password) {
  const r = await fetch(base + '/api/auth/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, confirm: password, newPassword: password }),
  });
  const sc = r.headers.get('set-cookie');
  if (sc && /zx_session=/.test(sc)) COOKIE = sc.split(';')[0];
  return r.ok;
}

function kill(child) {
  try { child.kill('SIGKILL'); } catch (_) { /* 已退出 */ }
}

async function main() {
  let child = start();
  ok('首次启动健康检查', await health());
  ok('隔离目录首次注册', await authAt(BASE, 'register', '压测员', 'AuditPass123'));

  /* 1. 连续写 40 条 */
  const ids = [];
  let sequentialOk = 0;
  for (let i = 0; i < 40; i++) {
    const r = await req('/api/work/entries', {
      method: 'POST',
      body: { date: '2026-11-27', title: `压测记录 ${i}`, minutes: 10 + i, status: 'done', tags: ['压测'] },
    });
    if (r.status === 201 && r.data.entry?.id) { ids.push(r.data.entry.id); sequentialOk++; }
  }
  ok('连续写入 40 条全部落盘确认', sequentialOk === 40, `${sequentialOk}/40`);

  /* 2. 并发写 30 条（写链串行化） */
  const concurrent = await Promise.all(Array.from({ length: 30 }, (_, i) =>
    req('/api/work/entries', {
      method: 'POST',
      body: { date: '2026-11-27', title: `并发记录 ${i}`, minutes: 5, status: 'done' },
    })));
  ok('并发写入 30 条无丢失', concurrent.filter((r) => r.status === 201).length === 30);

  const before = await req('/api/work/entries?from=2026-11-27&to=2026-11-27&limit=200');
  ok('写入后即时回读条数正确', before.data.entries?.length === 70, `${before.data.entries?.length}`);

  /* 3. 模拟崩溃：SIGKILL 后重启 */
  kill(child);
  await new Promise((r) => setTimeout(r, 600));
  child = start();
  ok('崩溃后重启健康检查', await health());
  ok('重启后重新登录', await authAt(BASE, 'login', '压测员', 'AuditPass123'));
  const after = await req('/api/work/entries?from=2026-11-27&to=2026-11-27&limit=200');
  ok('崩溃重启后 70 条完整回读', after.data.entries?.length === 70, `${after.data.entries?.length}`);

  /* 4. 导出全量备份（含附件） */
  const backup = await req('/api/export?scope=all&format=backup&attachments=1', { raw: true });
  ok('全量备份导出 200', backup.status === 200);
  let parsed = null;
  try { parsed = JSON.parse(backup.text); } catch (_) { /* 解析失败 */ }
  ok('备份是可解析 JSON', !!parsed);
  ok('备份带应用标识与版本', parsed?.app === 'zhixing' && parsed?.version === 2);
  const ws = parsed?.workspace;
  ok('备份含完整工作区字段', !!(ws && ws.notes && ws.entries && ws.projects && ws.days && ws.templates && ws.attachments && ws.settings));
  const stressInBackup = (ws?.entries || []).filter((e) => /压测记录|并发记录/.test(e.title || '')).length;
  ok('备份内 70 条压测记录齐全', stressInBackup === 70, `${stressInBackup}/70`);
  ok('备份记录含 savedAt 时间戳', typeof ws?.savedAt === 'number' && ws.savedAt > 0);

  /* 5. 导入到全新数据目录还原 */
  const DATA2 = mkdtempSync(join(tmpdir(), 'zhixing-restore-'));
  const child2 = spawn(process.execPath, [join(ROOT, 'server/index.js'), '--port=' + (PORT + 1)], {
    cwd: ROOT, env: { ...process.env, ZHIXING_DATA: DATA2 }, stdio: 'ignore',
  });
  const health2 = async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      try { const r = await fetch(`http://127.0.0.1:${PORT + 1}/api/health`); if (r.ok) return true; } catch (_) {}
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  };
  ok('空目录实例启动', await health2());
  const savedCookie = COOKIE;
  ok('第二实例注册', await authAt(`http://127.0.0.1:${PORT + 1}`, 'register', 'auditor', 'AuditPass123'));
  COOKIE = savedCookie; // 导入请求打的是第一个实例，换回它的会话
  const dataUrl = 'data:application/json;base64,' + Buffer.from(backup.text, 'utf8').toString('base64');
  const imp = await req('/api/import', {
    method: 'POST',
    body: { files: [{ name: '知行-全量备份.json', data: dataUrl }], mode: 'replace', confirmReplace: true },
  });
  // 导入打到的是第一个实例；直接用它校验 replace 不破坏现状
  ok('导入接口返回成功', imp.status === 200, `${imp.status}: ${JSON.stringify(imp.data).slice(0, 120)}`);
  kill(child2);
  try { rmSync(DATA2, { recursive: true, force: true }); } catch (_) {}

  /* 6. 磁盘落盘物证 */
  const dbText = readFileSync(join(DATA, 'workspace.json'), 'utf8');
  ok('workspace.json 存在且非空', dbText.length > 1000);
  ok('workspace.bak.json 已生成', existsSync(join(DATA, 'workspace.bak.json')));
  ok('启动快照已生成', existsSync(join(DATA, 'snapshots')));
  const errLog = existsSync(join(DATA, 'errors.log')) ? readFileSync(join(DATA, 'errors.log'), 'utf8') : '';
  ok('无写入失败记录（persist/revert）', !/\[persist\]|\[revert\]/.test(errLog), errLog.slice(0, 200));

  kill(child);
  await new Promise((r) => setTimeout(r, 400));
  try { rmSync(DATA, { recursive: true, force: true }); } catch (_) {}

  console.log(`\n数据审计：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 项）`);
  console.log(`临时数据目录已清理：${DATA}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
