/**
 * 知行 · 验收脚本
 * 自起一个隔离数据的服务端（临时目录 + 7910 端口），跑一遍核心契约，再全部清理。
 * 用法：node scripts/acceptance.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 7910;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = mkdtempSync(join(tmpdir(), 'zhixing-accept-'));

let passed = 0;
let failed = 0;
const results = [];
function requiresPlain(pw) {
  try {
    const file = join(DATA, 'account.json');
    return existsSync(file) && readFileSync(file, 'utf8').includes(pw);
  } catch (_) { return false; }
}
let COOKIE = '';

function ok(name, cond, extra = '') {
  if (cond) { passed += 1; results.push(`  ✓ ${name}`); }
  else { failed += 1; results.push(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
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
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON */ }
  return { status: res.status, data, res };
}

function waitHealth(timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(`${BASE}/api/health`);
        if (r.ok) return resolve(await r.json());
      } catch { /* 还没起来 */ }
      if (Date.now() - start > timeoutMs) return reject(new Error('服务端没有在预期时间内启动'));
      setTimeout(tick, 250);
    };
    tick();
  });
}

const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js'), '--port=' + PORT], {
  cwd: ROOT,
  env: { ...process.env, ZHIXING_DATA: DATA, ZHIXING_NO_DEMO: '1' },
  stdio: 'ignore',
});
let serverLog = '';

const NOTE_IDS = [];
const ENTRY_IDS = [];
const PROJECT_IDS = [];

