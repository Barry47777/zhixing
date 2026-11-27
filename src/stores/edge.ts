/**
 * 思维区（Edge 皮肤）自己的明暗偏好。
 *
 * 工作区跟随全局设置；灵感/复盘保留原版独立的主题开关，
 * 这样在 Edge 区点主题按钮不会被工作区的浅色设置覆盖。
 */
import { ref } from 'vue'

const KEY = 'zhixing.edge.theme'

function read(): 'light' | 'dark' {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch (_) {
    return 'dark'
  }
}

export const edgeTheme = ref<'light' | 'dark'>(read())

export function setEdgeTheme(next: 'light' | 'dark'): void {
  edgeTheme.value = next
  try { localStorage.setItem(KEY, next) } catch (_) { /* 私密模式 */ }
  if (document.documentElement.dataset.skin === 'edge') {
    document.documentElement.dataset.theme = next
  }
}
