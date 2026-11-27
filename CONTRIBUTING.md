# 贡献指南

谢谢你对知行感兴趣。这是一个个人工具项目，任何让它更稳、更好用的改动都欢迎。

## 提 Issue 前

- 先确认是稳定复现的问题，写清楚操作步骤和预期结果。
- 涉及数据的 Issue 请**不要附上真实的 `workspace.json` 或笔记截图**，可用虚构内容代替。
- 功能建议请说明使用场景，而不只是「想要某个按钮」。

## 提交 Pull Request

1. Fork 仓库，从 `main` 切一个分支：`git checkout -b feature/你的主题`
2. 安装依赖并确认基线通过：`npm install && npm test`
3. 改动后至少跑通：
   - `npm run typecheck`
   - `npm run build`
   - `npm test`
4. 提交信息用简短中文或英文描述，例如 `修复颜色按钮选区丢失`。
5. 推送到你的 Fork，开 Pull Request，说明改了什么、怎么验证的。

## 代码约定

- 服务端只用 Node.js 内置模块，不引入运行时依赖。
- 富文本正文进服务端前会经过白名单消毒；新增格式标签时，前端工具栏、服务端 `server/lib/richtext.js`、阅读页样式三处要同步。
- Edge 皮肤样式改 `src/styles/edge/*.css` 源文件，然后运行 `node scripts/scope-edge-css.mjs` 重新生成 `*.scoped.css`，不要直接改生成文件。
- 新增前端入口时，保持 `data-skin` 切换逻辑：工作区跟随主题，思维区固定深色。

## 不要提交

运行时的 `data/`、`account.json`、`workspace.json`、构建产物 `dist/`、`build/`、`release/` 都已在 `.gitignore` 中，提交前请再确认一次（`git status`）。

## 许可

提交即表示你同意自己的贡献以 MIT 许可发布。
