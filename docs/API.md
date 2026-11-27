# 知行 · API 契约

所有接口以 `/api` 开头，请求/响应均为 JSON（导出除外）。成功响应都含 `ok: true`；失败返回 4xx/5xx 与 `{ ok:false, error:"中文人话", ... }`。服务只监听 127.0.0.1。日期用 `YYYY-MM-DD`，时间为毫秒时间戳。请求体上限：普通 JSON 1MB，导入 96MB，单个附件 24MB（base64 后）。

## 0. 通用

### GET /api/health
```json
{ "ok":true, "app":"zhixing", "version":2, "pid":1, "dataDir":"…", "notes":12, "entries":30,
  "projects":4, "lastWriteError":null, "serverTime":1700000000000 }
```

### GET /api/enums
服务端全部枚举与标签，供前端校验/展示，保持单一来源：
```json
{ "ok":true, "zones":["inspiration","review"], "types":["idea","insight","review","strategy"],
  "stages":["idea","judgment","trade"], "dids":["acted","skipped","none"], "outcomes":["right","wrong","unclear"],
  "growths":["up","equal","down"], "sides":["long","short","flat"], "horizons":["intraday","3d","1w","1m","3m"],
  "mistakes":[{"key":"direction","label":"方向看反"}, "…10 项"],
  "stateTags":["睡好","疲惫","手痒","急躁","分心","平静"], "baseTag":"底线", "tagsMax":8,
  "accents":["teal","blue","emerald","amber","coral","rose","graphite"] }
```

### GET /api/settings → `{ ok, settings }`
### PUT /api/settings → body 为部分字段，返回 `{ ok, settings }`；未知字段忽略；数值夹紧。
`theme` system|dark|light；`accent` 见 enums；`density` cozy|compact；`fontScale` 0.85–1.25；`weekStart` 0|1；`dailyGoalHours` 1–24；`defaultProjectId`；`defaultMinutes` 15–720；`reduceMotion`；`showWeekNumbers`；`snapshotHours` 0|6|12|24|72；`attachmentLimitMB` 50–2048；`startView`；`welcomeDone`。

### GET /api/overview?date=YYYY-MM-DD （默认今天，本地时区）
今日仪表盘一次取齐：
```json
{ "ok":true,
  "date":"2026-11-26",
  "today":{ "minutes":210, "entryCount":3, "doneCount":2, "goalHours":6,
            "entries":[…EntryView] },
  "week":{ "minutes":1260, "activeDays":4, "entries":11, "labels":["周一",…], "daily":[0,120,…] },
  "streakDays":5,
  "notes":{ "today":2, "week":7, "inbox":3, "recent":[…NoteView 6 条] },
  "review":{ "pending":4, "dueProject":[…], "blindCard":{…}|null },
  "projects":[…ProjectView with progress 前 5],
  "tags":[{"tag":"设计","count":8}],
  "nextDue":[…ProjectView 到期/逾期]
}
```

### GET /api/search?q=&limit=8
```json
{ "ok":true, "q":"…",
  "notes":[…NoteView], "entries":[…EntryView], "projects":[…ProjectView], "templates":[…],
  "total":12 }
```
匹配正文/标题/标签/备注/子任务/项目名；大小写不敏感；空 q 返回空组。

## 1. 笔记（思考 / 复盘）

字段见 ARCHITECTURE。列表默认返回当前区可展示字段；`zone=inspiration` 时自动剥离复盘字段。

### GET /api/notes
查询参数（都可选）：`zone=inspiration|review`、`q=`、`tag=`、`type=`、`stage=`、`status=open|settled|inbox`、`growth=pending`、`days=7`（配合 pending）、`desk=check|attribute|growth|fill|all`、`incomplete=1`、`projectId=`、`entryId=`。
```json
{ "ok":true, "notes":[…], "total":12, "desk":{ "check":3, "attribute":1, "growth":2, "fill":4, "all":10 } }
```
复盘区字段含 `incomplete`（缺什么）、`refs`/`backrefs` 计数。排序：置顶优先，`updatedAt` 降序。

