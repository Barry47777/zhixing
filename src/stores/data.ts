/**
 * Studio 形状的数据层（适配层）
 *
 * 界面是从 Studio Log 移植过来的，它假定「所有数据都在内存里」。
 * 知行的数据在本地服务端，所以这里做一层转接：对外暴露 studio 那套
 * reactive data + 增删改函数，对内全部走 /api。后端一行没改。
 */

import { computed, reactive, ref } from 'vue'
import { api } from '../api'
import type {
  DayLog, Entry, Project, Template, Attachment, EntryStatus,
} from '../types.studio'
import { uid } from '../utils/format'
import { toPlain } from '../utils/plain'

interface DataState {
  ready: boolean
  projects: Project[]
  entries: Entry[]
  days: DayLog[]
  templates: Template[]
  attachmentBytes: number
}

export const data = reactive<DataState>({
  ready: false,
  projects: [],
  entries: [],
  days: [],
  templates: [],
  attachmentBytes: 0,
})

/** 演示数据的灌入时间，0 表示当前是用户自己的数据 */
export const demoSeededAt = ref(0)

export const activeEntries = computed(() => data.entries.filter((e) => !e.deletedAt))

export const trashedEntries = computed(() =>
  data.entries.filter((e) => e.deletedAt).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0)),
)

export const projectMap = computed(() => {
  const m = new Map<string, Project>()
  data.projects.forEach((p) => m.set(p.id, p))
  return m
})

export function projectOf(id: string | null | undefined): Project | undefined {
  return id ? projectMap.value.get(id) : undefined
}

export function projectName(id: string | null | undefined): string {
  return projectOf(id)?.name || '未分类'
}

export function projectColor(id: string | null | undefined): string {
  return projectOf(id)?.color || 'var(--muted)'
}

export function entriesOn(date: string): Entry[] {
  return activeEntries.value
    .filter((e) => e.date === date)
    .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
}

export function summaryOf(date: string): string {
  return data.days.find((d) => d.date === date)?.summary || ''
}

export function hoursOn(date: string): number {
  return entriesOn(date).reduce((s, e) => s + (e.hours || 0), 0)
}

export function tagPool(): { tag: string; count: number }[] {
  const map = new Map<string, number>()
  activeEntries.value.forEach((e) => e.tags.forEach((t) => map.set(t, (map.get(t) || 0) + 1)))
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/* ------------------------------------------------------------------ 窗口 */

function keyOfDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 载入窗口：往前 5 年、往后 1 年。
 * 日历要翻月、洞察要 52 周热力图、项目要算本月/本周，都需要一段连续数据。
 * 本地服务一次给 5000 条上限，超过时以最近的记录为准。
 */
function windowRange(): { from: string; to: string } {
  const now = new Date()
  const from = new Date(now.getFullYear() - 5, 0, 1)
  const to = new Date(now.getFullYear() + 1, 11, 31)
  return { from: keyOfDate(from), to: keyOfDate(to) }
}

/* ------------------------------------------------------------------ 映射 */

function toProject(p: any): Project {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    status: p.status || 'active',
    note: p.note || '',
    weeklyTarget: Number(p.weeklyGoalHours) || 0,
    startDate: p.startDate || null,
    dueDate: p.dueDate || null,
    progress: typeof p.progress === 'number' ? p.progress : 0,
    order: typeof p.order === 'number' ? p.order : 0,
    createdAt: p.createdAt || 0,
    updatedAt: p.updatedAt || 0,
  } as Project & { weeklyGoalHours?: number }
}

function toEntry(e: any): Entry {
  return {
    id: e.id,
    date: e.date,
    title: e.title || '',
    projectId: e.projectId || null,
    hours: typeof e.hours === 'number' ? e.hours : (Number(e.minutes) || 0) / 60,
    status: (e.status || 'done') as EntryStatus,
    priority: (Number(e.priority) || 0) as Entry['priority'],
    tags: Array.isArray(e.tags) ? e.tags : [],
    note: e.note || '',
    subtasks: Array.isArray(e.subtasks) ? e.subtasks : [],
    attachmentIds: Array.isArray(e.attachmentIds) ? e.attachmentIds : [],
    deletedAt: e.deletedAt ?? null,
    createdAt: e.createdAt || 0,
    updatedAt: e.updatedAt || 0,
  } as Entry & { attachments?: any[]; minutes?: number }
}

