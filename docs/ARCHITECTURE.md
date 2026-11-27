# 知行 · 架构

> 一个本地优先的个人工作台：把「工作记录」与「思考复盘」放进同一个数据源、同一张桌面。

## 1. 定位

- **名字**：知行 / ZHIXING
- **副题**：工作与思考，同一张桌面
- **形态**：单用户、本地运行、单进程 Node 服务 + 浏览器前端；零账号、零云端、零遥测。
- **两种旧程序的关系**：
  - `inspiration`（复盘 · Edge）：灵感速记 + 判断记录 + 结结果冻结 + 归因校准 + 引用 + 导出。
  - `studio-log-pro`（Studio Log）：日历式工作记录 + 项目 + 工时 + 附件 + 周报/月报 + 统计。
  - 新程序不是二选一，而是让「一条工作记录」与「一条思考/复盘」可以互相引用、互相跳转、共同统计。

## 2. 技术栈与目录

```
zhixing/
  server/                 Node 22，CommonJS，零运行时依赖
    index.js              启动、单实例锁、HTTP 分发、静态资源、媒体、SPA 回退
    config.js             路径/端口/限额/版本
    store.js              workspace.json 的加载、原子落盘、提交/回滚、快照、锁
    util.js               HTTP 与通用工具
    models/notes.js       笔记字段归一化、冻结/修订/引用、zone 序列化
    models/work.js        项目/记录/日总结/模板/附件/设置归一化
    routes/notes.js       笔记与留言 API
    routes/review.js      归因/盲卡/周回顾/尺子 API
    routes/work.js        项目/记录/日总结/模板/回收站 API
    routes/attachments.js 附件上传/读取/删除
    routes/stats.js       工作统计、今日总览、洞察聚合
    routes/search.js      全局搜索
    routes/transfer.js     导出/导入
    routes/migrate.js     旧数据迁移
    routes/system.js      健康检查、设置、快照、枚举、清理
    lib/                  移植自 inspiration 的零依赖库（richtext/docx/print/transfer/links/review/images/zip/constants）
  src/                    Vue 3 + Vite + TS 前端
    main.ts app.vue router.ts types.ts constants.ts
    styles/               tokens.css base.css motion.css
    ui/                   基础组件（Button/Icon/Card/Segmented/Modal/Drawer/Toast/Field/...）
    api/client.ts         类型化请求封装
    stores/               workspace / settings / ui / drafts
    views/                TodayView CalendarView ProjectsView IdeasView ReviewView InsightsView SettingsView
    components/           按视图拆分的组件
    utils/                日期/格式化/统计/markdown/引用/富文本
  shared/                 前后端共享的枚举与常量（JSON）
  scripts/                验收测试、演练数据、迁移脚本
  data/                   运行时生成：workspace.json / snapshots / media / backups
  docs/                   产品、设计、API、功能对照
  dist/                   构建产物
```

- 包管理：`package.json` 为 `"type": "commonjs"`，服务端 `.js` 全部 CommonJS；前端由 Vite 编译。
- 运行：`npm run build` → `node server/index.js`（默认 <http://127.0.0.1:7900>）。
- 开发：`node server/index.js --dev --port 7900` + `npm run dev`（Vite 7901，代理 /api 与 /media）。
- 端口固定 7900；被占用时打印占用进程提示，不静默换端口（数据地址必须稳定）。旧程序 7788/8899 不受影响。

## 3. 唯一数据源：workspace.json

```jsonc
{
  "version": 2,
  "nextSeq": 1,
  "notes": [...],          // 思考/复盘
  "projects": [...],
  "entries": [...],        // 工作记录
  "days": [...],           // 每日总结
  "templates": [...],
  "attachments": [...],    // 附件元数据，文件在 data/media/
  "settings": {...},
  "meta": { "createdAt": 0, "lastSnapshotAt": null, "seededAt": null, "clearedAt": null, "legacyImportedAt": null }
}
```

### 3.1 Note（沿用 inspiration 字段 + 两个连接字段）