### POST /api/notes
```json
{ "zone":"inspiration|review", "type":"idea|insight|review|strategy",
  "content":"<p>…</p>", "seen":"", "think":"", "text":"",
  "tags":["…"], "images":[{"url":"/media/…","w":800,"h":600}],
  "triage":"inbox|filed", "pinned":false, "derivedFrom":"uuid|null",
  "projectId":"p_…|null", "entryId":"e_…|null",
  "stage":"idea|judgment|trade", "did":"acted|skipped|none", "bet":{…}, "trade":{…} }
```
正文与图片至少一项，否则 400「写点什么再存（文字或图片至少要有一个）」。成功 201 `{ ok, note }`。

### GET /api/notes/:id
`{ ok, note, refs:[…], backrefs:[…], incomplete:[…] }`；引用关系由正文 `@序号` / `[[…]]` 计算。

### PATCH /api/notes/:id
可改：`content`、`seen`、`think`、`tags`、`type`、`zone`、`stage`、`bet`、`trade`、`did`、`skipReason`、`images`、`pinned`、`triage`、`callRight`、`growth`、`after`、`projectId`、`entryId`、`revision:{reason}`。
- 已 `frozen` 且改冻结字段（content/seen/think/bet/did/skipReason/type/zone/stage）而未带修订理由 → 409 `{ ok:false, frozen:true, fields:[…], error:"这条已经结了果，想法不能再改。要改请带修订理由。" }`
- 带理由则旧值写入 `revisions`（≤50）。
- 正文与图片同时为空 → 400 并保持原值。

### DELETE /api/notes/:id → `{ ok, id }`（真删；引用关系保留为断链）

### POST /api/notes/:id/result
`{ outcome:"right|wrong|unclear", note:"", mistake?:"…", callRight?:"right|wrong|unclear" }`
已结则 409「结果已经记过，不能重复结。要补充请写「事后想想」。」成功即冻结。

### POST /api/notes/:id/after → `{ text }`，空文本清空。返回 `{ ok, note }`。

### GET /api/notes/:id/comments → `{ ok, comments }`
### POST /api/notes/:id/comments → `{ text }`（≤500 字）→ 201 `{ ok, comment, comments }`；不改 `updatedAt`。
### DELETE /api/notes/:id/comments/:cid → `{ ok, comments }`

### 归因 / 深度复盘
- `GET /api/review/week?days=7` → `{ ok, picks:[…], weekStart }` 周回顾候选（最多 40）。
- `GET /api/review/next` → `{ ok, card, ageMin, pool, lastReviewAt }` 今日盲卡。
- `GET /api/review/:id/reveal` → `{ ok, reveal:{ think, bet, result, after, createdAt } }`
- `POST /api/review/:id/verdict` → `{ verdict:"same|better|worse|both_wrong", newThink:"", newConf:1-5|null }` → `{ ok, note }`
- `GET /api/ruler` → `{ ok, verdicts, calibration, skipped, funnel, mistakes, callHit, growth, execution }`
- `GET /api/stats/notes?zone=` → 灵感/复盘概览数字（total/week/inbox/filed/pinned/byType/tags/stateTags/review{count,settled,wins,winRate,pnl}）。

## 2. 工作记录

### GET /api/work/entries
`from`、`to`（含端点）、`date`、`projectId`、`q`、`includeDeleted=1`、`limit`。返回按 `date` 降序、同日 priority 降序、时间升序：
```json
{ "ok":true, "entries":[EntryView], "total":30 }
```
EntryView = Entry 全字段 + `hours`（minutes/60，1 位小数）+ `project:{id,name,color}|null` + `attachments:[AttachmentView]`。

### POST /api/work/entries → body 同 Entry（无 id/时间戳）；`title` 必填；`minutes` 默认设置；返回 201 `{ ok, entry }`。

