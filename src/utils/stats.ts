import type { Entry, Project } from '../types.studio'
import { addDays, keyOf, startOfWeek } from '../utils/date'

export function sumHours(entries: Entry[]): number {
  return entries.reduce((s, e) => s + (e.hours || 0), 0)
}

export function nextOrder(projects: Project[]): number {
  return projects.reduce((max, p) => Math.max(max, p.order), -1) + 1
}

export interface Stats {
  total: number
  count: number
  dayCount: number
  avgPerActiveDay: number
  avgPerDay: number
  doneCount: number
  doingCount: number
  blockedCount: number
  hoursByDay: Record<string, number>
  byProject: Record<string, number>
}

export function statsOf(entries: Entry[], daysInRange = 1): Stats {
  const hoursByDay: Record<string, number> = {}
  const byProject: Record<string, number> = {}
  let doneCount = 0
  let doingCount = 0
  let blockedCount = 0

  entries.forEach((e) => {
    const h = e.hours || 0
    hoursByDay[e.date] = (hoursByDay[e.date] || 0) + h
    const pid = e.projectId || '__none'
    byProject[pid] = (byProject[pid] || 0) + h
    if (e.status === 'done') doneCount += 1
    else if (e.status === 'doing') doingCount += 1
    else blockedCount += 1
  })

  const total = sumHours(entries)
  const dayCount = Object.keys(hoursByDay).length
  return {
    total,
    count: entries.length,
    dayCount,
    avgPerActiveDay: dayCount ? total / dayCount : 0,
    avgPerDay: daysInRange ? total / daysInRange : 0,
    doneCount,
    doingCount,
    blockedCount,
    hoursByDay,
    byProject,
  }
}

export interface HeatCell {
  key: string
  hours: number
  level: 0 | 1 | 2 | 3 | 4
  inRange: boolean
}

/** columns × 7 的热力图，每列是一周 */
export function heatmap(entries: Entry[], weeks: number, weekStartsOn: 0 | 1): HeatCell[][] {
  const hoursByDay: Record<string, number> = {}
  entries.forEach((e) => { hoursByDay[e.date] = (hoursByDay[e.date] || 0) + (e.hours || 0) })

  const today = new Date()
  const thisWeekStart = startOfWeek(today, { weekStartsOn })
  const firstStart = addDays(thisWeekStart, -(weeks - 1) * 7)
  const todayK = keyOf(today)

  const columns: HeatCell[][] = []
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = []
    for (let d = 0; d < 7; d++) {
      const date = addDays(firstStart, w * 7 + d)
      const key = keyOf(date)
      const hours = hoursByDay[key] || 0
      let level: HeatCell['level'] = 0
      if (hours > 0) {
        level = hours >= 6 ? 4 : hours >= 4 ? 3 : hours >= 2 ? 2 : 1
      }
      col.push({ key, hours, level, inRange: key <= todayK })
    }
    columns.push(col)
  }
  return columns
}

export interface WeekPoint {
  start: string
  label: string
  hours: number
  days: number[]
}

export function weeklySeries(entries: Entry[], weeks: number, weekStartsOn: 0 | 1): WeekPoint[] {
  const hoursByDay: Record<string, number> = {}
  entries.forEach((e) => { hoursByDay[e.date] = (hoursByDay[e.date] || 0) + (e.hours || 0) })

  const thisWeekStart = startOfWeek(new Date(), { weekStartsOn })
  const points: WeekPoint[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(thisWeekStart, -i * 7)
    const days: number[] = []
    for (let d = 0; d < 7; d++) days.push(hoursByDay[keyOf(addDays(start, d))] || 0)
    points.push({
      start: keyOf(start),
      label: `${start.getMonth() + 1}/${start.getDate()}`,
      hours: days.reduce((s, v) => s + v, 0),
      days,
    })
  }
  return points
}

/** 连续记录天数（今天没记录时从昨天往前算） */
export function streakDays(entries: Entry[]): number {
  const days = new Set(entries.map((e) => e.date))
  const today = new Date()
  let cursor = days.has(keyOf(today)) ? today : addDays(today, -1)
  if (!days.has(keyOf(cursor))) return 0
  let count = 0
  while (days.has(keyOf(cursor)) && count < 3650) {
    count += 1
    cursor = addDays(cursor, -1)
  }
  return count
}

export function topEntries(entries: Entry[], limit = 6): Entry[] {
  return [...entries].sort((a, b) => (b.hours || 0) - (a.hours || 0)).slice(0, limit)
}

export function projectDistribution(entries: Entry[], projects: Project[]) {
  const stats = statsOf(entries)
  return projects
    .map((p) => ({
      project: p,
      hours: stats.byProject[p.id] || 0,
      count: entries.filter((e) => e.projectId === p.id).length,
    }))
    .filter((x) => x.hours > 0)
    .sort((a, b) => b.hours - a.hours)
}
