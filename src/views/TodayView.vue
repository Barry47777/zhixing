<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '../components/base/Icon.vue'
import EntryForm from '../components/record/EntryForm.vue'
import HomeEditor from '../components/home/HomeEditor.vue'
import {
  addEntry, attachFilesToEntry, activeEntries, data, projectColor, projectName,
  setSummary, tagPool, updateEntry,
} from '../stores/data'
import { session, setCursor } from '../stores/session'
import { settings } from '../stores/settings'
import { refreshWorkspace, workspace } from '../stores/workspace'
import { toast } from '../stores/ui'
import { addDays, dayLabel, greeting, keyOf, startOfWeek, todayKey, weekdayLabels } from '../utils/date'
import { fmtDuration, fmtHours } from '../utils/format'
import {
  QUICK_ACTIONS, home, moveHomeModule, setHomeEditing,
  type HomeModule,
} from '../stores/home'

const router = useRouter()
const route = useRoute()
const today = todayKey()

/* ---------------------------------------------------------------- 数据 */

const allEntries = computed(() =>
  activeEntries.value
    .filter((e) => e.date === today)
    .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt),
)
const total = computed(() => allEntries.value.reduce((s, e) => s + e.hours, 0))
const doneCount = computed(() => allEntries.value.filter((e) => e.status === 'done').length)
const goalPct = computed(() => Math.min(100, Math.round(total.value / Math.max(1, settings.dailyGoal) * 100)))
const remain = computed(() => Math.max(0, settings.dailyGoal - total.value))

const weekStart = computed(() => startOfWeek(new Date(), { weekStartsOn: settings.weekStartsOn }))
const week = computed(() => Array.from({ length: 7 }, (_, i) => {
  const d = addDays(weekStart.value, i)
  const key = keyOf(d)
  const hours = activeEntries.value.filter((e) => e.date === key).reduce((s, e) => s + e.hours, 0)
  return { key, label: weekdayLabels(settings.weekStartsOn)[i], hours, isToday: key === today }
}))
const weekPeak = computed(() => Math.max(1, ...week.value.map((d) => d.hours)))
const weekTotal = computed(() => week.value.reduce((s, d) => s + d.hours, 0))

const overview = computed(() => workspace.overview)
const blind = computed(() => overview.value?.review?.blindCard || null)
const recentNotes = computed(() => overview.value?.notes?.recent || [])
const streak = computed(() => overview.value?.streakDays || 0)
const pendingReview = computed(() => overview.value?.review?.pending || 0)

const projects = computed(() => data.projects
  .filter((p) => p.status !== 'archived')
  .slice(0, 6)
  .map((p) => {
    const month = today.slice(0, 7)
    const list = activeEntries.value.filter((e) => e.projectId === p.id && e.date.startsWith(month))
    const hours = list.reduce((s, e) => s + e.hours, 0)
    const target = (p.weeklyTarget || 0) * 4.3
    return { ...p, hours, pct: target ? Math.min(100, Math.round(hours / target * 100)) : 0 }
  }))

const tagHint = computed(() => tagPool())

/* ------------------------------------------------------- 模块内容筛选 */

function entriesFor(mod: HomeModule) {
  let list = [...allEntries.value]
  const filter = mod.options.filter || 'all'
  if (filter !== 'all') list = list.filter((e) => e.status === filter)
  if (mod.options.projectId) list = list.filter((e) => e.projectId === mod.options.projectId)
  return list.slice(0, Math.max(1, mod.options.limit || 20))
}

function projectsFor(mod: HomeModule) {
  let list = [...projects.value]
  if (mod.options.projectId) list = list.filter((p) => p.id === mod.options.projectId)
  return list.slice(0, Math.max(1, mod.options.limit || 6))
}

function notesFor(mod: HomeModule) {
  let list = [...recentNotes.value]
  const zone = mod.options.zone || 'all'
  if (zone !== 'all') list = list.filter((n) => n.zone === zone)
  return list.slice(0, Math.max(1, mod.options.limit || 4))
}

function tagsFor(mod: HomeModule) {
  return tagHint.value.slice(0, Math.max(1, mod.options.limit || 8))
}

function actionsFor(mod: HomeModule) {
  const keys = mod.options.actions || []
  return QUICK_ACTIONS.filter((a) => keys.includes(a.key))
}