### PATCH /api/work/entries/:id → 部分字段；`date` 可改（拖拽换日）。返回 `{ ok, entry }`。
### DELETE /api/work/entries/:id → 软删（进回收站）`{ ok, id, deletedAt }`
### POST /api/work/entries/:id/restore → 恢复 `{ ok, entry }`
### DELETE /api/work/entries/:id/purge → 彻底删除 + 清附件文件 `{ ok, id }`
### POST /api/work/entries/copy → `{ from:"YYYY-MM-DD", to:"YYYY-MM-DD" }` 复制（状态 done→doing、不带附件）→ `{ ok, copied }`
### POST /api/work/entries/move → `{ id, date }`（拖拽）→ `{ ok, entry }`

### GET /api/work/days?from&to → `{ ok, days:[DayLog] }`
### PUT /api/work/days/:date → `{ summary }`，空则删除；`{ ok, day }`

### GET /api/work/projects?includeArchived=1 → `{ ok, projects:[ProjectView] }`
ProjectView = Project + `entryCount`、`minutes`（统计全部未删记录）、`noteCount`。
- `POST /api/work/projects` body {name,color,status?,note?,weeklyGoalHours?,startDate?,dueDate?,progress?} → 201
- `PATCH /api/work/projects/:id` 部分字段
- `DELETE /api/work/projects/:id?transferTo=p_x|none` → 记录与笔记迁到目标项目或未分类，永不丢；返回 `{ ok, id, movedEntries, movedNotes }`
- `POST /api/work/projects/:id/merge` → `{ targetId }` → 源项目记录/笔记并入目标后删除源
- `POST /api/work/projects/reorder` → `{ ids:[…] }`

### 模板
- `GET /api/work/templates` → 按使用次数降序
- `POST /api/work/templates` → {name,title,projectId,minutes,tags,subtasks:[string]} → 201
- `PATCH /api/work/templates/:id`；`DELETE /api/work/templates/:id`
- `POST /api/work/templates/:id/use` → `{ date }` 生成一条 status=doing 的记录（子任务未完成），useCount+1 → 201 `{ ok, entry, template }`

### 回收站
- `GET /api/work/trash` → `{ ok, entries:[EntryView], expiresInDays:30 }`
- `POST /api/work/trash/empty` → 清空并删附件文件
- 启动时自动清理超过 30 天的软删记录

## 3. 附件与媒体

### POST /api/attachments
```json
{ "name":"方案.pdf", "entryId":"e_…|null", "date":"YYYY-MM-DD",
  "data":"data:application/pdf;base64,…", "thumb":"data:image/webp;base64,…|null",
  "w":1200, "h":800 }
```
- 图片 ≤12MB（客户端先压缩到 ≤2MB），其它 ≤40MB；总配额按 settings.attachmentLimitMB 提示但不中断。
- 文件名做白名单清理；以内容嗅探决定扩展名，不信任扩展名。
- 返回 201 `{ ok, attachment: AttachmentView }`，其中 `url:"/media/…"`、`thumbUrl:"/media/…|null"`。
- `POST /api/work/entries/:id/attachments` → `{ ids:[…] }` 把附件绑定到记录（更新 attachmentIds）。
- `DELETE /api/attachments/:id` → 软删并移出记录；`DELETE /api/attachments/:id/purge` 删文件。
- `GET /api/attachments/:id?download=1` → 文件流（inline 或 attachment）。
- `GET /media/<rel>` → 图片/附件流；仅允许 data/media 下路径。

## 4. 统计

### GET /api/stats/work?from&to
```json
{ "ok":true, "from":"…","to":"…",
  "totalHours":42.5,"entryCount":30,"dayCount":12,"avgPerActiveDay":3.5,
  "doneCount":20,"doingCount":8,"blockedCount":2,
  "hoursByDay":{ "2026-11-01":4.5, … },
  "byProject":[{ "id":"p_1","name":"品牌设计","color":"#…","minutes":600,"count":8,"share":0.42 }],
  "heatmap":[{ "key":"2026-11-01","hours":4.5,"level":0-4 }],
  "weekly":[{ "start":"2026-11-02","label":"11/2","hours":12,"days":[0,2,…] }],
  "streakDays":5,
  "topEntries":[…EntryView 6],
  "tags":[{ "tag":"设计","count":8,"minutes":600 }],
  "monthCompare":{ "hours":42,"prevHours":38,"deltaPct":10.5,
                   "activeDays":12,"prevActiveDays":10,
                   "entries":30,"prevEntries":26,"done":20,"prevDone":18,
                   "avg":3.5,"prevAvg":3.4 }
}
```
`hours` 保留 1 位小数；`heatmap.level`：≥6h→4，≥4h→3，≥2h→2，>0→1。

