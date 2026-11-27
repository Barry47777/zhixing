import {
  addDays, addMonths, endOfMonth, endOfWeek, format, isSameDay,
  isSameMonth, parseISO, startOfMonth, startOfWeek,
} from 'date-fns'
import { zhCN } from 'date-fns/locale'

export const WEEKDAY_LABELS_SUN = ['日', '一', '二', '三', '四', '五', '六']

export function keyOf(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

export function fromKey(key: string): Date {
  return parseISO(key)
}

export function todayKey(): string {
  return keyOf(new Date())
}

export function weekdayLabels(weekStartsOn: 0 | 1): string[] {
  return weekStartsOn === 1
    ? ['一', '二', '三', '四', '五', '六', '日']
    : WEEKDAY_LABELS_SUN
}

export interface MonthCell {
  key: string
  day: number
  date: Date
  inMonth: boolean
  isToday: boolean
  isWeekend: boolean
}

/** 生成 6×7 的月历矩阵，保证任何月份高度一致，布局不跳动 */
export function monthMatrix(cursor: Date, weekStartsOn: 0 | 1): MonthCell[] {
  const first = startOfMonth(cursor)
  const gridStart = startOfWeek(first, { weekStartsOn })
  const today = new Date()
  const cells: MonthCell[] = []
  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i)
    cells.push({
      key: keyOf(date),
      day: date.getDate(),
      date,
      inMonth: isSameMonth(date, first),
      isToday: isSameDay(date, today),
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
    })
  }
  return cells
}

export function monthLabel(cursor: Date): string {
  return format(cursor, 'yyyy 年 M 月', { locale: zhCN })
}

export function shiftMonth(cursor: Date, delta: number): Date {
  return startOfMonth(addMonths(cursor, delta))
}

export function dayLabel(key: string): string {
  const d = fromKey(key)
  return format(d, 'M 月 d 日 EEEE', { locale: zhCN })
}

export function shortDayLabel(key: string): string {
  return format(fromKey(key), 'M/d')
}

export function weekRangeLabel(date: Date, weekStartsOn: 0 | 1): string {
  const s = startOfWeek(date, { weekStartsOn })
  const e = endOfWeek(date, { weekStartsOn })
  return `${format(s, 'M/d')} – ${format(e, 'M/d')}`
}

export function monthRange(cursor: Date): { start: string; end: string } {
  return {
    start: keyOf(startOfMonth(cursor)),
    end: keyOf(endOfMonth(cursor)),
  }
}

export function weekRange(date: Date, weekStartsOn: 0 | 1): { start: string; end: string } {
  return {
    start: keyOf(startOfWeek(date, { weekStartsOn })),
    end: keyOf(endOfWeek(date, { weekStartsOn })),
  }
}

export function daysBetweenKeys(a: string, b: string): number {
  return Math.round((fromKey(a).getTime() - fromKey(b).getTime()) / 86400000)
}

/** 用于「连续记录天数」计算 */
export function prevKey(key: string): string {
  return keyOf(addDays(fromKey(key), -1))
}

export function isFutureKey(key: string): boolean {
  return key > todayKey()
}

export function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return '夜深了'
  if (h < 9) return '早上好'
  if (h < 12) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

/* 供其他模块复用的 date-fns 封装 */
export { addDays, addMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameMonth } from 'date-fns'

/** 距离今天的天数，正数为未来，负数为过去 */
export function daysFromToday(key: string): number {
  const base = fromKey(todayKey()).getTime()
  return Math.round((fromKey(key).getTime() - base) / 86400000)
}

/** 12 月 20 日 */
export function shortDate(key: string): string {
  return format(fromKey(key), 'M 月 d 日')
}