function toTemplate(t: any): Template {
  return {
    id: t.id,
    name: t.name,
    title: t.title || t.name,
    projectId: t.projectId || null,
    hours: Number(t.minutes || 0) / 60,
    tags: Array.isArray(t.tags) ? t.tags : [],
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.map((s: any) => (typeof s === 'string' ? s : s.text)) : [],
    useCount: t.useCount || 0,
    createdAt: t.createdAt || 0,
  } as Template
}

/* ------------------------------------------------------------------ 读取 */

export async function loadAll(): Promise<void> {
  const { from, to } = windowRange()
  const [entriesRes, daysRes, projectsRes, templatesRes] = await Promise.all([
    api.work.entries.list({ from, to, limit: 5000 }),
    api.work.days.list(from, to),
    api.work.projects.list(true),
    api.work.templates.list(),
  ])
  data.entries = (entriesRes.entries || []).map(toEntry)
  data.days = (daysRes.days || []) as DayLog[]
  data.projects = (projectsRes.projects || [])
    .map(toProject)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
  data.templates = (templatesRes.templates || [])
    .map(toTemplate)
    .sort((a, b) => b.useCount - a.useCount || b.createdAt - a.createdAt)
}

export async function initData(): Promise<void> {
  await loadAll()
  try {
    const health: any = await api.health()
    demoSeededAt.value = health.demo ? health.demoAt || Date.now() : 0
  } catch (_) {
    demoSeededAt.value = 0
  }
  data.ready = true
}

/** 单个条目刷新（用于写操作后进行局部对齐） */
function upsertEntry(raw: any): Entry {
  const next = toEntry(raw)
  // 保留接口没返回的附件信息
  const old = data.entries.find((e) => e.id === next.id) as any
  if (old && old.attachments && !(raw as any).attachments) {
    ;(next as any).attachments = old.attachments
  }
  const idx = data.entries.findIndex((e) => e.id === next.id)
  if (idx >= 0) data.entries[idx] = next
  else data.entries.push(next)
  return next
}

/** 某些写操作后端只回 { ok }，这时用一次窗口重载保证一致 */
export async function reloadEntries(): Promise<void> {
  const { from, to } = windowRange()
  const res = await api.work.entries.list({ from, to, limit: 5000 })
  data.entries = (res.entries || []).map(toEntry)
}

/* ------------------------------------------------------------------ 记录 */

export interface EntryInput {
  date: string
  title: string
  projectId?: string | null
  hours?: number
  status?: Entry['status']
  priority?: Entry['priority']
  tags?: string[]
  note?: string
  subtasks?: Entry['subtasks']
  attachmentIds?: string[]
}

function minutesOf(hours: number | undefined): number {
  return Math.max(0, Math.round((Number(hours) || 0) * 60))
}

export async function addEntry(input: EntryInput): Promise<Entry | null> {
  const title = input.title.trim()
  if (!title) return null
  const res = await api.work.entries.create({
    date: input.date,
    title,
    projectId: input.projectId || null,
    minutes: minutesOf(input.hours),
    status: input.status || 'done',
    priority: input.priority || 0,
    tags: input.tags || [],
    note: input.note || '',
    subtasks: input.subtasks || [],
    attachmentIds: input.attachmentIds || [],
  })
  return upsertEntry(res.entry)
}

export async function updateEntry(id: string, patch: Partial<Entry>): Promise<void> {
  const body: any = {}
  if (patch.title !== undefined) body.title = patch.title
  if (patch.date !== undefined) body.date = patch.date
  if (patch.projectId !== undefined) body.projectId = patch.projectId
  if (patch.hours !== undefined) body.minutes = minutesOf(patch.hours)
  if (patch.status !== undefined) body.status = patch.status
  if (patch.priority !== undefined) body.priority = patch.priority
  if (patch.tags !== undefined) body.tags = patch.tags
  if (patch.note !== undefined) body.note = patch.note
  if (patch.subtasks !== undefined) body.subtasks = patch.subtasks
  if (patch.attachmentIds !== undefined) body.attachmentIds = patch.attachmentIds
  if (patch.deletedAt !== undefined) {
    // 删除 / 恢复走专用接口
    if (patch.deletedAt) await api.work.entries.remove(id)
    else await api.work.entries.restore(id)
  }
  if (Object.keys(body).length) {
    const res = await api.work.entries.update(id, body)
    upsertEntry(res.entry)
  }
  if (patch.deletedAt !== undefined && !patch.deletedAt) await reloadEntries()
}