### GET /api/insights?from&to
组合页一次取齐：`{ ok, work:同上, notes:（/api/stats/notes 结果）, ruler:{…} }`，减少瀑布请求。

## 5. 导出 / 导入

### GET /api/export
| 参数 | 值 |
|---|---|
| `scope` | `notes` / `work` / `all` |
| `format` | `md` / `pack` / `docx` / `json` / `print` / `workmd` / `backup` |
| 笔记筛选 | `zone` `q` `tag` `type` `stage` `pinned=1` `scopeFilter=wrong|skipped` |
| 工作范围 | `range=daily|weekly|monthly|all`、`date=YYYY-MM-DD`、`from`、`to` |
| 其它 | `attachments=1`（JSON 备份内联附件 base64）、`auto=1`（print 自动调起打印） |

- `notes+md`：IMA 合集 Markdown（图片 base64 内嵌）。
- `notes+pack`：zip 知识库（每条 md + frontmatter + images/）。
- `notes+docx`：Word，一条一页，图片跟随所属段落。
- `notes+json`：旧版笔记 JSON（可回导）。
- `notes+print`：打印/A4 PDF 网页。
- `work+workmd`：日报/周报/月报/全部历史 Markdown（复制友好）。
- `work+json`：工作数据 JSON（projects/entries/days/templates，可回导旧 Studio Log）。
- `all+backup|json`：全量工作区备份（默认不含附件二进制；`attachments=1` 内联）。
- 响应头 `Content-Disposition` 带中文文件名（ASCII fallback + `filename*`）；错误返回 JSON。

### POST /api/import
```json
{ "files":[{"name":"backup.json","data":"base64…"}],
  "mode":"merge|replace", "dryRun":true }
```
自动识别：旧笔记 JSON / IMA zip / Markdown / Word / Studio Log JSON / 知行全量备份。
```json
{ "ok":true, "mode":"merge", "kind":"notes|work|workspace|mixed",
  "parsed":12, "addable":10, "duplicates":2, "empty":0, "images":3,
  "errors":["…"], "notes":{…}, "work":{…},
  "preview":[{ "kind":"note|entry|project", "title":"…", "sub":"…", "meta":"…" }] }
```
`dryRun:true` 不写盘不落文件。`mode=replace` 必须 `confirmReplace:true` 才执行（否则 400），执行前自动快照。

### GET /api/migrate/inspect
```json
{ "ok":true,
  "inspiration":{ "found":true, "path":"…", "notes":123, "mediaFiles":12, "lastModified":0 },
  "studioLog":{ "found":false, "hint":"旧程序数据在浏览器 IndexedDB 中，请在旧程序里「导出 JSON」后在本页导入。" } }
```
### POST /api/migrate/inspiration
`{ dryRun:true }` → `{ ok, dryRun, notes:123, images:12, duplicates:0, totalAfter:… }`；`dryRun:false` 时复制笔记与图片（重写为 /media 路径）并快照。

## 6. 快照与维护

- `GET /api/snapshots` → `{ ok, snapshots:[{name,size,createdAt,reason,kind}], keep }`
- `POST /api/snapshots` `{ reason? }` → `{ ok, snapshot }`
- `POST /api/snapshots/:name/restore` → 先自动存「恢复前」快照，再整体替换；返回 `{ ok, restored }`
- `DELETE /api/snapshots/:name`
- `GET /api/storage` → `{ ok, dataDir, bytes, mediaBytes, mediaFiles, quotaHint }`
- `POST /api/cleanup` → 清 30 天前回收站、GC 无引用媒体、轮转快照与备份；`{ ok, purgedEntries, removedFiles, snapshots }`