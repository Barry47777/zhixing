/** 数字、工时、文件大小等展示格式化 */

export function fmtHours(h: number): string {
  if (!h) return '0'
  const rounded = Math.round(h * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function fmtHoursUnit(h: number): string {
  return `${fmtHours(h)}h`
}

export function fmtDuration(h: number): string {
  if (!h) return '0 分钟'
  const total = Math.round(h * 60)
  const hh = Math.floor(total / 60)
  const mm = total % 60
  if (!hh) return `${mm} 分钟`
  if (!mm) return `${hh} 小时`
  return `${hh} 小时 ${mm} 分`
}

export function fmtPct(v: number): string {
  if (!isFinite(v)) return '0%'
  return `${Math.round(v * 100)}%`
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

export function splitTags(input: string): string[] {
  return input
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8)
}

export function uid(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 9)
  return `${prefix}${Date.now().toString(36)}${rand}`
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