export async function trashEntry(id: string): Promise<void> {
  await api.work.entries.remove(id)
  const found = data.entries.find((e) => e.id === id)
  if (found) found.deletedAt = Date.now()
}

export async function restoreEntry(id: string): Promise<void> {
  const res = await api.work.entries.restore(id)
  upsertEntry(res.entry)
}

export async function purgeEntry(id: string): Promise<void> {
  await api.work.entries.purge(id)
  data.entries = data.entries.filter((e) => e.id !== id)
}

export async function emptyTrash(): Promise<number> {
  const ids = trashedEntries.value.map((e) => e.id)
  for (const id of ids) await purgeEntry(id)
  return ids.length
}

export async function copyEntries(fromDate: string, toDate: string): Promise<number> {
  const res = await api.work.entries.copy(fromDate, toDate)
  await reloadEntries()
  return res.copied || 0
}

export async function moveEntry(id: string, date: string): Promise<void> {
  const res = await api.work.entries.move(id, date)
  upsertEntry(res.entry)
}

/* ------------------------------------------------------------------ 当日总结 */

export async function setSummary(date: string, summary: string): Promise<void> {
  await api.work.days.summary(date, summary)
  const existing = data.days.find((d) => d.date === date)
  if (!summary.trim()) {
    data.days = data.days.filter((d) => d.date !== date)
    return
  }
  if (existing) {
    existing.summary = summary
    existing.updatedAt = Date.now()
  } else {
    data.days.push({ date, summary, updatedAt: Date.now() })
  }
}

/* ------------------------------------------------------------------ 项目 */

export interface ProjectInput {
  name: string
  color: string
  status?: Project['status']
  note?: string
  weeklyTarget?: number
  startDate?: string | null
  dueDate?: string | null
  progress?: number
}

export async function addProject(input: ProjectInput): Promise<Project> {
  const res = await api.work.projects.create({
    name: input.name.trim() || '未命名项目',
    color: input.color,
    status: input.status || 'active',
    note: input.note || '',
    weeklyGoalHours: Number(input.weeklyTarget) || 0,
    startDate: input.startDate || null,
    dueDate: input.dueDate || null,
    progress: Math.max(0, Math.min(100, input.progress || 0)),
    order: data.projects.length,
  })
  const project = toProject(res.project)
  data.projects.push(project)
  return project
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  const body: any = { ...patch }
  if (patch.weeklyTarget !== undefined) {
    body.weeklyGoalHours = patch.weeklyTarget
    delete body.weeklyTarget
  }
  delete body.order
  const res = await api.work.projects.update(id, body)
  const idx = data.projects.findIndex((p) => p.id === id)
  if (idx >= 0) data.projects[idx] = { ...data.projects[idx], ...toProject(res.project) }
}

export async function deleteProject(id: string, transferTo: string | null = null): Promise<number> {
  const affected = data.entries.filter((e) => e.projectId === id)
  await api.work.projects.remove(id, transferTo)
  data.projects = data.projects.filter((p) => p.id !== id)
  affected.forEach((e) => { e.projectId = transferTo })
  return affected.length
}

export async function mergeProject(sourceId: string, targetId: string): Promise<number> {
  if (sourceId === targetId) return 0
  const affected = data.entries.filter((e) => e.projectId === sourceId)
  await api.work.projects.merge(sourceId, targetId)
  data.projects = data.projects.filter((p) => p.id !== sourceId)
  affected.forEach((e) => { e.projectId = targetId })
  return affected.length
}

export async function reorderProjects(orderedIds: string[]): Promise<void> {
  orderedIds.forEach((id, index) => {
    const p = data.projects.find((x) => x.id === id)
    if (p) p.order = index
  })
  data.projects.sort((a, b) => a.order - b.order)
  await api.work.projects.reorder(orderedIds)
}

/* ------------------------------------------------------------------ 模板 */

export async function saveTemplate(input: Omit<Template, 'id' | 'useCount' | 'createdAt'>): Promise<Template> {
  const res = await api.work.templates.create({
    name: input.name,
    title: input.title,
    projectId: input.projectId,
    minutes: minutesOf(input.hours),
    tags: input.tags,
    subtasks: input.subtasks,
  })
  const tpl = toTemplate(res.template)
  data.templates.unshift(tpl)
  return tpl
}

