/** 知行 · 本机账户状态与会话保活 */

import { reactive } from 'vue'

export interface AuthStatus {
  configured: boolean
  authenticated: boolean
  username: string | null
  autoLockMinutes: number | null
  remainingMs: number
}

export const auth = reactive<AuthStatus>({
  configured: true,
  authenticated: true,
  username: null,
  autoLockMinutes: null,
  remainingMs: 0,
})

export function goLogin(): void {
  if (typeof location === 'undefined') return
  if (location.pathname.endsWith('/login.html')) return
  location.replace('/login.html')
}

async function post(path: string, body: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok === false) throw new Error(data?.error || '操作失败')
  return data
}

export async function refreshAuthStatus(): Promise<AuthStatus> {
  const res = await fetch('/api/auth/status', { cache: 'no-store', credentials: 'same-origin' })
  const data = await res.json()
  Object.assign(auth, data)
  if (!auth.authenticated) goLogin()
  return auth
}

/** 立即锁定：服务端销毁全部会话，回到登录页 */
export async function lockNow(): Promise<void> {
  try { await post('lock') } catch (_) { /* 服务端异常也要回登录页 */ }
  goLogin()
}

export async function logoutNow(): Promise<void> {
  try { await post('logout') } catch (_) { /* 同上 */ }
  goLogin()
}

export const authApi = {
  password: (oldPassword: string, newPassword: string) => post('password', { oldPassword, newPassword }),
  recovery: (password: string) => post('recovery', { password }),
  autoLock: (minutes: number) => post('autolock', { minutes }),
  ping: () => post('ping'),
}

let watching = false
let lastPing = 0

/** 有人在操作就续期；切到后台不续，空闲到点自动锁定并盖住界面 */
export function startAuthWatch(): void {
  if (watching || typeof window === 'undefined') return
  watching = true

  const ping = () => {
    const now = Date.now()
    if (now - lastPing < 60_000) return
    lastPing = now
    void authApi.ping().then((d) => {
      auth.remainingMs = Number(d?.remainingMs) || 0
    }).catch(() => { /* 401 由 http 层统一处理 */ })
  }

  for (const ev of ['pointerdown', 'keydown', 'wheel']) {
    window.addEventListener(ev, ping, { passive: true })
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ping()
  })
  window.addEventListener('focus', ping)

  // 服务端会拒绝过期会话；这里主动把屏幕切回登录页，避免离开后界面一直亮着。
  // 用 /check（不续期）而不是 /status（会续期），否则轮询自己就把会话一直点亮了。
  window.setInterval(() => {
    void fetch('/api/auth/check', { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => { if (d && d.authenticated === false) goLogin() })
      .catch(() => { /* 网络异常时等下一次 */ })
  }, 12_000)
}
