<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '../base/Icon.vue'
import { activeEntries, data } from '../../stores/data'
import { session, setCursor } from '../../stores/session'
import { settings, patchSettings, resolvedTheme } from '../../stores/settings'
import { todayKey, weekdayLabels, keyOf } from '../../utils/date'
import { fmtHours } from '../../utils/format'
import { startOfWeek, addDays } from 'date-fns'
import { home, setHomeEditing } from '../../stores/home'
import { auth, lockNow } from '../../stores/auth'

const route = useRoute()
const router = useRouter()

/* 工作区五项与 Studio Log 原版一致；灵感/复盘单独成组，避免两套皮肤混在一起 */
const nav = [
  { path: '/calendar', label: '日历', icon: 'calendar', key: '1' },
  { path: '/insights', label: '统计', icon: 'chart', key: '2' },
  { path: '/projects', label: '项目', icon: 'folder', key: '3' },
]

const thinkNav = [
  { path: '/notes', label: '灵感', icon: 'spark', key: '4' },
  { path: '/review', label: '复盘', icon: 'review', key: '5' },
]

const mobileNav = [...nav, ...thinkNav]

const weekStart = computed(() => startOfWeek(new Date(), { weekStartsOn: settings.weekStartsOn }))

const weekDays = computed(() => Array.from({ length: 7 }, (_, i) => {
  const date = addDays(weekStart.value, i)
  const key = keyOf(date)
  const hours = activeEntries.value
    .filter((e) => e.date === key)
    .reduce((s, e) => s + e.hours, 0)
  return { key, label: weekdayLabels(settings.weekStartsOn)[i], hours, isToday: key === todayKey() }
}))

const weekTotal = computed(() => weekDays.value.reduce((s, d) => s + d.hours, 0))

const weekTarget = computed(() => {
  const sum = data.projects
    .filter((p) => p.status === 'active')
    .reduce((s, p) => s + (p.weeklyTarget || 0), 0)
  return sum || settings.dailyGoal * 5
})

const weekPct = computed(() => Math.min(100, Math.round(weekTotal.value / Math.max(1, weekTarget.value) * 100)))
const peak = computed(() => Math.max(1, ...weekDays.value.map((d) => d.hours)))

const monthPrefix = computed(() => `${session.cursor.getFullYear()}-${String(session.cursor.getMonth() + 1).padStart(2, '0')}`)

const projectList = computed(() => data.projects
  .filter((p) => p.status !== 'archived')
  .slice(0, 6)
  .map((p) => ({
    ...p,
    hours: activeEntries.value
      .filter((e) => e.projectId === p.id && e.date.startsWith(monthPrefix.value))
      .reduce((s, e) => s + e.hours, 0),
  })))

function filterBy(id: string) {
  session.filterProject = session.filterProject === id ? null : id
  if (route.path !== '/calendar') router.push('/calendar')
}

function toggleTheme() {
  const next = resolvedTheme() === 'dark' ? 'light' : 'dark'
  void patchSettings({ theme: next })
}

function goToday() {
  setCursor(new Date())
  session.selected = todayKey()
  setHomeEditing(false)
  router.push('/today')
}