try {
  const health = await waitHealth();
  ok('健康检查 app=zhixing', health.ok === true && health.app === 'zhixing');
  ok('健康检查带账户状态', typeof health.configured === 'boolean');
  ok('初始未配置账户', health.configured === false && health.authenticated === false);

  /* 首次注册：拿到会话 cookie，之后所有请求都带着它 */
  const reg = await req('/api/auth/register', {
    method: 'POST', body: { username: 'tester', password: 'Test12345', confirm: 'Test12345' },
  });
  ok('首次注册成功并下发会话', reg.status === 200 && reg.data.ok === true && !!reg.data.recoveryCode);
  ok('账户文件不存明文密码', !requiresPlain('Test12345'));

  /* 枚举 */
  const enums = (await req('/api/enums')).data;
  ok('枚举：两个分区', Array.isArray(enums.zones) && enums.zones.length === 2);
  ok('枚举：十项错误归因', enums.mistakes?.length === 10, String(enums.mistakes?.length));
  ok('枚举：7 个强调色', enums.accents?.length === 7);
  ok('枚举：标签上限 8', enums.tagsMax === 8);

  /* 设置 */
  const st0 = (await req('/api/settings')).data;
  ok('设置：默认深色', st0.settings?.theme === 'dark', st0.settings?.theme);
  const st1 = (await req('/api/settings', { method: 'PUT', body: { dailyGoalHours: 7, accent: 'coral' } })).data;
  ok('设置：更新每日目标', st1.settings?.dailyGoalHours === 7);
  ok('设置：更新强调色', st1.settings?.accent === 'coral');
  await req('/api/settings', { method: 'PUT', body: { dailyGoalHours: 6, accent: 'teal' } });

  /* 笔记：硬门 */
  const empty = await req('/api/notes', { method: 'POST', body: { zone: 'inspiration', type: 'idea' } });
  ok('笔记：空内容 400', empty.status === 400, String(empty.status));

  const idea = await req('/api/notes', { method: 'POST', body: { zone: 'inspiration', type: 'idea', think: '验收用的灵感：先写下再归类', tags: ['验收'], triage: 'inbox' } });
  ok('笔记：创建灵感', idea.status === 201 && idea.data.note?.seq > 0);
  const ideaId = idea.data.note.id; NOTE_IDS.push(ideaId);
  ok('笔记：灵感 seq 从 1 起', idea.data.note.seq === 1, String(idea.data.note.seq));

  const cm = await req(`/api/notes/${ideaId}/comments`, { method: 'POST', body: { text: '第一条留言' } });
  ok('留言：新增返回 comment', cm.status === 201 && cm.data.comment?.text === '第一条留言');
  const cmEmpty = await req(`/api/notes/${ideaId}/comments`, { method: 'POST', body: { text: '  ' } });
  ok('留言：空内容 400', cmEmpty.status === 400);

  const patched = await req(`/api/notes/${ideaId}`, { method: 'PATCH', body: { triage: 'filed', pinned: true } });
  ok('笔记：归档 + 置顶', patched.data.note?.triage === 'filed' && patched.data.note?.pinned === true);

  const list = await req('/api/notes?zone=inspiration&tag=验收');
  ok('笔记：按标签筛选', list.data.notes?.length === 1);
  ok('笔记：灵感区不下发复盘字段', list.data.notes?.[0] && !('bet' in list.data.notes[0]) && !('trade' in list.data.notes[0]));

  const rev = await req('/api/notes', { method: 'POST', body: { zone: 'review', type: 'review', stage: 'judgment', content: '<p>验收用判断：先给结论再补理由</p>', bet: { conf: 3, invalid: '如果客户先问价格' }, tags: ['验收'] } });
  ok('笔记：创建复盘', rev.status === 201 && rev.data.note.stage === 'judgment');
  const revId = rev.data.note.id; NOTE_IDS.push(revId);

  const res1 = await req(`/api/notes/${revId}/result`, { method: 'POST', body: { outcome: 'right', note: '验收：结果对' } });
  ok('复盘：结结果冻结', res1.data.note?.frozen === true && res1.data.note?.result?.outcome === 'right');
  const res2 = await req(`/api/notes/${revId}/result`, { method: 'POST', body: { outcome: 'wrong' } });
  ok('复盘：重复结 409', res2.status === 409);
  const frozen = await req(`/api/notes/${revId}`, { method: 'PATCH', body: { content: '<p>偷偷改正文</p>' } });
  ok('复盘：冻结后改正文 409', frozen.status === 409);
  const revised = await req(`/api/notes/${revId}`, { method: 'PATCH', body: { content: '<p>带理由地改正文</p>', revision: { reason: '验收：补充信息' } } });
  ok('复盘：带理由可修订', revised.status === 200 && revised.data.note?.revisions?.length === 1);

  const after = await req(`/api/notes/${revId}/after`, { method: 'POST', body: { text: '验收：事后想想' } });
  ok('复盘：事后想想独立保存', after.data.note?.after?.text === '验收：事后想想');

  /* 工作 */
  const proj = await req('/api/work/projects', { method: 'POST', body: { name: '验收项目', color: '#5B7CFA', weeklyGoalHours: 8 } });
  ok('项目：创建', proj.status === 201 && proj.data.project?.id);
  const projId = proj.data.project.id; PROJECT_IDS.push(projId);

  const entry = await req('/api/work/entries', { method: 'POST', body: { date: '2026-11-20', title: '验收记录：写一段', minutes: 90, projectId: projId, status: 'done', priority: 1, tags: ['验收'] } });
  ok('记录：创建折算小时', entry.status === 201 && entry.data.entry?.hours === 1.5, String(entry.data.entry?.hours));
  const entryId = entry.data.entry.id; ENTRY_IDS.push(entryId);

  const summary = await req('/api/work/days/2026-11-20', { method: 'PUT', body: { summary: '验收：今天的总结' } });
  ok('记录：当日总结', summary.status === 200);
  const day = await req('/api/work/days?from=2026-11-20&to=2026-11-20');
  ok('记录：按日汇总回读总结', day.data.days?.[0]?.date === '2026-11-20' && day.data.days?.[0]?.summary?.includes('验收'));

  const stats = await req('/api/stats/work?from=2026-11-01&to=2026-11-30');
  ok('统计：总小时', stats.data.totalHours >= 1.5, String(stats.data.totalHours));
  ok('统计：项目占比含未分类以外的项', Array.isArray(stats.data.byProject) && stats.data.byProject.some((p) => p.id === projId));

  const ov = await req('/api/overview?date=2026-11-20');
  ok('总览：今日条目', ov.data.today?.entryCount >= 1);
  ok('总览：周节奏 7 天', Array.isArray(ov.data.week?.daily) && ov.data.week.daily.length === 7);

  /* 搜索 */
  const search = await req('/api/search?q=' + encodeURIComponent('验收'));
  ok('搜索：命中笔记与记录', (search.data.notes?.length || 0) + (search.data.entries?.length || 0) >= 2);

  /* 导出 */
  const ex1 = await req('/api/export?scope=notes&format=md', { raw: true });
  ok('导出：笔记 Markdown 200', ex1.status === 200 && (ex1.headers.get('content-type') || '').includes('text/markdown'));
  const ex2 = await req('/api/export?scope=all&format=backup', { raw: true });
  ok('导出：整站备份 200', ex2.status === 200);

  /* 导入 dryRun */
  const md = Buffer.from('# 导入测试\n\n这是一段导入的正文。\n', 'utf8').toString('base64');
  const imp = await req('/api/import', { method: 'POST', body: { files: [{ name: 'import-test.md', data: `data:text/markdown;base64,${md}` }], mode: 'merge', dryRun: true } });
  ok('导入：dryRun 解析', imp.data.parsed === 1 && imp.data.addable === 1);

  /* 快照 */
  const snap = await req('/api/snapshots', { method: 'POST', body: { reason: '验收' } });
  ok('快照：创建', snap.status === 200 || snap.status === 201);
  const snaps = await req('/api/snapshots');
  ok('快照：列表', snaps.data.snapshots?.length >= 1);
  const snapName = snaps.data.snapshots[0]?.name;

  const storage = await req('/api/storage');
  ok('存储：返回占用与磁盘', typeof storage.data.bytes === 'number' && 'diskFree' in storage.data);

  const mig = await req('/api/migrate/inspect');
  ok('迁移：检查接口可用', mig.data && 'inspiration' in mig.data);

  const nf = await req('/api/nope');
  ok('未知接口 404', nf.status === 404);

  /* 清理 */
  await req(`/api/notes/${ideaId}`, { method: 'DELETE' });
  await req(`/api/notes/${revId}`, { method: 'DELETE' });
  await req(`/api/work/entries/${entryId}`, { method: 'DELETE' });
  await req(`/api/work/projects/${projId}?transferTo=null`, { method: 'DELETE' });
  if (snapName) await req(`/api/snapshots/${encodeURIComponent(snapName)}`, { method: 'DELETE' });
  const afterDelete = await req('/api/notes?zone=inspiration');
  ok('清理：验收笔记已删除', (afterDelete.data.notes || []).every((n) => n.id !== ideaId));
} catch (err) {
  failed += 1;
  results.push(`  ✗ 运行异常 — ${err?.message || err}`);
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 300));
  try { rmSync(DATA, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('\n知行 · 验收结果\n');
console.log(results.join('\n'));
console.log(`\n${passed} 通过 / ${failed} 失败（共 ${passed + failed} 项）`);
if (failed) {
  console.log('\n—— 服务端日志 ——\n' + serverLog.slice(-3000));
  process.exit(1);
}
