/**
 * 首次运行演示数据。
 *
 * 只在工作区完全为空时播一次：5 个项目、过去 40 天的一批记录、
 * 几条灵感与复盘、2 个模板、2 天总结。和原 Studio Log 一样，
 * 设置页提供「清空演示数据」，首屏不会是一片空白。
 */

'use strict';

const W = require('./models/work');
const N = require('./models/notes');

const DAY = 86400000;

function dayKey(offset) {
  const d = new Date(Date.now() - offset * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 固定种子，保证每次演示数据一致，方便截图与验收。 */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PROJECTS = [
  {
    name: '品牌官网改版',
    color: '#3be0c6',
    status: 'active',
    note: '把首页从信息堆改成一条叙事线，先讲清楚我们替谁解决什么问题。',
    weeklyGoalHours: 12,
    progress: 64,
    startOffset: -34,
    dueOffset: 9,
  },
  {
    name: '客户提案系统',
    color: '#62b6ff',
    status: 'active',
    note: '提案模板、报价计算、版本对比，先做内部能用的最小闭环。',
    weeklyGoalHours: 10,
    progress: 38,
    startOffset: -22,
    dueOffset: 24,
  },
  {
    name: '设计系统文档',
    color: '#9ada6a',
    status: 'active',
    note: '把散落在 Figma 与口头约定里的规则写成可检索的文档。',
    weeklyGoalHours: 4,
    progress: 17,
    startOffset: -48,
    dueOffset: 40,
  },
  {
    name: '内容与运营',
    color: '#f2b45c',
    status: 'active',
    note: '每周两篇，记录真实项目里的判断，而不是泛泛的方法论。',
    weeklyGoalHours: 6,
    progress: 45,
    startOffset: -60,
    dueOffset: -2,
  },
  {
    name: '内部事务',
    color: '#a9b8c6',
    status: 'paused',
    note: '合同、报销、设备，能一次做完就不拖第二次。',
    weeklyGoalHours: 2,
    progress: 12,
    startOffset: -12,
    dueOffset: 60,
  },
];

const TITLES = {
  '品牌官网改版': [
    '重写首页首屏文案，删掉三句形容词',
    '把案例页的信息层级压到两层',
    '和摄影确认首页主图的拍摄清单',
    '做了两版导航结构，选了更安静的那版',
    '清理旧站遗留的 42 个页面',
    '给客户过一遍改版后的叙事线',
    '调首页动效节奏，去掉多余的视差',
  ],
  '客户提案系统': [
    '整理近半年的提案，找出重复段落',
    '把报价计算拆成可配置的模块',
    '做提案版本对比的第一版原型',
    '和销售确认三个必须保留的字段',
    '修掉导出 PDF 时分页错位的问题',
    '给提案模板加上项目类型预设',
  ],
  '设计系统文档': [
    '补齐按钮的四种状态与禁用规则',
    '把颜色令牌整理成一页可复制的表',
    '写表单校验的错误文案规范',
    '录了一段 6 分钟的组件使用演示',
    '和前端对齐间距令牌的命名',
  ],
  '内容与运营': [
    '写完「改版前先删一半」的初稿',
    '整理本周选题，砍掉两个太大的',
    '回复读者关于报价的留言',
    '把旧文章里的失效链接修掉',
    '做了一版新的邮件订阅页',
  ],
  '内部事务': [
    '报销上个月的差旅',
    '续签云服务并核对账单',
    '整理合同归档目录',
    '预约下周的设备检修',
  ],
};

const NOTES = [
  {
    zone: 'inspiration',
    type: 'idea',
    think: '官网不必按「我们是谁 / 我们做什么 / 客户是谁」排。可以先给一个具体场景，让人在十秒内认出「这是在说我」。',
    tags: ['品牌', '叙事'],
  },
  {
    zone: 'inspiration',
    type: 'insight',
    think: '提案讲太多过程，客户只会记住价格。过程放到附件里，正文只留判断、取舍和结果。',
    tags: ['提案', '沟通'],
  },
  {
    zone: 'inspiration',
    type: 'idea',
    think: '设计系统文档最好按「我正在做什么」组织，而不是按组件字母序。人在做表单时不会想去查 Button。',
    tags: ['设计系统'],
  },
  {
    zone: 'inspiration',
    type: 'idea',
    think: '每周留一个下午不排会，只用来把这一周散落的判断写下来。不然到周五只剩下疲惫，没有结论。',
    tags: ['节奏'],
  },
  {
    zone: 'review',
    type: 'review',
    stage: 'judgment',
    did: 'acted',
    seen: '客户看完首页只说了一句「不够高级」，追问具体哪里，答不上来。',
    content:
      '<p>客户说首页「不够高级」。我没有直接改视觉，而是先问：你希望访客看完第一屏，记住哪一句话？对方沉默了很久，最后说「我们其实想让人知道我们只服务小团队」。</p><p>于是把首屏从「能力清单」改成一句明确的取舍，配一张真实工作场景的照片。</p>',
    think: '「不够高级」通常不是审美问题，是信息没有立场。',
    bet: { conf: 4, horizon: '1w', invalid: '如果客户看完仍然说不出我们替谁服务，就说明这句取舍还不够具体。' },
    result: { outcome: 'right', note: '上线一周后，咨询里主动提到「小团队」的比例明显上升。' },
    after: { text: '下次先让客户用自己的话写一句「我们希望被谁记住」，再动视觉。' },
    callRight: 'right',
    tags: ['品牌', '判断'],
  },
  {
    zone: 'review',
    type: 'review',
    stage: 'trade',
    did: 'acted',
    seen: '内部试用：六个人里五个每次都要先找按钮；提案模块三周里长出了五条路径。',
    content:
      '<p>把一个做了三周的提案模块砍掉，只保留最常用的两条路径。理由是内部试用时，六个人里有五个每次都要找按钮。</p>',
    think: '功能多不等于专业，路径短才是。',
    trade: { symbol: '提案系统', side: 'flat', pnl: 0, rating: 2, mistake: '做得太频繁' },
    bet: { conf: 3, horizon: '1w', invalid: '如果销售仍然要求按客户逐条改配置，说明砍错了。' },
    result: { outcome: 'unclear', note: '销售暂时没反对，但还没在实际提案里跑过。' },
    growth: 'up',
    tags: ['产品', '取舍'],
  },
  {
    zone: 'review',
    type: 'review',
    stage: 'judgment',
    did: 'skipped',
    seen: '同一周里三个同事来问「表单错误提示放在哪」；文档站只有组件名索引，没有按任务找的入口。',
    skipReason: '那周在赶官网，没时间开这个头。',
    content:
      '<p>想给文档站加一个「按任务找组件」的入口，而不是只按组件名索引。犹豫了一周没做，结果同事来问的问题还是那几类。</p>',
    think: '如果同一个问题被问三次，就该把它写进入口。',
    bet: { conf: 4, horizon: '1m', invalid: '如果同事仍然从搜索框直接找组件名，说明任务入口不是他们的习惯。' },
    after: { text: '先做一个最小版本：三个任务场景，各放五个组件，看看有没有人用。' },
    tags: ['设计系统', '待办'],
  },
];

function seedIfEmpty(store) {
  if (process.env.ZHIXING_NO_DEMO === '1') return false;
  const db = store.db;
  if (!db) return false;
  if (db.entries.length || db.notes.length || db.projects.length) return false;
  if (db.meta.demoAt) return false;

  const rand = rng(20261126);
  const now = Date.now();

  const projects = PROJECTS.map((p, i) => {
    const proj = W.normalizeProject({
      name: p.name,
      color: p.color,
      status: p.status,
      note: p.note,
      weeklyGoalHours: p.weeklyGoalHours,
      progress: p.progress,
      startDate: p.startOffset == null ? null : dayKey(-p.startOffset),
      dueDate: p.dueOffset == null ? null : dayKey(-p.dueOffset),
      order: i,
    });
    proj.id = W.uid('p');
    proj.createdAt = now - (60 - i * 3) * DAY;
    proj.updatedAt = now - i * DAY;
    return proj;
  });

  const entries = [];
  const titles = {};
  for (const p of projects) titles[p.name] = TITLES[p.name] || [];

  for (let offset = 44; offset >= 0; offset -= 1) {
    const d = new Date(now - offset * DAY);
    const weekday = d.getDay();
    const weekend = weekday === 0 || weekday === 6;
    if (weekend && rand() > 0.24) continue;
    if (!weekend && rand() > 0.82) continue;

    const count = weekend ? 1 : 1 + Math.floor(rand() * 2.4);
    for (let k = 0; k < count; k += 1) {
      const project = projects[Math.floor(rand() * projects.length)];
      const pool = titles[project.name] || ['推进 ' + project.name];
      const title = pool[Math.floor(rand() * pool.length)];
      const minutes = [30, 45, 60, 90, 120, 150, 180][Math.floor(rand() * 7)];
      const roll = rand();
      const status = roll > 0.9 ? 'doing' : roll > 0.82 ? 'blocked' : 'done';
      const createdAt = now - offset * DAY + (9 * 3600 + Math.floor(rand() * 9 * 3600)) * 1000;
      const entry = W.normalizeEntry({
        date: dayKey(offset),
        title,
        projectId: project.id,
        minutes,
        status,
        priority: rand() > 0.86 ? 2 : rand() > 0.62 ? 1 : 0,
        tags: rand() > 0.72 ? [['修改', '沟通', '资料', '评审', '线上'][Math.floor(rand() * 5)]] : [],
        note: rand() > 0.8 ? ['先做能验证的最小版本。', '中途被会议打断，下午重新捡起来。', '比预想多花了一倍时间。'][Math.floor(rand() * 3)] : '',
        subtasks: [],
      });
      entry.id = W.uid('e');
      entry.createdAt = createdAt;
      entry.updatedAt = createdAt + Math.floor(rand() * 3 * 3600) * 1000;
      entries.push(entry);
      if (entries.length > 300) break;
    }
  }
  entries.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const notes = NOTES.map((n, i) => {
    const base = {
      zone: n.zone,
      type: n.type,
      content: n.content,
      seen: n.seen,
      think: n.think,
      stage: n.stage,
      did: n.did,
      skipReason: n.skipReason,
      bet: n.bet,
      trade: n.trade,
      result: n.result,
      after: n.after,
      callRight: n.callRight,
      growth: n.growth,
      tags: n.tags,
      triage: 'filed',
    };
    const at = now - (1 + i) * DAY;
    const note = N.normalizeNote(base, at);
    note.seq = i + 1;
    note.createdAt = now - (2 + i * 5) * DAY;
    return note;
  });

  const templates = [
    W.normalizeTemplate({
      name: '客户会议',
      title: '和客户过一遍本次需求的取舍',
      projectId: projects[0].id,
      minutes: 60,
      tags: ['沟通'],
      subtasks: ['确认三个必须做到的点', '确认哪些这次不做', '记下对方原话'],
    }),
    W.normalizeTemplate({
      name: '深度设计',
      title: '关掉消息，画完首页那一段',
      projectId: projects[0].id,
      minutes: 180,
      tags: ['专注'],
      subtasks: ['先摆信息层级', '只做一版', '结束时写下仍不确定的地方'],
    }),
  ];
  templates.forEach((t, i) => {
    t.id = W.uid('t');
    t.createdAt = now - (10 - i * 3) * DAY;
    t.updatedAt = t.createdAt;
  });

  const days = [
    { date: dayKey(0), summary: '上午把首页叙事收成一版，下午只做验证，不加新东西。', updatedAt: now - 2 * 3600 * 1000 },
    { date: dayKey(1), summary: '提案系统砍掉两条路径。删的时候有点心疼，删完反而清楚了。', updatedAt: now - DAY },
  ].map((d) => W.normalizeDayLog(d));

  db.projects = projects;
  db.entries = entries;
  db.notes = notes;
  db.templates = templates;
  db.days = days;
  db.settings = W.normalizeSettings(Object.assign({}, db.settings, { welcomeDone: true }));
  db.meta.demoAt = now;
  db.meta.clearedAt = 0;
  db.meta.nextSeq = notes.length + 1;
  return true;
}

module.exports = { seedIfEmpty };