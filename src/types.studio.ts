/** 全局数据模型 —— 所有表结构集中在这里，迁移时只改类型 + db 版本号 */

export type ProjectStatus = 'active' | 'paused' | 'archived'
export type EntryStatus = 'done' | 'doing' | 'blocked'
export type Priority = 0 | 1 | 2

export interface Project {
  id: string
  name: string
  color: string
  status: ProjectStatus
  note: string
  /** 每周目标工时，0 表示不设目标 */
  weeklyTarget: number
  /** 计划开始日 yyyy-MM-dd */
  startDate: string | null
  /** 截止 / 计划完成日 yyyy-MM-dd */
  dueDate: string | null
  /** 进度 0-100，拖拽调整 */
  progress: number
  /** 排序权重，小的在前 */
  order: number
  createdAt: number
  updatedAt: number
}

export interface SubTask {
  id: string
  text: string
  done: boolean
}

export interface Entry {
  id: string
  /** yyyy-MM-dd */
  date: string
  title: string
  projectId: string | null
  hours: number
  status: EntryStatus
  priority: Priority
  tags: string[]
  note: string
  subtasks: SubTask[]
  attachmentIds: string[]
  /** 软删除时间，null 表示正常；回收站可恢复 */
  deletedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface DayLog {
  date: string
  summary: string
  updatedAt: number
}

export interface Template {
  id: string
  name: string
  title: string
  projectId: string | null
  hours: number
  tags: string[]
  subtasks: string[]
  useCount: number
  createdAt: number
}

export interface Attachment {
  id: string
  entryId: string
  date: string
  name: string
  mime: string
  size: number
  blob: Blob
  /** 图片缩略图（webp），非图片为 null */
  thumb: Blob | null
  createdAt: number
}

export interface Snapshot {
  id: string
  createdAt: number
  reason: string
  entryCount: number
  projectCount: number
  /** 压缩后的 JSON 字符串 */
  payload: string
  size: number
}

export type ThemeMode = 'light' | 'dark' | 'system'
export type Density = 'compact' | 'cozy'

export interface Settings {
  theme: ThemeMode
  accent: string
  density: Density
  /** 0 = 周日，1 = 周一 */
  weekStartsOn: 0 | 1
  dailyGoal: number
  defaultProjectId: string | null
  defaultHours: number
  fontScale: number
  /** 自动快照间隔（小时），0 = 关闭 */
  autoSnapshotHours: number
  /** 附件总占用上限（MB） */
  attachmentLimitMB: number
  showWeekNumbers: boolean
  reduceMotion: boolean
}

export interface MarkdownResult {
  filename: string
  content: string
}