function spanList(list: { hours: number }[]): string {
  return fmtDuration(list.reduce((s, i) => s + i.hours, 0))
}

function moduleSubtitle(mod: HomeModule): string {
  switch (mod.type) {
    case 'hero': return `${fmtHours(total.value)}h · ${goalPct.value}%`
    case 'week': return `${fmtHours(weekTotal.value)}h / ${fmtHours(settings.dailyGoal * 5)}h`
    case 'compose': return '回车即可保存'
    case 'entries': return `${entriesFor(mod).length} 条 · ${spanList(entriesFor(mod))}`
    case 'summary': return '停笔 0.6 秒自动保存'
    case 'blind': return blind.value ? `${blind.value.ageDays} 天前` : '还没有旧牌'
    case 'projects': return `${projectsFor(mod).length} 个项目`
    case 'notes': return `${notesFor(mod).length} 条`
    case 'tags': return `${tagsFor(mod).length} 个标签`
    case 'stats': return `连续 ${streak.value} 天`
    case 'quick': return `${actionsFor(mod).length} 个入口`
    case 'note': return '写给自己看'
    default: return ''
  }
}

function actionLabel(mod: HomeModule): string {
  switch (mod.type) {
    case 'entries': return '展开记录抽屉'
    case 'week': return '打开日历'
    case 'notes': return '灵感墙'
    case 'projects': return '全部'
    case 'blind': return '换一张'
    case 'stats': return '看统计'
    case 'compose': return '更多'
    default: return '定制'
  }
}

/* ---------------------------------------------------------------- 动作 */

async function onCreate(payload: any) {
  const { files, ...input } = payload
  const entry = await addEntry({ ...input, date: today })
  if (!entry) return
  if (files?.length) {
    const res = await attachFilesToEntry(entry.id, today, files)
    if (res.rejected.length) toast(res.rejected[0].reason, 'warn')
  }
  toast('已记录', 'success')
  void refreshWorkspace(today)
}

async function toggleDone(id: string, status: string) {
  await updateEntry(id, { status: (status === 'done' ? 'doing' : 'done') as any })
}

function goCalendar() {
  setCursor(new Date())
  session.selected = today
  session.drawerDate = today
  router.push('/calendar')
}

function openTodayDrawer() {
  setCursor(new Date())
  session.selected = today
  session.drawerDate = today
}

function runAction(key: string): void {
  switch (key) {
    case 'new': openTodayDrawer(); break
    case 'calendar': goCalendar(); break
    case 'notes': router.push('/notes'); break
    case 'review': router.push('/review'); break
    case 'projects': router.push('/projects'); break
    case 'stats': router.push('/insights'); break
    case 'settings': router.push('/settings'); break
    default: setHomeEditing(true)
  }
}

function onModuleAction(mod: HomeModule): void {
  switch (mod.type) {
    case 'entries': goCalendar(); break
    case 'week': goCalendar(); break
    case 'notes': router.push('/notes'); break
    case 'projects': router.push('/projects'); break
    case 'blind': void refreshWorkspace(today); break
    case 'stats': router.push('/insights'); break
    case 'compose': openTodayDrawer(); break
    default: setHomeEditing(true)
  }
}

const summary = ref('')
const summaryOfToday = computed(() => data.days.find((d) => d.date === today)?.summary || '')
watch(summaryOfToday, (v) => {
  const el = document.activeElement
  if (el && el.tagName === 'TEXTAREA') return
  summary.value = v
}, { immediate: true })

let timer: number | undefined
watch(summary, (val) => {
  window.clearTimeout(timer)
  timer = window.setTimeout(async () => {
    if (val === summaryOfToday.value) return
    await setSummary(today, val)
  }, 600)
})

watch(() => route.path, (path) => {
  if (path !== '/today') setHomeEditing(false)
})

/* ------------------------------------------------------------ 拖拽排序 */

const dragId = ref('')
const dropTarget = ref('')
const dropSide = ref<'before' | 'after'>('before')

function onDragStart(e: DragEvent, id: string): void {
  dragId.value = id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
}

function onDragOver(e: DragEvent, id: string): void {
  if (!home.editing || !dragId.value || dragId.value === id) return
  e.preventDefault()
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  dropSide.value = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
  dropTarget.value = id
}