function customizeHome() {
  setCursor(new Date())
  session.selected = todayKey()
  home.editing = true
  router.push('/today')
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-logo">
        <Icon name="calendar" :size="17" :stroke-width="1.9" />
      </div>
      <div class="brand-text">
        <div class="brand-name">知行</div>
        <div class="brand-sub">工作与思考</div>
      </div>
    </div>

    <nav class="nav">
      <button
        v-for="item in nav"
        :key="item.path"
        class="nav-item"
        :class="{ 'is-on': route.path === item.path }"
        @click="router.push(item.path)"
      >
        <Icon :name="item.icon" :size="17" />
        <span>{{ item.label }}</span>
        <kbd>{{ item.key }}</kbd>
      </button>

      <div class="nav-sep"><span>思维区</span></div>

      <button
        v-for="item in thinkNav"
        :key="item.path"
        class="nav-item edge-link"
        :class="{ 'is-on': route.path === item.path }"
        @click="router.push(item.path)"
      >
        <Icon :name="item.icon" :size="17" />
        <span>{{ item.label }}</span>
        <small>↗</small>
        <kbd>{{ item.key }}</kbd>
      </button>
    </nav>

    <div class="side-scroll">
      <section class="side-block week">
        <div class="week-head">
          <span class="side-label">本周</span>
          <div class="week-links">
            <button class="text-btn" @click="goToday">回到今天</button>
            <button class="text-btn is-custom" title="定制首页模块" @click="customizeHome">
              <Icon name="layout" :size="12" /> 定制
            </button>
          </div>
        </div>
        <div class="week-num">
          <strong>{{ fmtHours(weekTotal) }}</strong>
          <span>/ {{ fmtHours(weekTarget) }} h</span>
        </div>
        <div class="week-bar"><i :style="{ width: weekPct + '%' }" /></div>
        <div class="week-days">
          <div v-for="d in weekDays" :key="d.key" class="wd" :class="{ 'is-today': d.isToday }">
            <div class="wd-track">
              <i :style="{ height: Math.max(2, d.hours / peak * 100) + '%' }" />
            </div>
            <span>{{ d.label }}</span>
          </div>
        </div>
      </section>

      <section class="side-block projects">
        <div class="week-head">
          <span class="side-label">项目</span>
          <button class="text-btn" @click="router.push('/projects')">管理</button>
        </div>
        <button
          v-for="p in projectList"
          :key="p.id"
          class="proj-row"
          :class="{ 'is-on': session.filterProject === p.id }"
          @click="filterBy(p.id)"
        >
          <span class="dot" :style="{ background: p.color }" />
          <span class="proj-row-name">{{ p.name }}</span>
          <span class="proj-row-hours">{{ p.hours ? fmtHours(p.hours) : '—' }}</span>
        </button>
        <p v-if="!projectList.length" class="side-empty">还没有项目</p>
      </section>
    </div>

    <div class="side-foot">
      <div class="account-row">
        <span class="avatar">{{ (auth.username || '知').slice(0, 1).toUpperCase() }}</span>
        <span class="account-meta">
          <b>{{ auth.username || '本机账户' }}</b>
          <small>已登录 · 仅本机</small>
        </span>
        <button class="lock-btn" title="立即锁定（回到登录页）" aria-label="立即锁定" @click="lockNow">
          <Icon name="lock" :size="14" />
        </button>
      </div>
      <button class="foot-btn" title="切换主题" @click="toggleTheme">
        <Icon :name="resolvedTheme() === 'dark' ? 'sun' : 'moon'" :size="16" />
        <span>{{ resolvedTheme() === 'dark' ? '浅色模式' : '深色模式' }}</span>
      </button>
      <button class="foot-btn" :class="{ 'is-on': route.path === '/settings' }" @click="router.push('/settings')">
        <Icon name="settings" :size="16" />
        <span>设置与数据</span>
        <kbd>6</kbd>
      </button>
    </div>
  </aside>

  <!-- 移动端底栏 -->
  <nav class="mobile-nav">
    <button
      v-for="item in mobileNav"
      :key="item.path"
      class="mn-item"
      :class="{ 'is-on': route.path === item.path }"
      @click="router.push(item.path)"
    >
      <Icon :name="item.icon" :size="19" />
      <span>{{ item.label }}</span>
    </button>
    <button class="mn-item" :class="{ 'is-on': route.path === '/settings' }" @click="router.push('/settings')">
      <Icon name="settings" :size="19" />
      <span>设置</span>
    </button>
  </nav>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 12px 12px;
  background: var(--panel);
  border-right: 1px solid var(--line);
  height: 100%;
  overflow: hidden;
  z-index: 20;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 8px 0;
}
.brand-logo {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: #fff;
  background: linear-gradient(145deg, var(--accent), color-mix(in srgb, var(--accent) 62%, #7b3fe4));
  box-shadow: 0 6px 14px -8px var(--accent);
  flex: none;
}
.brand-name { font-size: 13.5px; font-weight: 650; letter-spacing: -.01em; line-height: 1.2; }
.brand-sub { font-size: 10.5px; color: var(--muted); letter-spacing: .04em; }

.nav { display: flex; flex-direction: column; gap: 1px; }
.nav-sep {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 13px 9px 4px;
  font-size: 9.5px;
  font-weight: 650;
  letter-spacing: .14em;
  color: var(--faint);
}
.nav-sep::after { content: ""; flex: 1; height: 1px; background: var(--line-soft); }
.edge-link small { margin-left: 2px; font-size: 10px; color: var(--faint); }
.edge-link.is-on small { color: var(--accent); }
.nav-item kbd { margin-left: auto; }
.edge-link small + kbd { margin-left: 6px; }
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 35px;
  padding: 0 9px;
  border-radius: 9px;
  color: var(--ink-2);
  font-size: 13px;
  transition: background .14s, color .14s;
}
.nav-item:hover { background: var(--bg-soft); }
.nav-item.is-on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.nav-item kbd {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--faint);
  background: var(--bg-soft);
  border-radius: 4px;
  padding: 1px 4px;
  line-height: 1.4;
}
.nav-item.is-on kbd { background: transparent; color: var(--accent); opacity: .7; }

