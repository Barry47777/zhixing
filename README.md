# 知行 · 工作台

> 工作与思考，同一张桌面。

知行是一个**本地优先**的个人工作台：把日历式的工作记录、项目与时间统计，和随手记下的灵感、想法、判断与复盘，放进同一个程序、同一份数据里。两边可以互相引用、一起搜索、一起导出。

界面采用双皮肤设计：

- **工作区**（今日 / 日历 / 统计 / 项目）：Studio Log 的浅色原风格，安静、克制、信息密度高。
- **思维区**（灵感 / 复盘）：Edge 的深色玻璃质感，紫色点缀，适合长时间阅读和写作。

## 特性

### 工作区
- 月历 6×7，每格显示工时、项目色条、总结与附件标记；记录可拖拽改期
- 右侧记录抽屉：时长滑杆、优先级、标签、子任务、附件（拖拽 / Ctrl+V 截图）、模板、撤销删除
- 项目：颜色、状态、进度与每周目标拖动、拖拽排序、合并与迁移
- 统计：投入、活跃天数、日均、记录热力图、近 8 周柱状、项目占比与最耗时项
- 首页自定义模块：按设置宽度智能铺满成行，同行卡片等高

### 思维区
- 灵感速记：富文本、Enter 记下 / Shift+Enter 换行、草稿自动保存、图片 ≤9、标签 ≤8
- 瀑布 / 网格 / 列表三种卡片墙；搜索、标签、待归类 / 已归档、时间范围、排序
- 复盘记录：富文本工具栏（字号、粗斜体下划线删除线、六色文字、对齐、列表、小标题、引用、撤销重做、清除格式、插图、粘贴图片）
- 归因视图：结果对/错/说不清、把握度、成长、十项错误归因；结结果后冻结，修改需写修订理由
- `@序号` / `[[标题]]` 引用支持跨灵感与复盘跳转，阅读页有紫粉渐变阅读进度条

### 数据与账户
- 一个 `workspace.json` 存全部记录与笔记，附件单独放 `data/media/`
- 原子写 + fsync + 备份 + 失败回滚 + 快照；单实例锁防止多人同时写坏数据
- 本机账户：scrypt 加盐哈希，密码与恢复码不明文落盘；未登录时页面、接口、附件全部拦截
- 空闲自动锁定、12 小时会话上限；关闭浏览器或重启程序自动退出
- 导出：完整备份 JSON（可含附件 base64）、Markdown、Word、知识库包、工作日报/周报/月报
- Windows 单文件 exe：内嵌 Node 运行时与前端资源，双击即用，无需安装 Node.js

## 技术栈

- 前端：Vue 3 + Vite + TypeScript，hash 路由，无 UI 框架，手写设计令牌与组件
- 服务端：Node.js 内置模块，**零运行时依赖**
- 打包：esbuild + Node SEA + postject
- 富文本消毒：服务端白名单重建，不复制来源属性，天然免疫 `on*` / `javascript:`

## 在线网页版

不想安装任何东西？直接用浏览器打开：<https://barry47777.github.io/zhixing/>

网页版是纯前端版本：所有数据存在**你自己的浏览器**（IndexedDB）里，不上传服务器、不需要登录、刷新和关掉浏览器都不会丢。第一次打开会自动生成一份演示数据，方便体验。

和桌面 exe 版的区别：

- 数据存在浏览器本地，**不跨设备同步**，也和 exe 版的 `data/` 目录**互不通用**（两边通过「设置 → 导出 JSON / 导入」互通）
- 没有本机账户登录（网页版无需登录）
- 图片和附件以 data URL 存在浏览器里，单个文件太大可能超出浏览器配额
- 换浏览器或清理浏览器数据前，记得先在设置里导出 JSON 备份

网页版的源码在 `src/web/`，构建命令：

```bash
npm install
npm run build:web      # 生成 gh-pages/ 目录
```