function onDrop(e: DragEvent, id: string): void {
  if (!home.editing) return
  e.preventDefault()
  const from = dragId.value || e.dataTransfer?.getData('text/plain')
  if (from && from !== id) moveHomeModule(from, id, dropSide.value)
  clearDrag()
}

function clearDrag(): void {
  dragId.value = ''
  dropTarget.value = ''
  dropSide.value = 'before'
}

function itemStyle(mod: HomeModule) {
  return home.mode === 'list' ? {} : { gridColumn: `span ${mod.span}` }
}

/**
 * 智能排版：按宽度比例把模块分行，每行自动铺满 12 列。
 * 你设置的宽度决定同一行里的相对大小，但不会再出现右侧空洞；
 * 顺序完全按你拖出来的来。列表模式则统一整行。
 */
const visibleModules = computed<HomeModule[]>(() => {
  const mods = home.modules.filter((m) => m.enabled)
  if (!mods.length) return []
  if (home.mode === 'list') return mods.map((m) => ({ ...m, span: 12 as HomeModule['span'] }))

  const rows: HomeModule[][] = []
  let row: HomeModule[] = []
  let used = 0
  for (const mod of mods) {
    const s = Number(mod.span) || 4
    if (used + s > 12 && row.length) {
      rows.push(row)
      row = []
      used = 0
    }
    row.push(mod)
    used += s
  }
  if (row.length) rows.push(row)

  const out: HomeModule[] = []
  for (const r of rows) {
    const total = r.reduce((n, m) => n + (Number(m.span) || 4), 0)
    const scale = 12 / total
    let assigned = 0
    r.forEach((m, i) => {
      const span = i === r.length - 1
        ? 12 - assigned
        : Math.max(1, Math.round((Number(m.span) || 4) * scale))
      assigned += span
      out.push({ ...m, span: span as HomeModule['span'] })
    })
  }
  return out
})

onMounted(async () => {
  await refreshWorkspace(today)
})
</script>