.side-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0 -2px;
  padding: 0 2px;
}

.side-block {
  background: var(--panel-2);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-md);
  padding: 11px 11px 12px;
}
.week-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.side-label {
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--muted);
}
.text-btn { font-size: 10.5px; color: var(--muted); padding: 2px 0; }
.text-btn:hover { color: var(--accent); }
.week-links { display: flex; align-items: center; gap: 9px; }
.week-links .is-custom { display: inline-flex; align-items: center; gap: 3px; }

.week-num { display: flex; align-items: baseline; gap: 4px; }
.week-num strong { font-size: 21px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.week-num span { font-size: 11px; color: var(--muted); }

.week-bar {
  height: 4px;
  border-radius: 99px;
  background: var(--line);
  margin: 7px 0 9px;
  overflow: hidden;
}
.week-bar i {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: var(--accent);
  transition: width .5s cubic-bezier(.2, .8, .2, 1);
}

.week-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.wd { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.wd-track {
  width: 100%;
  height: 26px;
  display: flex;
  align-items: flex-end;
  background: var(--line-soft);
  border-radius: 3px;
  overflow: hidden;
}
.wd-track i {
  display: block;
  width: 100%;
  background: color-mix(in srgb, var(--ink) 26%, transparent);
  border-radius: 3px;
  transition: height .4s;
}
.wd span { font-size: 9px; color: var(--faint); }
.wd.is-today span { color: var(--accent); font-weight: 700; }
.wd.is-today .wd-track i { background: var(--accent); }
[data-theme="dark"] .wd-track { background: #232833; }

.proj-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 26px;
  padding: 0 4px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--ink-2);
}
.proj-row:hover { background: var(--panel); }
.proj-row.is-on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.proj-row-name { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.proj-row-hours { font-size: 10.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.side-empty { font-size: 11.5px; color: var(--faint); padding: 4px; }

.side-foot { display: flex; flex-direction: column; gap: 1px; border-top: 1px solid var(--line-soft); padding-top: 8px; }
.account-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 6px 8px; margin-bottom: 4px;
  border-bottom: 1px solid var(--line-soft);
}
.account-row .avatar {
  flex: none; width: 26px; height: 26px; border-radius: 8px;
  display: grid; place-items: center;
  background: var(--accent-soft); color: var(--accent);
  font-size: 11px; font-weight: 700;
}
.account-meta { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; }
.account-meta b { font-size: 11.5px; font-weight: 620; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.account-meta small { font-size: 9.5px; color: var(--faint); }
.lock-btn {
  flex: none; margin-left: auto; width: 26px; height: 26px;
  display: grid; place-items: center; border: 1px solid var(--line);
  border-radius: 7px; background: transparent; color: var(--muted); cursor: pointer;
  transition: color .15s, border-color .15s, background .15s;
}
.lock-btn:hover { color: var(--danger); border-color: var(--danger); background: rgba(216,68,63,.07); }
.foot-btn {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 31px;
  padding: 0 8px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--muted);
}
.foot-btn:hover { background: var(--bg-soft); color: var(--ink-2); }
.foot-btn.is-on { background: var(--accent-soft); color: var(--accent); }
.foot-btn kbd {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--faint);
  background: var(--bg-soft);
  border-radius: 4px;
  padding: 1px 4px;
  line-height: 1.4;
}

.mobile-nav { display: none; }

@media (max-width: 760px) {
  .sidebar {
    display: none;
  }
  .mobile-nav {
    display: flex;
    grid-row: 2;
    align-items: center;
    gap: 0;
    height: 58px;
    padding: 0 4px;
    border-top: 1px solid var(--line);
    background: var(--panel);
    padding-bottom: env(safe-area-inset-bottom);
    z-index: 40;
  }
  .mn-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    height: 48px;
    font-size: 10px;
    color: var(--muted);
    border-radius: 9px;
  }
  .mn-item.is-on { color: var(--accent); font-weight: 600; }
}
</style>
