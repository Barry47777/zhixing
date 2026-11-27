/**
 * 访问地址归一化。
 *
 * 浏览器的 IndexedDB 按「协议 + 主机 + 端口」三部分隔离，任何一项不同都是
 * 一个新的空数据库。最常见的坑是同一个服务用 localhost 和 127.0.0.1 分别打开过，
 * 用户会以为「数据没了」，其实是两套库。
 *
 * 这里强制把 localhost 跳到 127.0.0.1，保证一个应用永远只有一个入口地址。
 */

export const CANONICAL_HOST = '127.0.0.1'

/** 当前 origin 是否就是规范地址 */
export function isCanonicalOrigin(): boolean {
  if (typeof location === 'undefined') return true
  return location.hostname === CANONICAL_HOST
}

/**
 * 如果不是规范地址就跳转过去，返回 true 表示已经发起跳转、调用方应停止启动。
 * 路径、查询串和 hash（hash 路由）都会保留。
 */
export function enforceCanonicalOrigin(): boolean {
  if (typeof location === 'undefined') return false
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return false
  if (location.hostname !== 'localhost') return false

  const url = new URL(location.href)
  url.hostname = CANONICAL_HOST
  // 带上标记，跳转完成后提示一次，避免用户以为页面抽风
  url.searchParams.set('unified', '1')
  location.replace(url.toString())
  return true
}

/** 供界面显示：当前数据所在的完整地址 */
export function currentOrigin(): string {
  return typeof location === 'undefined' ? '' : location.origin
}
