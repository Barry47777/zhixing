import { toRaw } from 'vue'

/**
 * 写 IndexedDB 前必须把 Vue 的响应式代理剥掉。
 * IDB 的 structuredClone 无法克隆 Proxy（会抛 DataCloneError），
 * 而 reactive 数组/对象嵌套在记录里很常见。
 * Blob / File / Date 原样返回。
 */
export function toPlain<T>(value: T): T {
  const raw = toRaw(value)
  if (raw === null || typeof raw !== 'object') return raw
  if (raw instanceof Blob || raw instanceof Date || raw instanceof File) return raw
  if (Array.isArray(raw)) return raw.map((v) => toPlain(v)) as unknown as T

  const out: Record<string, unknown> = {}
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    out[key] = toPlain((raw as Record<string, unknown>)[key])
  }
  return out as T
}
