/** Edge 皮肤（灵感 / 复盘）用的小工具：转义、去标签、相对时间、搜索高亮 */

export function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

export function stripHtml(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = String(html || '')
  div.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  div.querySelectorAll('p,div,li').forEach((el) => el.append('\n'))
  return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

export function clipText(s: string, n = 30): string {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

export function relTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day === 1) return '昨天'
  if (day < 7) return `${day} 天前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function fmtDay(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}.${d.getDate()}`
}

export function fmtPnl(v: number): string {
  const n = Number(v)
  if (!isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(Math.abs(n) >= 100 ? 0 : 2)}`
}

/** 搜索词高亮：先转义再套 mark，避免把正文里的 HTML 当标签执行 */
export function highlight(text: string, query: string): string {
  const safe = esc(text)
  const q = String(query || '').trim()
  if (!q) return safe
  const pattern = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return safe.replace(new RegExp(pattern, 'gi'), (m) => `<mark>${m}</mark>`)
}

/**
 * 正文里写 @12 或 [[标题]] 的引用，在阅读页里变成可点的 chip。
 * 这里只做「把出现过的 @序号 收集起来」，真正的跳转按序号查。
 */
export function refSeqs(html: string): number[] {
  const set = new Set<number>()
  for (const m of String(html || '').matchAll(/@(\d{1,5})/g)) set.add(Number(m[1]))
  return [...set]
}

export function escapeNewlines(text: string): string {
  return esc(text).replace(/\r?\n/g, '<br>')
}

export function isBaseTag(tags: string[], baseTag = '底线'): boolean {
  return tags.includes(baseTag)
}

export function pnlClass(v: number | null | undefined): string {
  if (typeof v !== 'number' || !v) return ''
  return v > 0 ? 'up' : 'down'
}
