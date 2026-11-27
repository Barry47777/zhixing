<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '../base/Icon.vue'
import { activeEntries, data, projectName, projectColor } from '../../stores/data'
import { openDrawer, session, setCursor } from '../../stores/session'
import { settings } from '../../stores/settings'
import { monthLabel, shiftMonth, todayKey, fromKey } from '../../utils/date'
import { fmtHours } from '../../utils/format'

const route = useRoute()
const router = useRouter()

const title = computed(() => String(route.meta.title || 'Studio Log'))
const subtitle = computed(() => String(route.meta.subtitle || ''))

const showMonth = computed(() => ['/calendar', '/stats', '/insights', '/projects'].includes(route.path))
const isCalendar = computed(() => route.path === '/calendar')

const search = ref('')
const focused = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)

watch(() => route.path, () => { search.value = ''; focused.value = false })

interface Hit {
  id: string
  date: string
  title: string
  sub: string
  color: string
  kind: 'entry' | 'day'
}

const hits = computed<Hit[]>(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return []
  const out: Hit[] = []
  for (const e of activeEntries.value) {
    const hay = `${e.title} ${e.note} ${e.tags.join(' ')} ${projectName(e.projectId)}`.toLowerCase()
    if (hay.includes(q)) {
      out.push({
        id: e.id,
        date: e.date,
        title: e.title,
        sub: `${e.date} · ${projectName(e.projectId)} · ${fmtHours(e.hours)}h`,
        color: projectColor(e.projectId),
        kind: 'entry',
      })
    }
    if (out.length >= 12) break
  }
  for (const d of data.days) {
    if (out.length >= 16) break
    if (d.summary.toLowerCase().includes(q)) {
      out.push({
        id: d.date,
        date: d.date,
        title: d.summary.slice(0, 40),
        sub: `${d.date} · 当日总结`,
        color: 'var(--muted)',
        kind: 'day',
      })
    }
  }
  return out.slice(0, 10)
})

const showResults = computed(() => focused.value && search.value.trim().length > 0)

function goHit(hit: Hit) {
  setCursor(fromKey(hit.date))
  session.selected = hit.date
  search.value = ''
  focused.value = false
  if (route.path !== '/calendar') router.push('/calendar')
  openDrawer(hit.date)
}

function goToday() {
  setCursor(new Date())
  session.selected = todayKey()
}

function newEntry() {
  openDrawer(todayKey())
}

function onSearchKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && hits.value.length) goHit(hits.value[0])
  if (e.key === 'Escape') { search.value = ''; focused.value = false; searchInput.value?.blur() }
}
</script>

<template>
  <header class="topbar">
    <div class="tb-left">
      <h1>{{ title }}</h1>
      <p v-if="subtitle && isCalendar">{{ subtitle }}</p>
    </div>

    <div v-if="showMonth" class="month-switch">
      <button class="icon-btn" title="上一月" @click="setCursor(shiftMonth(session.cursor, -1))">
        <Icon name="left" :size="15" />
      </button>
      <button class="month-label" @click="goToday" title="回到本月">
        {{ monthLabel(session.cursor) }}
      </button>
      <button class="icon-btn" title="下一月" @click="setCursor(shiftMonth(session.cursor, 1))">
        <Icon name="right" :size="15" />
      </button>
      <span class="month-today" @click="goToday">今天</span>
    </div>

    <div class="tb-right">
      <div class="search-wrap">
        <Icon name="search" :size="15" class="search-icon" />
        <input
          id="global-search"
          ref="searchInput"
          v-model="search"
          class="search-input"
          type="text"
          placeholder="搜索…"
          autocomplete="off"
          @focus="focused = true"
          @blur="focused = false"
          @keydown="onSearchKey"
        />
        <kbd class="search-kbd">/</kbd>
      </div>

      <button class="btn primary" @click="newEntry">
        <Icon name="plus" :size="15" />
        <span>记录</span>
      </button>
    </div>

    <Transition name="fade">
      <div v-if="showResults" class="search-panel">
        <div v-if="!hits.length" class="search-empty">没有找到「{{ search }}」</div>
        <button v-for="hit in hits" :key="hit.kind + hit.id" class="search-hit" @mousedown.prevent="goHit(hit)">
          <span class="hit-bar" :style="{ background: hit.color }" />
          <span class="hit-main">
            <span class="hit-title">{{ hit.title }}</span>
            <span class="hit-sub">{{ hit.sub }}</span>
          </span>
          <Icon name="arrowRight" :size="14" class="hit-go" />
        </button>
        <div v-if="hits.length" class="search-foot">回车打开第一条 · 共 {{ hits.length }} 条</div>
      </div>
    </Transition>
  </header>