先把服务端的纯函数库转成浏览器 ESM（`node scripts/gen-web-libs.mjs`，已包含在构建命令里），再由 Vite 打包。核心是把 `/api/*` 请求拦截到浏览器内的虚拟后端（`src/web/backend.ts`），用 IndexedDB 替代文件存储。

## 快速开始

需要 Node.js 18 或更新版本。

```bash
npm install
npm run build
npm start
```

浏览器打开 <http://127.0.0.1:7900>，首次访问会进入注册页：注册账户 → 抄下只显示一次的恢复码 → 登录。

开发模式（前端热更新，7901 端口，API 代理到 7900）：

```bash
# 一个终端
npm run server
# 另一个终端
npm run dev
```

Windows 上如果 `npm` 被执行策略拦住，请用 `npm.cmd` 或 `cmd /c npm`。也可以直接双击 `start.cmd`，它会自动安装依赖、构建并启动。

## 单文件 exe

```bash
npm run build:exe
```

产物在 `release/知行.exe`。首次运行会在 exe 同目录释放 `_assets/` 并创建 `data/`，数据与账户文件都在那里。搬家时请把整个文件夹一起带走。

## 数据安全边界

登录保护的是**程序入口**：别人打开你的电脑，直接点 exe 或浏览器看不到工作台。但 `workspace.json` 是明文 JSON，登录**不是整库加密**；如果对方拥有 Windows 管理员权限、能直接读取 `data/` 目录，仍需依靠 Windows 账户密码和 BitLocker 磁盘加密来保护。

项目默认监听 `127.0.0.1`，不联网、不上传任何内容。首次运行会生成虚构的演示数据，可在设置里一键清空。

## 目录结构

```
zhixing/
├── server/                 服务端（零依赖）
│   ├── index.js            HTTP 分发 / 单实例锁 / 端口顺延 / 鉴权守卫
│   ├── auth.js             本机账户、会话、恢复码、空闲锁定
│   ├── store.js            内存 db、原子落盘、快照、回收站、媒体 GC
│   ├── demo.js             首次运行的虚构演示数据
│   ├── sea-entry.cjs       SEA 单文件启动入口
│   ├── lib/                富文本消毒、链接、复盘、导出、图片、ZIP 等
│   ├── models/             notes.js · work.js
│   └── routes/             notes.js · work.js · core.js · transfer.js · migrate.js
├── src/                    前端
│   ├── views/              Today / Calendar / Stats / Notes / Review / Projects / Settings
│   ├── components/         edge（富文本编辑器 / 阅读器 / 抽屉）· calendar · home · base
│   ├── stores/             data · settings · session · auth
│   ├── api/                HTTP 封装与全部接口
│   └── styles/             tokens.css · studio.css · edge/*.scoped.css
├── public/                 login.html · splash.html · manifest · favicon
├── scripts/                acceptance · data-audit · build-exe · scope-edge-css
├── docs/                   ARCHITECTURE · API · DESIGN · 前端重做变更说明
└── data/                   运行时生成，已加入 .gitignore
```

## 脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | Vite 开发服务器 |
| `npm run server` | 只启动 API |
| `npm run build` | 构建前端到 `dist/` |
| `npm start` | 构建后启动并打开浏览器 |
| `npm run typecheck` | vue-tsc 类型检查 |
| `npm test` | 验收脚本（自起隔离服务，跑完清理） |
| `node scripts/data-audit.mjs` | 数据安全压测：连续/并发写、强杀重启、备份导入 |
| `npm run build:exe` | 打包 Windows 单文件 exe |
| `npm run build:web` | 构建 GitHub Pages 网页版到 `gh-pages/` |
| `node scripts/gen-web-libs.mjs` | 把服务端纯函数库转成浏览器 ESM |

## 许可

[MIT](LICENSE) — 可自由使用、修改与分发，请保留版权声明。

这个项目是个人工具，欢迎提 Issue 和 Pull Request；贡献指南见 [CONTRIBUTING.md](CONTRIBUTING.md)。