`id`(uuid), `seq`, `zone`(inspiration|review), `type`(idea|insight|review|strategy), `stage`(idea|judgment|trade), `content`(消毒 HTML), `seen`, `think`, `bet`, `did`, `skipReason`, `trade`, `result`, `callRight`, `after`, `growth`, `growthAt`, `triage`, `derivedFrom`, `frozen`, `revisions`, `review`, `legacy`, `images`, `comments`, `tags`, `pinned`, `createdAt`, `updatedAt`，**新增**：

- `projectId: string|null` —— 这条思考属于/关联哪个项目。
- `entryId: string|null` —— 这条思考是从哪条工作记录长出来的（或反向关联）。

字段语义、冻结规则、修订规则全部沿用 inspiration：`result.outcome` 一旦写下即 `frozen=true`；此后改 `FROZEN_FIELDS` 必须带 `revision.reason`，旧值进 `revisions`（≤50）。灵感区接口不返回复盘字段（`toZoneNote`）。

### 3.2 Project

```ts
{ id, name, color, status: 'active'|'paused'|'archived',
  note, weeklyGoalHours, startDate: 'YYYY-MM-DD'|null, dueDate: string|null,
  progress: 0..100, order, createdAt, updatedAt, deletedAt: number|null }
```

### 3.3 Entry

```ts
{ id, date: 'YYYY-MM-DD', title, projectId: string|null, minutes: number,
  status: 'done'|'doing'|'blocked', priority: 0|1|2,
  tags: string[], note, subtasks: {id,text,done}[], attachmentIds: string[],
  createdAt, updatedAt, deletedAt: number|null }
```

工时以 `minutes` 为唯一真源；API 接受/返回 `hours` 计算值（客户端展示用）。

### 3.4 DayLog / Template / Attachment

```ts
DayLog     { date, summary, updatedAt }
Template   { id, name, title, projectId, minutes, tags: string[], subtasks: string[], useCount, createdAt, updatedAt }
Attachment { id, entryId, date, name, mime, size, kind: 'image'|'pdf'|'text'|'other',
             file: 'YYYY-MM/<hash>.<ext>', thumb: string|null, w?, h?,
             createdAt, deletedAt: number|null }
```

### 3.5 Settings

```ts
{ theme:'system'|'dark'|'light', accent:'teal'|'blue'|'emerald'|'amber'|'coral'|'rose'|'graphite',
  density:'cozy'|'compact', fontScale:number, weekStart:0|1, dailyGoalHours:number,
  defaultProjectId:string|null, defaultMinutes:number,
  reduceMotion:boolean, showWeekNumbers:boolean,
  snapshotHours:number, attachmentLimitMB:number, startView:string, welcomeDone:boolean }
```

前端另有本地布局偏好（墙的排列/筛选、排序、上次视图）存在 localStorage，不写服务端。

## 4. 存储安全协议（继承 inspiration）

- 目录：`data/workspace.json`、`data/workspace.bak.json`、`data/snapshots/`、`data/backups/`、`data/media/`、`data/errors.log`、`data/instance.lock`。
- 落盘顺序：复制当前文件到 `.bak` → 写 `.tmp.<pid>` → `fsync` → `rename` 原子替换；所有写串行（Promise 链）。
- 写失败：内存改动回滚（`commit(res, revert)`），返回 503 + 中文说明，`errors.log` 记录。
- 启动：读主文件；JSON 损坏自动回退 `.bak`；过滤非法/空记录；补齐 `nextSeq`；未知字段先留证到 `data/pre-upgrade/` 再丢弃，避免升级丢数据。
- 快照：每日首启 1 份（保留 5）；按设置间隔自动（保留 12）；手动可随时；恢复前自动再存一份。
- 单实例：`instance.lock` 记录 `{pid, port}`；已有存活实例则退出码 2 并打印旧地址；死锁自动回收。
- 只监听 `127.0.0.1`；静态/媒体路径防穿越；上传做大小/类型/文件名白名单；HTML 服务端白名单消毒。
- 附件：单文件 ≤40MB（可配总配额 200MB，仅作提醒不硬拦）、图片客户端压缩后上传（≤2MB）、每记录 ≤12 个；删除记录 30 天回收站，彻底删除时清文件。
- 备份导出：JSON 全量（可选附件 base64）；快照可单独下载；`data/backups/` 提供 zip 脚本（`npm run backup`）。

