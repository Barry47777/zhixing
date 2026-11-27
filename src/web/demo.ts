/** 浏览器版首次运行的演示数据（与桌面版保持一致的虚构内容） */

interface DemoDeps {
  db: any;
  uid: (p: string) => string;
  normalizeProject: (raw: any, now?: number) => any;
  normalizeEntry: (raw: any, now?: number, defaults?: any) => any;
  normalizeDayLog: (raw: any, now?: number) => any;
  normalizeTemplate: (raw: any, now?: number) => any;
  normalizeNote: (raw: any, now?: number, seq?: number) => any;
}

const DAY = 86400000;
const dayKey = (offset: number) => {
  const d = new Date(Date.now() - offset * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function seedDemo(deps: DemoDeps): boolean {
  const { db, uid, normalizeProject, normalizeEntry, normalizeDayLog, normalizeTemplate, normalizeNote } = deps;
  if (db.notes.length || db.entries.length || db.projects.length) return false;
  const now = Date.now();
  const random = rng(20260101);

  const projects = [
    { name: '品牌官网改版', color: '#5b8def', status: 'active', weeklyGoalHours: 10 },
    { name: '客户提案系统', color: '#e8834a', status: 'active', weeklyGoalHours: 6 },
    { name: '设计系统文档', color: '#7bc47f', status: 'active', weeklyGoalHours: 4 },
    { name: '个人成长', color: '#a98be8', status: 'active', weeklyGoalHours: 3 },
    { name: '待整理', color: '#8b93a7', status: 'active', weeklyGoalHours: 0 },
  ].map((p, i) => {
    const x = normalizeProject({ ...p, order: i }, now);
    x.id = uid('p');
    return x;
  });

  const titles = [
    '梳理首页信息层级', '和客户确认提案边界', '补齐组件状态', '复盘上周决策',
    '写设计说明第一段', '整理参考资料', '画首页线框', '验证交互细节',
    '清理待办列表', '读完一章书', '做一次周计划', '整理文件夹',
  ];
  const entries: any[] = [];
  for (let i = 0; i < 46; i++) {
    const offset = Math.floor(i / 2);
    const title = titles[i % titles.length];
    const minutes = [30, 60, 90, 120, 180][Math.floor(random() * 5)];
    const status = random() > 0.18 ? 'done' : 'todo';
    const e = normalizeEntry({
      date: dayKey(offset),
      title,
      projectId: projects[Math.floor(random() * projects.length)].id,
      minutes,
      status,
      priority: Math.floor(random() * 3),
      tags: random() > 0.6 ? ['专注'] : [],
      note: random() > 0.75 ? '记下当时最关键的一个判断。' : '',
      createdAt: now - offset * DAY,
    }, now);
    e.id = uid('e');
    entries.push(e);
  }

  const noteSeeds = [
    {
      zone: 'inspiration', type: 'insight',
      content: '<p>官网不必按「我们是谁 / 我们做什么 / 客户是谁」排。可以先给一个具体场景，让对方先认同问题，再解释我们怎么解决。</p>',
      tags: ['产品', '叙事'],
    },
    {
      zone: 'inspiration', type: 'idea',
      content: '<p>把每周的判断写下来，比记流水账更有复利。一周留一个下午不排会，专门做这件事。</p>',
      tags: ['方法'],
    },
    {
      zone: 'inspiration', type: 'strategy',
      content: '<p>提案讲太多过程，客户只会记住价格。过程放到附件里，正文只留判断、取舍和结果。</p>',
      tags: ['客户'],
    },
    {
      zone: 'review', type: 'review', stage: 'judgment',
      seen: '客户说首页信息太满，第一屏什么都想讲。',
      think: '先砍掉一半内容，只保留一个核心动作。',
      bet: { conf: 72, horizon: 'short', invalid: false },
      did: 'acted',
      result: { outcome: 'win', note: '客户反馈第一屏清楚多了。', at: now - 2 * DAY },
      tags: ['复盘'],
    },
    {
      zone: 'review', type: 'review', stage: 'trade',
      seen: '一个功能看起来很酷，但会拖慢首屏。',
      think: '先上线简化版，数据说话。',
      bet: { conf: 55, horizon: 'mid', invalid: false },
      did: 'skipped',
      skipReason: '时机不对，先解决主线。',
      tags: ['复盘', '取舍'],
    },
  ];
  const notes = noteSeeds.map((s, i) => {
    const n = normalizeNote(s, now, i + 1);
    n.id = uid('n');
    n.createdAt = now - (5 - i) * DAY;
    n.updatedAt = n.createdAt;
    return n;
  });

  const templates = [
    { name: '客户提案', title: '整理一份提案', projectId: projects[1].id, minutes: 120, tags: ['客户'], subtasks: ['确认三个必须做到的点', '确认哪些这次不做', '记下对方原话'] },
    { name: '深度设计', title: '关掉消息，画完首页那一段', projectId: projects[0].id, minutes: 180, tags: ['专注'], subtasks: ['先摆信息层级', '只做一版', '结束时写下仍不确定的地方'] },
  ].map((t, i) => {
    const x = normalizeTemplate(t, now);
    x.id = uid('t');
    x.createdAt = now - (10 - i * 3) * DAY;
    return x;
  });

  const days = [
    { date: dayKey(0), summary: '上午把首页叙事收成一版，下午只做验证，不加新东西。', updatedAt: now - 2 * 3600 * 1000 },
    { date: dayKey(1), summary: '提案系统砍掉两条路径。删的时候有点心疼，删完反而清楚了。', updatedAt: now - DAY },
  ].map((d) => normalizeDayLog(d, now));

  db.projects = projects;
  db.entries = entries;
  db.notes = notes;
  db.templates = templates;
  db.days = days;
  db.settings.welcomeDone = true;
  db.meta.demoAt = now;
  db.meta.nextSeq = notes.length + 1;
  return true;
}