export async function deleteTemplate(id: string): Promise<void> {
  await api.work.templates.remove(id)
  data.templates = data.templates.filter((t) => t.id !== id)
}

export async function useTemplate(id: string, date: string): Promise<Entry | null> {
  const res = await api.work.templates.use(id, date)
  const entry = upsertEntry(res.entry)
  const tpl = data.templates.find((t) => t.id === id)
  if (tpl) tpl.useCount += 1
  return entry
}

/* ------------------------------------------------------------------ 附件 */

export interface AttachReject { name: string; reason: string }
export interface AttachResult { created: Attachment[]; rejected: AttachReject[] }

export interface AttachmentRow extends Attachment {
  url: string
  thumbUrl: string | null
  name: string
  mime: string
  size: number
}

function rowsOf(entryId: string): AttachmentRow[] {
  const entry: any = data.entries.find((e) => e.id === entryId)
  const list: any[] = entry?.attachments || []
  return list.map((a) => ({
    ...a,
    url: a.url || `/api/attachments/${a.id}`,
    thumbUrl: a.thumbUrl || null,
    name: a.name,
    mime: a.mime,
    size: a.size,
    blob: null,
  })) as unknown as AttachmentRow[]
}

export async function attachmentsOf(entryId: string): Promise<AttachmentRow[]> {
  const entry: any = data.entries.find((e) => e.id === entryId)
  if (!entry || !Array.isArray(entry.attachments)) {
    try {
      const res = await api.work.entries.list({ date: entry?.date, limit: 500 })
      const fresh: any = (res.entries || []).find((e) => e.id === entryId)
      if (fresh && entry) entry.attachments = fresh.attachments || []
    } catch (_) { /* 忽略 */ }
  }
  return rowsOf(entryId)
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读不出这个文件'))
    reader.readAsDataURL(file)
  })
}

const MAX_FILE_BYTES = 40 * 1024 * 1024
const MAX_FILES_PER_PICK = 12

async function uploadAll(files: File[], entryId: string, date: string): Promise<AttachResult> {
  const created: Attachment[] = []
  const rejected: AttachReject[] = []
  for (const file of files.slice(0, MAX_FILES_PER_PICK)) {
    if (file.size > MAX_FILE_BYTES) {
      rejected.push({ name: file.name, reason: '单个文件超过 40MB' })
      continue
    }
    try {
      const data = await readAsDataUrl(file)
      const res = await api.attachments.upload({
        name: file.name || `粘贴的图片-${Date.now()}.png`,
        entryId,
        date,
        data,
      })
      created.push(res.attachment as unknown as Attachment)
    } catch (err: any) {
      rejected.push({ name: file.name, reason: err?.message || '上传失败' })
    }
  }
  if (files.length > MAX_FILES_PER_PICK) {
    rejected.push({ name: `${files.length - MAX_FILES_PER_PICK} 个文件`, reason: `一次最多 ${MAX_FILES_PER_PICK} 个` })
  }
  if (created.length) await reloadEntries()
  return { created, rejected }
}

export async function attachFilesToEntry(entryId: string, date: string, files: File[]): Promise<AttachResult> {
  return uploadAll(files, entryId, date)
}

export async function deleteAttachment(id: string): Promise<void> {
  await api.attachments.remove(id)
  await reloadEntries()
}

/** 记录草稿用的临时附件：先挂到一个假 entryId 上，保存时后端会改写归属 */
export async function uploadDraftAttachment(date: string, file: File): Promise<Attachment> {
  const dataUrl = await readAsDataUrl(file)
  const res = await api.attachments.upload({ name: file.name, entryId: null, date, data: dataUrl })
  return res.attachment as unknown as Attachment
}

export function uidOf(prefix = ''): string {
  return uid(prefix)
}

/* 保留导入，避免 tree-shake 报未使用 */
void toPlain

/* ------------------------------------------------------------------ 演示数据 */

/** 清空演示数据（服务端会先自动快照） */
export async function clearEverything(): Promise<void> {
  await api.system.clearDemo()
  demoSeededAt.value = 0
  await loadAll()
  await loadAllProjectsAgain()
}

async function loadAllProjectsAgain(): Promise<void> {
  const res = await api.work.projects.list(true)
  data.projects = (res.projects || []).map(toProject).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
}
