import type { DayLog, Entry, Project } from '../types.studio'
import { addDays, fromKey, keyOf, startOfWeek, weekRange, monthRange } from './date'
import { fmtHours } from './format'
import { sumHours } from './stats'

interface Ctx {
  entries: Entry[]
  days: DayLog[]
  projects: Project[]
}

const STATUS_TEXT: Record<Entry['status'], string> = {
  done: '已完成',
  doing: '进行中',
  blocked: '受阻',
}

function projectName(projects: Project[], id: string | null): string {
  return projects.find((p) => p.id === id)?.name || '未分类'
}

function entryLine(e: Entry): string {
  const bits: string[] = [e.hours ? `${fmtHours(e.hours)}h` : '', STATUS_TEXT[e.status]]
  if (e.priority === 2) bits.unshift('重要')
  if (e.tags.length) bits.push(e.tags.map((t) => `#${t}`).join(' '))
  const head = `- ${e.title}（${bits.filter(Boolean).join(' · ')}）`
  const lines = [head]
  if (e.subtasks.length) {
    e.subtasks.forEach((s) => lines.push(`  - [${s.done ? 'x' : ' '}] ${s.text}`))
  }
  if (e.note) lines.push(`  > ${e.note.replace(/\n/g, '\n  > ')}`)
  return lines.join('\n')
}

function groupByProject(ctx: Ctx, entries: Entry[], level = 2): string {
  const groups = new Map<string, Entry[]>()
  entries.forEach((e) => {
    const name = projectName(ctx.projects, e.projectId)
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name)!.push(e)
  })
  const parts: string[] = []
  ;[...groups.entries()]
    .sort((a, b) => sumHours(b[1]) - sumHours(a[1]))
    .forEach(([name, list]) => {
      parts.push(`${'#'.repeat(level)} ${name} · ${fmtHours(sumHours(list))}h\n`)
      parts.push(list.map(entryLine).join('\n'))
      parts.push('')
    })
  return parts.join('\n')
}

export function dailyMarkdown(date: string, ctx: Ctx): string {
  const list = ctx.entries.filter((e) => e.date === date).sort((a, b) => b.priority - a.priority)
  const summary = ctx.days.find((d) => d.date === date)?.summary || ''
  const total = sumHours(list)
  const done = list.filter((e) => e.status === 'done').length
  const lines = [
    `# ${date} 工作日报`,
    '',
    `**投入** ${fmtHours(total)}h · **条目** ${list.length} · **完成** ${done}`,
    '',
    list.length ? groupByProject(ctx, list) : '_这一天还没有记录。_',
    '',
  ]
  if (summary) lines.push('## 当日总结', '', summary, '')
  return lines.join('\n')
}

export function weeklyMarkdown(anchor: string, ctx: Ctx, weekStartsOn: 0 | 1): string {
  const { start, end } = weekRange(fromKey(anchor), weekStartsOn)
  const list = ctx.entries.filter((e) => e.date >= start && e.date <= end)
  const days = [...new Set(list.map((e) => e.date))].sort()
  const total = sumHours(list)

  const lines = [
    `# ${start} ~ ${end} 工作周报`,
    '',
    `**投入** ${fmtHours(total)}h · **活跃天数** ${days.length} · **条目** ${list.length}`,
    '',
    '## 项目投入',
    '',
    '| 项目 | 工时 | 条目 |',
    '| --- | ---: | ---: |',
  ]

  const byProject = new Map<string, { h: number; c: number }>()
  list.forEach((e) => {
    const name = projectName(ctx.projects, e.projectId)
    const cur = byProject.get(name) || { h: 0, c: 0 }
    cur.h += e.hours || 0
    cur.c += 1
    byProject.set(name, cur)
  })
  ;[...byProject.entries()]
    .sort((a, b) => b[1].h - a[1].h)
    .forEach(([name, v]) => lines.push(`| ${name} | ${fmtHours(v.h)}h | ${v.c} |`))

  lines.push('', '## 每日记录', '')
  days.forEach((d) => {
    const dayList = list.filter((e) => e.date === d)
    lines.push(`### ${d} · ${fmtHours(sumHours(dayList))}h`, '')
    lines.push(dayList.map(entryLine).join('\n'))
    const s = ctx.days.find((x) => x.date === d)?.summary
    if (s) lines.push('', `> ${s.replace(/\n/g, '\n> ')}`)
    lines.push('')
  })
  if (!days.length) lines.push('_这一周还没有记录。_', '')

  lines.push('## 下周计划', '', '- [ ] ', '')
  return lines.join('\n')
}