</template>

<style scoped>
.topbar {
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: 18px;
  padding: 18px 24px 12px;
  background: var(--bg);
  position: relative;
  z-index: 30;
}

.tb-left { flex: 1; min-width: 0; }
.tb-left h1 {
  font-size: 20px;
  font-weight: 660;
  letter-spacing: -.025em;
  line-height: 1.2;
}
.tb-left p { font-size: 11.5px; color: var(--muted); margin-top: 2px; }

.month-switch {
  display: flex;
  align-items: center;
  gap: 1px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 2px;
  box-shadow: var(--shadow-xs);
}
.month-label {
  padding: 0 8px;
  height: 28px;
  border-radius: 7px;
  font-size: 12.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -.01em;
}
.month-label:hover { background: var(--bg-soft); }
.month-today {
  font-size: 11px;
  color: var(--muted);
  padding: 0 8px 0 6px;
  cursor: pointer;
  border-left: 1px solid var(--line);
  margin-left: 2px;
  line-height: 18px;
}
.month-today:hover { color: var(--accent); }

.tb-right { display: flex; align-items: center; gap: 8px; }
.search-wrap { position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: 9px; color: var(--faint); pointer-events: none; }
.search-input {
  width: 190px;
  height: 34px;
  padding: 0 30px 0 30px;
  border-radius: 9px;
  background: var(--panel);
  font-size: 12.5px;
  transition: width .22s cubic-bezier(.2, .8, .2, 1), border-color .16s, box-shadow .16s;
}
.search-input:focus { width: 235px; }
.search-kbd {
  position: absolute;
  right: 8px;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--faint);
  background: var(--bg-soft);
  padding: 1px 4px;
  border-radius: 4px;
  pointer-events: none;
}
.search-input:focus + .search-kbd { display: none; }

.search-panel {
  position: absolute;
  top: calc(100% - 2px);
  right: 24px;
  width: 360px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-md);
  padding: 5px;
  overflow: hidden;
  z-index: 40;
}
.search-empty { padding: 18px 12px; text-align: center; font-size: 12.5px; color: var(--muted); }
.search-hit {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 8px;
  border-radius: 7px;
  text-align: left;
}
.search-hit:hover { background: var(--bg-soft); }
.hit-bar { width: 3px; height: 26px; border-radius: 2px; flex: none; }
.hit-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.hit-title {
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hit-sub { font-size: 10.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.hit-go { color: var(--faint); opacity: 0; flex: none; }
.search-hit:hover .hit-go { opacity: 1; }
.search-foot {
  border-top: 1px solid var(--line-soft);
  padding: 6px 8px 3px;
  font-size: 10px;
  color: var(--faint);
}

@media (max-width: 1100px) {
  .search-input { width: 34px; padding: 0; }
  .search-input:focus { width: 190px; padding: 0 30px; }
  .search-icon { left: 10px; }
  .search-kbd { display: none; }
}

@media (max-width: 760px) {
  .topbar {
    padding: 12px 14px 8px;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .tb-left h1 { font-size: 17px; }
  .tb-left p { display: none; }
  .month-switch { order: 3; margin-left: 0; flex: 1 0 100%; justify-content: center; }
  .month-label { white-space: nowrap; }
  .month-today { white-space: nowrap; }
  .tb-left { flex: 0 1 auto; }
  .tb-right { margin-left: auto; }
  .search-wrap { display: none; }
  .search-panel { right: 12px; left: 12px; width: auto; }
}
</style>
