<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SideBar from './components/layout/SideBar.vue'
import TopBar from './components/layout/TopBar.vue'
import ToastHost from './components/base/ToastHost.vue'
import ConfirmHost from './components/base/ConfirmHost.vue'
import DayDrawer from './components/calendar/DayDrawer.vue'
import Icon from './components/base/Icon.vue'
import { app, initApp, resolvedTheme } from './stores/app'
import { edgeTheme } from './stores/edge'
import { initData } from './stores/data'
import { refreshWorkspace } from './stores/workspace'
import { toast } from './stores/ui'
import { auth, refreshAuthStatus, startAuthWatch } from './stores/auth'
import { IS_WEB } from './api/http'
import { openDrawer, session, setCursor } from './stores/session'
import { todayKey, shiftMonth } from './utils/date'

const route = useRoute()
const router = useRouter()

const booting = ref(true)
const bootError = ref('')
const retryCount = ref(0)

/** 工作区用 Studio 皮肤，灵感/复盘用 Edge 皮肤 */
const skin = computed<'studio' | 'edge'>(() => (route.meta.skin === 'edge' ? 'edge' : 'studio'))

/** 全局主题初始化比路由 watch 晚，所以这里统一在每次变更后重新落一次 data-theme */
function syncTheme(): void {
  document.documentElement.dataset.skin = skin.value
  document.documentElement.dataset.theme = skin.value === 'edge' ? edgeTheme.value : resolvedTheme.value
  document.documentElement.dataset.zone = skin.value === 'edge' ? String(route.meta.zone || 'inspiration') : ''
}

watch([skin, resolvedTheme, edgeTheme], syncTheme, { immediate: true })

watch(() => route.meta.zone, (z) => {
  if (skin.value === 'edge') document.documentElement.dataset.zone = String(z || 'inspiration')
})

async function boot() {
  booting.value = true
  bootError.value = ''
  try {
    if (!IS_WEB) {
      await refreshAuthStatus()
      if (!auth.authenticated) return
    }
    await initApp()
    syncTheme()
    await initData()
    void refreshWorkspace()
  } catch (e: any) {
    bootError.value = e?.message || '无法连接本地服务'
  } finally {
    booting.value = false
  }
}

async function retry() {
  retryCount.value += 1
  await boot()
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable
}

function onKeydown(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (isTyping(e.target)) {
    if (e.key === 'Escape') (e.target as HTMLElement).blur()
    return
  }
  if (e.key === 'Escape') return

  const map: Record<string, string> = {
    '1': '/calendar', '2': '/insights', '3': '/projects',
    '4': '/notes', '5': '/review', '6': '/settings',
  }
  if (map[e.key] && route.path !== map[e.key]) {
    e.preventDefault()
    router.push(map[e.key])
    return
  }

  if (e.key === 'n' || e.key === 'N') {
    if (route.path === '/notes' || route.path === '/review') return
    e.preventDefault()
    openDrawer(todayKey())
    return
  }
  if (e.key === 't' || e.key === 'T') {
    e.preventDefault()
    setCursor(new Date())
    session.selected = todayKey()
    return
  }
  if (e.key === '/' && skin.value === 'studio') {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('#global-search')?.focus()
    return
  }
  if (e.key === 'ArrowLeft' && ['/calendar', '/insights', '/projects'].includes(route.path)) {
    e.preventDefault()
    setCursor(shiftMonth(session.cursor, -1))
  }
  if (e.key === 'ArrowRight' && ['/calendar', '/insights', '/projects'].includes(route.path)) {
    e.preventDefault()
    setCursor(shiftMonth(session.cursor, 1))
  }
}

onMounted(async () => {
  if (!IS_WEB) startAuthWatch()
  await boot()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div v-if="booting" class="boot">
    <div class="boot-mark">
      <Icon name="calendar" :size="26" />
    </div>
    <p class="boot-title">知行</p>
    <p class="boot-sub">正在打开你的工作台…</p>
  </div>

  <div v-else-if="bootError" class="boot">
    <div class="boot-mark is-error"><Icon name="alert" :size="24" /></div>
    <p class="boot-title">数据打不开</p>
    <p class="boot-sub">{{ bootError }}</p>
    <p class="boot-hint">知行的数据存本机，需要本地服务在运行。请在项目目录执行 <code>npm start</code>，或双击 <code>start.cmd</code>。</p>
    <button class="btn primary" style="margin-top: 14px" @click="retry">
      <Icon name="restore" :size="15" /> 重新连接
    </button>
  </div>

  <template v-else>
    <div v-if="skin === 'edge'" class="edge-app">
      <RouterView />
    </div>

    <div v-else class="app">
      <SideBar />
      <main class="main">
        <TopBar />
        <RouterView v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>
      <DayDrawer />
    </div>

    <ToastHost />
    <ConfirmHost />
  </template>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  height: 100dvh;
  background: var(--bg);
}

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.edge-app {
  height: 100dvh;
  overflow-y: auto;
  overflow-x: hidden;
}

.page-enter-active,
.page-leave-active { transition: opacity .14s ease, transform .14s ease; }
.page-enter-from { opacity: 0; transform: translateY(4px); }
.page-leave-to { opacity: 0; }

.boot {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 24px;
  text-align: center;
  background: var(--bg);
  color: var(--ink);
}
.boot-mark {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  color: #fff;
  background: linear-gradient(145deg, var(--accent), color-mix(in srgb, var(--accent) 62%, #7b3fe4));
  box-shadow: 0 10px 24px -12px var(--accent);
  margin-bottom: 4px;
}
.boot-mark.is-error { background: var(--danger); box-shadow: none; }
.boot-title { font-size: 17px; font-weight: 650; letter-spacing: -.01em; }
.boot-sub { font-size: 12.5px; color: var(--muted); max-width: 380px; line-height: 1.7; }
.boot-hint { font-size: 11.5px; color: var(--faint); max-width: 420px; line-height: 1.7; }
.boot-hint code {
  font-family: var(--mono);
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--bg-soft);
}

@media (max-width: 760px) {
  .app {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
  }
  .main { grid-row: 1; }
}
</style>