export function monthlyMarkdown(cursor: Date, ctx: Ctx): string {
  const { start, end } = monthRange(cursor)
  const list = ctx.entries.filter((e) => e.date >= start && e.date <= end)
  const total = sumHours(list)
  const dayCount = new Set(list.map((e) => e.date)).size
  const done = list.filter((e) => e.status === 'done').length
  const label = `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`

  const lines = [
    `# ${label} 工作月报`,
    '',
    `**投入** ${fmtHours(total)}h · **活跃天数** ${dayCount} · **日均** ${fmtHours(dayCount ? total / dayCount : 0)}h · **完成** ${done}/${list.length}`,
    '',
    '## 项目投入',
    '',
    '| 项目 | 工时 | 占比 | 条目 |',
    '| --- | ---: | ---: | ---: |',
  ]

  const byProject = new Map<string, { h: number; c: number }>()
  list.forEach((e) => {
    const name = projectName(ctx.projects, e.projectId)
    const cur = byProject.get(name) || { h: 0, c: 0 }
    cur.h += e.hours || 0
    cur.c += 1
    byProject.set(name, cur)
  })
  const sorted = [...byProject.entries()].sort((a, b) => b[1].h - a[1].h)
  sorted.forEach(([name, v]) => {
    lines.push(`| ${name} | ${fmtHours(v.h)}h | ${total ? Math.round(v.h / total * 100) : 0}% | ${v.c} |`)
  })
  if (!sorted.length) lines.push('| — | 0 | 0% | 0 |')

  lines.push('', '## 重要记录', '')
  const highlights = [...list]
    .sort((a, b) => (b.priority - a.priority) || (b.hours - a.hours))
    .slice(0, 8)
  if (highlights.length) lines.push(highlights.map((e) => `- ${e.date} · ${e.title}（${fmtHours(e.hours)}h · ${projectName(ctx.projects, e.projectId)}）`).join('\n'))
  else lines.push('_本月还没有记录。_')

  lines.push('', '## 月度总结', '')
  const summaries = ctx.days.filter((d) => d.date >= start && d.date <= end)
  if (summaries.length) {
    summaries.forEach((d) => lines.push(`- **${d.date}**：${d.summary}`))
  } else {
    lines.push('_没有填写当日总结。_')
  }
  lines.push('')
  return lines.join('\n')
}

export function allEntriesMarkdown(ctx: Ctx): string {
  const dates = [...new Set(ctx.entries.map((e) => e.date))].sort().reverse()
  const lines = ['# 全部工作记录', '', `导出时间：${new Date().toLocaleString('zh-CN')}`, '']
  dates.forEach((d) => {
    const list = ctx.entries.filter((e) => e.date === d)
    lines.push(`## ${d} · ${fmtHours(sumHours(list))}h`, '')
    lines.push(list.map(entryLine).join('\n'))
    lines.push('')
  })
  return lines.join('\n')
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  }
}

export function downloadText(text: string, filename: string, mime = 'text/markdown'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function defaultRangeDates(cursor: Date, kind: 'day' | 'week' | 'month', today: string): string {
  if (kind === 'day') return today
  if (kind === 'week') return keyOf(startOfWeek(fromKey(today), { weekStartsOn: 1 }))
  return keyOf(addDays(cursor, 0))
}