<template>
  <div class="today-view">
    <div class="today-head">
      <div class="th-left">
        <span class="dot-live" />
        <strong>回到今天</strong>
        <span class="th-sub">{{ dayLabel(today) }} · {{ greeting() }}</span>
      </div>
      <button class="btn sm ghost" @click="setHomeEditing(true)">
        <Icon name="layout" :size="14" /> 定制首页
      </button>
    </div>

    <div
      class="home-grid"
      :class="{ 'is-list': home.mode === 'list', 'is-compact': home.compact, 'is-editing': home.editing }"
    >
      <div
        v-for="mod in visibleModules"
        :key="mod.id"
        class="home-item"
        :class="{
          'is-drag': dragId === mod.id,
          'drop-before': dropTarget === mod.id && dropSide === 'before',
          'drop-after': dropTarget === mod.id && dropSide === 'after',
        }"
        :style="itemStyle(mod)"
        @dragover="onDragOver($event, mod.id)"
        @drop="onDrop($event, mod.id)"
        @dragend="clearDrag"
      >
        <section class="card module-card" :class="`type-${mod.type}`">
          <header class="card-head module-head">
            <button
              v-if="home.editing"
              class="module-drag"
              draggable="true"
              title="拖动排序"
              @dragstart="onDragStart($event, mod.id)"
            ><Icon name="drag" :size="14" /></button>
            <h3>{{ mod.title }}</h3>
            <span class="card-sub">{{ moduleSubtitle(mod) }}</span>
            <button v-if="home.editing" class="text-btn" title="编辑这个模块" @click="setHomeEditing(true)">
              <Icon name="settings" :size="13" /> 编辑
            </button>
            <button v-else class="text-btn" @click="onModuleAction(mod)">
              {{ actionLabel(mod) }} <Icon name="right" :size="12" />
            </button>
          </header>

          <!-- 今日概览 -->
          <div v-if="mod.type === 'hero'" class="hero-body">
            <div class="hero-left">
              <div class="hero-title">
                今天已经走过 <strong>{{ fmtHours(total) }}</strong> 小时<span v-if="remain > 0">，还差 {{ fmtHours(remain) }} 到目标。</span><span v-else>，目标达成了。</span>
              </div>
              <div class="hero-bar"><i :style="{ width: goalPct + '%' }" /></div>
              <div class="hero-meta">
                <span><strong>{{ allEntries.length }}</strong> 条记录</span><i />
                <span><strong>{{ doneCount }}</strong> 条完成</span><i />
                <span>目标 {{ fmtHours(settings.dailyGoal) }}h · {{ goalPct }}%</span>
              </div>
            </div>
            <div v-if="mod.options.showWeek !== false" class="hero-right">
              <div class="week-head">
                <span class="side-label">本周节奏</span>
                <span class="week-total">{{ fmtHours(weekTotal) }} / {{ fmtHours(settings.dailyGoal * 5) }} h</span>
              </div>
              <div class="week-bars">
                <div v-for="d in week" :key="d.key" class="wb" :class="{ 'is-today': d.isToday }">
                  <span class="wb-val">{{ d.hours ? fmtHours(d.hours) : '' }}</span>
                  <div class="wb-track"><i :style="{ height: Math.max(3, d.hours / weekPeak * 100) + '%' }" /></div>
                  <span class="wb-label">{{ d.label }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 本周节奏（独立模块） -->
          <div v-else-if="mod.type === 'week'" class="week-solo">
            <div class="week-head">
              <span class="side-label">本周投入</span>
              <span class="week-total">{{ fmtHours(weekTotal) }} h</span>
            </div>
            <div class="week-bars">
              <div v-for="d in week" :key="d.key" class="wb" :class="{ 'is-today': d.isToday }">
                <span class="wb-val">{{ d.hours ? fmtHours(d.hours) : '' }}</span>
                <div class="wb-track"><i :style="{ height: Math.max(3, d.hours / weekPeak * 100) + '%' }" /></div>
                <span class="wb-label">{{ d.label }}</span>
              </div>
            </div>
          </div>

          <!-- 快速记录 -->
          <div v-else-if="mod.type === 'compose'" class="compose-body">
            <EntryForm :date="today" autofocus @submit="onCreate" />
          </div>

          <!-- 今日记录 -->
          <div v-else-if="mod.type === 'entries'" class="entry-list">
            <div
              v-for="e in entriesFor(mod)"
              :key="e.id"
              class="entry-row"
              :class="{ 'is-doing': e.status === 'doing', 'is-blocked': e.status === 'blocked' }"
            >
              <button
                class="check"
                :class="{ on: e.status === 'done' }"
                :title="e.status === 'done' ? '标记为进行中' : '标记为完成'"
                @click="toggleDone(e.id, e.status)"
              >
                <Icon v-if="e.status === 'done'" name="check" :size="11" />
              </button>
              <span class="proj-bar" :style="{ background: projectColor(e.projectId) }" />
              <div class="entry-main">
                <div class="entry-title">
                  {{ e.title }}
                  <span v-if="e.priority === 2" class="prio">优先</span>
                </div>
                <div class="entry-sub">
                  <span>{{ projectName(e.projectId) }}</span>
                  <span v-if="e.note" class="note-mark"><Icon name="list" :size="10" /> 备注</span>
                  <span v-if="e.subtasks.length">{{ e.subtasks.filter((s) => s.done).length }}/{{ e.subtasks.length }} 子任务</span>
                  <span v-if="e.attachmentIds.length" class="note-mark"><Icon name="clip" :size="10" /> {{ e.attachmentIds.length }}</span>
                  <span v-for="t in e.tags.slice(0, 2)" :key="t" class="tag">{{ t }}</span>
                </div>
              </div>
              <span class="entry-hours">{{ fmtHours(e.hours) }}h</span>
              <button class="row-go" title="在日历里打开" @click="goCalendar"><Icon name="right" :size="14" /></button>
            </div>
            <div v-if="!entriesFor(mod).length" class="empty">
              <Icon name="list" :size="24" />
              <strong>这里还没有记录</strong>
              <span>换个筛选，或者先去记一条。</span>
            </div>
          </div>

          <!-- 当日总结 -->
          <div v-else-if="mod.type === 'summary'" class="summary-body">
            <textarea v-model="summary" class="summary-input" rows="3" placeholder="今天做得怎么样？明天要接上什么？" />
          </div>

          <!-- 旧牌 -->
          <div v-else-if="mod.type === 'blind'" class="blind-body">
            <template v-if="blind">
              <p class="blind-think">{{ blind.think || blind.seen || '（这张牌当时没写想法）' }}</p>
              <div class="blind-foot">
                <button class="btn primary sm" @click="router.push('/review')">
                  <Icon name="review" :size="13" /> 去复盘对答案
                </button>
                <button class="btn sm ghost" @click="refreshWorkspace(today)">换一张</button>
              </div>
            </template>
            <p v-else class="side-empty">还没有可以翻的旧牌。记够几条灵感，这里会挑一张给你回看。</p>
          </div>

          <!-- 项目轨道 -->
          <div v-else-if="mod.type === 'projects'" class="proj-body">
            <div v-for="p in projectsFor(mod)" :key="p.id" class="proj">
              <div class="proj-top">
                <span class="dot" :style="{ background: p.color }" />
                <span class="proj-name">{{ p.name }}</span>
                <span class="proj-hours">{{ fmtHours(p.hours) }}h</span>
              </div>
              <div class="proj-track"><i :style="{ width: p.pct + '%', background: p.color }" /></div>
            </div>
            <p v-if="!projectsFor(mod).length" class="side-empty">还没有项目，去「项目」页建一个。</p>
          </div>

          <!-- 最近灵感 -->
          <div v-else-if="mod.type === 'notes'" class="notes-body">
            <button v-for="n in notesFor(mod)" :key="n.id" class="note-row" @click="router.push(`/notes?note=${n.id}`)">
              <span class="note-seq">#{{ n.seq }}</span>
              <span class="note-text">{{ (n.content || n.think || '').slice(0, 48) }}</span>
            </button>
            <p v-if="!notesFor(mod).length" class="side-empty">还没有灵感，去灵感页写一句。</p>
          </div>

          <!-- 标签 -->
          <div v-else-if="mod.type === 'tags'" class="tags-body">
            <div class="tag-cloud">
              <span v-for="t in tagsFor(mod)" :key="t.tag" class="tag">{{ t.tag }} <em>{{ t.count }}</em></span>
              <span v-if="!tagsFor(mod).length" class="side-empty">还没有标签</span>
            </div>
          </div>

          <!-- 数字速览 -->
          <div v-else-if="mod.type === 'stats'" class="stats-body">
            <div class="stat-cell"><strong>{{ allEntries.length }}</strong><span>今日记录</span></div>
            <div class="stat-cell"><strong>{{ streak }}</strong><span>连续天数</span></div>
            <div class="stat-cell"><strong>{{ pendingReview }}</strong><span>待复盘</span></div>
            <div class="stat-cell"><strong>{{ overview?.notes?.inbox || 0 }}</strong><span>灵感待整理</span></div>
          </div>

          <!-- 快捷入口 -->
          <div v-else-if="mod.type === 'quick'" class="quick-body">
            <button v-for="a in actionsFor(mod)" :key="a.key" class="quick-btn" @click="runAction(a.key)">
              <Icon :name="a.icon" :size="15" /><span>{{ a.label }}</span>
            </button>
            <p v-if="!actionsFor(mod).length" class="side-empty">在定制面板里勾选常用功能。</p>
          </div>

          <!-- 自定义便签 -->
          <div v-else-if="mod.type === 'note'" class="note-body">
            <p>{{ mod.options.text || '在定制面板里写下这句话。' }}</p>
          </div>
        </section>
      </div>

      <div v-if="!visibleModules.length" class="home-empty">
        <Icon name="layout" :size="28" />
        <strong>首页还是空的</strong>
        <span>点「定制首页」，从模块库里挑几个放进来。</span>
        <button class="btn primary sm" @click="setHomeEditing(true)">开始定制</button>
      </div>
    </div>

    <HomeEditor v-if="home.editing" />
  </div>
</template>

<style scoped>
.today-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.today-head { display: flex; align-items: center; gap: 10px; padding: 0 2px; }
.th-left { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
.th-left strong { font-size: 12.5px; font-weight: 650; }
.th-sub { font-size: 11px; color: var(--muted); }
.dot-live { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); flex: none; }

.home-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 12px;
  align-items: stretch; /* 同行卡片等高，底部对齐 */
}
.home-grid.is-compact { gap: 8px; }
.home-grid.is-list .home-item { grid-column: 1 / -1 !important; }
.home-item { min-width: 0; display: flex; transition: opacity .15s; }
.home-item > .card { width: 100%; }
.home-item.is-drag { opacity: .38; }
.home-item.drop-before { box-shadow: -3px 0 0 var(--accent); border-radius: var(--r-lg); }
.home-item.drop-after { box-shadow: 3px 0 0 var(--accent); border-radius: var(--r-lg); }
.home-grid.is-editing .module-card { outline: 1px dashed var(--accent-mid); outline-offset: 2px; }