## 5. 融合点（相对两个旧程序的新价值）

1. **今日**：一个页面同时回答「今天做了什么 / 今天想了什么 / 今天该复盘什么 / 项目推进到哪」。
2. **双向关联**：记录 ↔ 思考。工作记录可一键「写一条复盘」带入项目；思考可挂到项目/记录上；卡片与抽屉互相显示关联且可跳转。
3. **统一日历**：月历同时显示工时、状态标记与当天笔记条数；点开某天抽屉可看记录 + 笔记 + 总结。
4. **统一统计**：Insights 一页合并工时/热力/项目占比/标签/胜率/校准/错误分布/成长，而不是两套互不相干的统计。
5. **统一搜索**：⌘K 一次搜索记录、灵感、复盘、项目、模板，回车直达并高亮。
6. **统一数据中心**：一个设置页管理两套数据的安全（快照、导出、导入、回收站、迁移、存储配额）。
7. **统一设计系统**：同一套暗/亮主题、强调色、密度、字号、动效与无障碍规则。
8. **学习闭环**：周回顾/盲卡/五待办/补全问答/四组尺子等 inspiration 深度功能保留，并可从工作记录直接发起。

## 6. 前端架构

- Vue 3 `<script setup>` + TS + hash 路由 + 手写 store（`reactive`），不引入 Pinia，保持轻。
- 数据流：`api/client.ts` → `stores/workspace.ts`（唯一真源）→ 视图组件。写操作成功后由 store 更新/重取，不做乐观 UI（除少量纯本地交互）。
- App Shell：左侧图标导航栏（可展开）、顶部命令栏（搜索/快速记录/主题）、主内容区、右侧抽屉层、全局 Toast/Confirm/Palette/Drawer。
- 页面：今日、日历、项目、灵感、复盘、洞察、设置；`#/...` hash 路由，刷新保持。
- 快捷键：`1-7` 切页、`N` 快速新建（当前上下文）、`T` 回今天、`/` 或 `⌘K` 搜索、`←/→` 日历翻月、`Esc` 逐层关闭。
- 无障碍：焦点环、skip link、`aria` 语义、≥44px 触控、对比度、`prefers-reduced-motion` 与设置里的减少动效双保险。

## 7. 迁移

- **inspiration**：服务端直接读 `../inspiration/data/notes.json` 与 `../inspiration/data/uploads/`；`POST /api/migrate/inspiration` 支持 dryRun 预览；保留 id/seq/时间/字段，图片复制进 `data/media/`，数据不动旧目录。
- **studio-log-pro**：数据在浏览器 IndexedDB（不同 origin 无法直读）。流程：旧程序「导出 JSON」→ 新程序「数据中心 → 导入」选择该 JSON（自动识别 `app:'studio-log-pro'`，迁移 projects/entries/days/templates/settings，附件若含 base64 一并还原）。
- 迁移幂等：按 id 去重；重复执行不产生副本。

## 8. 验收

- `npm test`：零依赖 Node 测试脚本，自起临时数据目录 + 临时端口，覆盖：notes 契约/冻结修订/引用/灵感隔离、work CRUD/工时/回收站/项目迁移、附件、搜索、统计、导出格式、导入 dryRun、快照恢复、锁、迁移 dryRun、SPA 回退、媒体防穿越。
- 浏览器可视验收：两主题 × 两密度 × 桌面/窄屏；键盘全流程；无控制台错误；构建产物无 404。
- 文档：`docs/API.md`、`docs/DESIGN.md`、`docs/FEATURE-MATRIX.md`、`README.md`。