.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--shadow-xs); overflow: hidden; display: flex; flex-direction: column; }
/* 卡片内容铺满剩余高度，避免底部参差的空白 */
.module-card > .card-head { flex: none; }
.module-card > [class$="-body"],
.module-card > .entry-list,
.module-card > .week-solo { flex: 1; min-height: 0; }
.module-card > .entry-list { display: flex; flex-direction: column; }
.module-card > .entry-list .empty { flex: 1; justify-content: center; }
.module-card > .stats-body { align-content: center; }
.card-head { display: flex; align-items: center; gap: 8px; padding: 13px 15px 0; }
.card-head h3 { font-size: 13px; font-weight: 650; letter-spacing: -.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-sub { font-size: 11px; color: var(--muted); white-space: nowrap; }
.card-head .text-btn { margin-left: auto; }
.text-btn { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--muted); flex: none; }
.text-btn:hover { color: var(--accent); }
.module-drag { width: 20px; height: 20px; display: grid; place-items: center; color: var(--faint); cursor: grab; flex: none; }
.module-drag:active { cursor: grabbing; }

.type-hero .card-head { padding-bottom: 8px; }
.hero-body { display: flex; gap: 24px; align-items: stretch; padding: 6px 22px 20px; }
.hero-left { flex: 1; min-width: 0; }
.hero-title { margin: 0 0 13px; font-size: 21px; font-weight: 600; letter-spacing: -.02em; line-height: 1.35; }
.hero-title strong { font-size: 25px; font-weight: 680; color: var(--accent); font-variant-numeric: tabular-nums; }
.hero-bar { height: 6px; border-radius: 99px; background: var(--bg-soft); overflow: hidden; max-width: 460px; }
.hero-bar i { display: block; height: 100%; border-radius: 99px; background: var(--accent); transition: width .5s cubic-bezier(.2,.8,.2,1); }
.hero-meta { display: flex; align-items: center; gap: 9px; margin-top: 10px; font-size: 11.5px; color: var(--muted); }
.hero-meta strong { color: var(--ink); font-weight: 650; font-variant-numeric: tabular-nums; }
.hero-meta i { width: 3px; height: 3px; border-radius: 50%; background: var(--line); }
.hero-right { flex: none; width: 300px; padding-left: 22px; border-left: 1px solid var(--line-soft); display: flex; flex-direction: column; gap: 10px; }
.week-head { display: flex; align-items: baseline; justify-content: space-between; }
.side-label { font-size: 10.5px; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.week-total { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.week-bars { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; flex: 1; align-items: end; }
.wb { display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; }
.wb-val { font-size: 9px; color: var(--faint); font-variant-numeric: tabular-nums; height: 11px; }
.wb-track { flex: 1; width: 100%; display: flex; align-items: flex-end; background: var(--bg-soft); border-radius: 4px; overflow: hidden; min-height: 34px; }
.wb-track i { display: block; width: 100%; background: color-mix(in srgb, var(--ink) 22%, transparent); border-radius: 4px; transition: height .4s; }
.wb.is-today .wb-track i { background: var(--accent); }
.wb-label { font-size: 9.5px; color: var(--faint); }
.wb.is-today .wb-label { color: var(--accent); font-weight: 700; }
.week-solo { padding: 10px 16px 16px; height: 108px; }

.compose-body { padding: 12px 15px 14px; }
.entry-list { padding: 8px 6px 6px; }
.entry-row { display: flex; align-items: center; gap: 9px; padding: 7px 9px; border-radius: 9px; transition: background .13s; }
.entry-row:hover { background: var(--bg-soft); }
.check { width: 17px; height: 17px; flex: none; border-radius: 50%; border: 1.5px solid var(--line); background: var(--panel); display: grid; place-items: center; color: #fff; }
.check:hover { border-color: var(--accent); }
.check.on { background: var(--accent); border-color: var(--accent); }
.proj-bar { width: 3px; height: 26px; border-radius: 2px; flex: none; }
.entry-main { flex: 1; min-width: 0; }
.entry-title { font-size: 13px; font-weight: 550; display: flex; align-items: center; gap: 6px; }
.prio { font-size: 9.5px; font-weight: 650; color: var(--danger); background: var(--danger-soft); padding: 1px 5px; border-radius: 4px; }
.entry-sub { display: flex; align-items: center; gap: 8px; font-size: 10.5px; color: var(--muted); margin-top: 2px; flex-wrap: wrap; }
.note-mark { display: inline-flex; align-items: center; gap: 3px; }
.tag { font-size: 10px; padding: 1.5px 6px; border-radius: 5px; background: var(--bg-soft); color: var(--muted); }
.entry-hours { font-size: 11.5px; color: var(--ink-2); font-variant-numeric: tabular-nums; flex: none; }
.row-go { color: var(--faint); opacity: 0; transition: opacity .13s; flex: none; }
.entry-row:hover .row-go { opacity: 1; }
.entry-row.is-doing .entry-title { color: var(--ink-2); }
.entry-row.is-blocked .proj-bar { background: var(--danger) !important; }

.summary-body { padding: 10px 15px 14px; }
.summary-input { width: 100%; border-radius: 10px; background: var(--panel-2); border-color: var(--line-soft); font-size: 12.5px; line-height: 1.65; resize: vertical; }

.blind-body { padding-bottom: 13px; }
.blind-think { padding: 10px 15px 0; font-size: 12.5px; line-height: 1.72; color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.blind-foot { display: flex; gap: 6px; padding: 11px 15px 0; }
.proj-body { padding-bottom: 13px; }
.proj { padding: 9px 15px 0; }
.proj-top { display: flex; align-items: center; gap: 7px; font-size: 12px; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.proj-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.proj-hours { font-size: 10.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.proj-track { height: 4px; border-radius: 99px; background: var(--bg-soft); margin-top: 6px; overflow: hidden; }
.proj-track i { display: block; height: 100%; border-radius: 99px; }
.notes-body { padding-bottom: 10px; }
.note-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 15px; text-align: left; }
.note-row:hover { background: var(--bg-soft); }
.note-seq { font-size: 10px; color: var(--faint); font-variant-numeric: tabular-nums; flex: none; }
.note-text { font-size: 11.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.side-empty { padding: 10px 15px 0; font-size: 11.5px; color: var(--faint); line-height: 1.6; }
.tags-body { padding-bottom: 13px; }
.tag-cloud { display: flex; flex-wrap: wrap; gap: 5px; padding: 10px 15px 0; }
.tag em { font-style: normal; color: var(--faint); margin-left: 2px; }

.stats-body { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px; padding: 12px 15px 15px; }
.stat-cell { padding: 10px; border-radius: 9px; background: var(--panel-2); display: flex; flex-direction: column; gap: 3px; }
.stat-cell strong { font-size: 20px; font-weight: 660; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.stat-cell span { font-size: 10.5px; color: var(--muted); }
.quick-body { display: flex; flex-wrap: wrap; gap: 7px; padding: 13px 15px 16px; }
.quick-btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 11px; border-radius: 9px; border: 1px solid var(--line); font-size: 11.5px; color: var(--ink-2); }
.quick-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.note-body { padding: 12px 15px 16px; }
.note-body p { font-size: 12.5px; line-height: 1.75; color: var(--ink-2); white-space: pre-wrap; }

.empty { padding: 26px 20px 30px; display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; }
.empty strong { font-size: 13px; }
.empty span { font-size: 11.5px; color: var(--muted); }
.home-empty { grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 60px 20px; color: var(--muted); }
.home-empty strong { font-size: 14px; color: var(--ink); }

@media (max-width: 1180px) {
  .home-item { grid-column: span 12 !important; }
  .hero-right { width: 250px; }
}
@media (max-width: 760px) {
  .today-view { padding: 0 12px 90px; }
  .hero-body { flex-direction: column; gap: 14px; padding: 6px 16px 16px; }
  .hero-title { font-size: 18px; }
  .hero-right { width: auto; padding-left: 0; border-left: 0; }
  .card-sub { display: none; }
}
</style>
