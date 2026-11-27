<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '../components/base/Icon.vue'
import ProjectModal from '../components/project/ProjectModal.vue'
import DragNumber from '../components/base/DragNumber.vue'
import { activeEntries, data, deleteProject, mergeProject, reorderProjects, updateProject } from '../stores/data'
import { openDrawer, session } from '../stores/session'
import { confirmDialog, toast } from '../stores/ui'
import { fmtHours, fmtPct } from '../utils/format'
import { daysFromToday, monthRange, shortDate, todayKey, weekRange } from '../utils/date'
import { useRouter } from 'vue-router'

const router = useRouter()
const cursor = computed(() => session.cursor)
const range = computed(() => monthRange(cursor.value))

const modalOpen = ref(false)
const editing = ref<null | (typeof data.projects)[number]>(null)
const menuId = ref<string | null>(null)
const dragId = ref<string | null>(null)
const showArchived = ref(false)

const activeList = computed(() => data.projects.filter((p) => p.status !== 'archived'))
const archivedList = computed(() => data.projects.filter((p) => p.status === 'archived'))

const monthEntries = computed(() =>
  activeEntries.value.filter((e) => e.date >= range.value.start && e.date <= range.value.end),
)
const monthTotal = computed(() => monthEntries.value.reduce((s, e) => s + e.hours, 0))

const week = computed(() => weekRange(new Date(), 1))

const projStats = computed(() => {
  const map = new Map<string, ReturnType<typeof statsOfProject>>()
  data.projects.forEach((p) => map.set(p.id, statsOfProject(p.id)))
  return map
})

function ps(id: string) {
  return projStats.value.get(id) || {
    monthHours: 0, monthCount: 0, total: 0, weekHours: 0, last: null as string | null,
  }
}

const activeDays = computed(() => new Set(monthEntries.value.map((e) => e.date)).size)

function statsOfProject(id: string) {
  const month = monthEntries.value.filter((e) => e.projectId === id)
  const all = activeEntries.value.filter((e) => e.projectId === id)
  const thisWeek = all.filter((e) => e.date >= week.value.start && e.date <= week.value.end)
  const last = all.length ? all.map((e) => e.date).sort().pop()! : null
  return {
    monthHours: month.reduce((s, e) => s + e.hours, 0),
    monthCount: month.length,
    total: all.length,
    weekHours: thisWeek.reduce((s, e) => s + e.hours, 0),
    last,
  }
}

/* ---------- 进度：拖动即刻生效，写库做防抖 ---------- */
const progressTimers = new Map<string, number>()

function setProgress(id: string, value: number) {
  const p = data.projects.find((x) => x.id === id)
  if (!p) return
  p.progress = value
  const prev = progressTimers.get(id)
  if (prev) window.clearTimeout(prev)
  progressTimers.set(id, window.setTimeout(() => {
    progressTimers.delete(id)
    void updateProject(id, { progress: value })
  }, 350))
}

function dueInfo(p: (typeof data.projects)[number]) {
  if (!p.dueDate) return null
  const days = daysFromToday(p.dueDate)
  const tone = days < 0 ? 'late' : days <= 3 ? 'soon' : 'normal'
  const tail = days < 0 ? `逾期 ${-days} 天` : days === 0 ? '今天到期' : `剩 ${days} 天`
  return { text: shortDate(p.dueDate), tail, tone }
}

function openNew() {
  editing.value = null
  modalOpen.value = true
}

function openEdit(p: (typeof data.projects)[number]) {
  editing.value = p
  modalOpen.value = true
  menuId.value = null
}

async function removeProject(p: (typeof data.projects)[number]) {
  menuId.value = null
  const count = activeEntries.value.filter((e) => e.projectId === p.id).length
  const options = [
    { value: '', label: '改为「未分类」' },
    ...data.projects.filter((x) => x.id !== p.id).map((x) => ({ value: x.id, label: `迁移到「${x.name}」` })),
  ]
  const res = await confirmDialog({
    title: `删除项目「${p.name}」？`,
    message: count
      ? `这个项目下有 ${count} 条记录，记录本身不会删除。选择它们的去向：`
      : '这个项目下还没有记录。',
    danger: true,
    confirmText: '删除项目',
    extra: count ? { label: '记录去向', value: '', options } : undefined,
  })
  if (!res.ok) return
  const moved = await deleteProject(p.id, res.extraValue || null)
  if (session.filterProject === p.id) session.filterProject = null
  toast(moved ? `项目已删除，${moved} 条记录已迁移` : '项目已删除', 'success')
}

async function merge(p: (typeof data.projects)[number]) {
  menuId.value = null
  const others = data.projects.filter((x) => x.id !== p.id && x.status !== 'archived')
  if (!others.length) {
    toast('至少需要另一个项目才能合并', 'warn')
    return
  }
  const count = activeEntries.value.filter((e) => e.projectId === p.id).length
  const res = await confirmDialog({
    title: `把「${p.name}」合并到其他项目`,
    message: `该项目的 ${count} 条记录会转移到目标项目，然后「${p.name}」会被删除。`,
    confirmText: '合并',
    extra: {
      label: '目标项目',
      value: others[0].id,
      options: others.map((x) => ({ value: x.id, label: x.name })),
    },
  })
  if (!res.ok || !res.extraValue) return
  const moved = await mergeProject(p.id, res.extraValue)
  if (session.filterProject === p.id) session.filterProject = null
  toast(`已合并，${moved} 条记录转移完成`, 'success')
}

async function toggleArchive(p: (typeof data.projects)[number]) {
  menuId.value = null
  await updateProject(p.id, { status: p.status === 'archived' ? 'active' : 'archived' })
  toast(p.status === 'archived' ? '已恢复项目' : '已归档项目')
}

function viewProject(p: (typeof data.projects)[number]) {
  session.filterProject = p.id
  router.push('/calendar')
}

function openToday() {
  openDrawer(todayKey())
}

function onDragStart(id: string) {
  dragId.value = id
}
function onDragOver(targetId: string) {
  if (!dragId.value || dragId.value === targetId) return
  const ids = data.projects.map((p) => p.id)
  const from = ids.indexOf(dragId.value)
  const to = ids.indexOf(targetId)
  if (from < 0 || to < 0) return
  ids.splice(to, 0, ids.splice(from, 1)[0])
  void reorderProjects(ids)
}
function onDragEnd() {
  dragId.value = null
}

function onDocClick(e: MouseEvent) {
  const el = e.target as HTMLElement
  if (!el.closest('.card-menu')) menuId.value = null
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

const monthLabelText = computed(() => `${cursor.value.getFullYear()} 年 ${cursor.value.getMonth() + 1} 月`)
</script>

<template>
  <div class="projects-view">
    <div class="pv-head">
      <div class="pv-summary">
        <div class="pv-num">
          <strong>{{ activeList.length }}</strong><span>个进行中项目</span>
        </div>
        <i />
        <div class="pv-num">
          <strong>{{ fmtHours(monthTotal) }}</strong><span>{{ monthLabelText }}投入（h）</span>
        </div>
        <i />
        <div class="pv-num">
          <strong>{{ fmtHours(monthTotal / Math.max(1, activeDays)) }}</strong>
          <span>日均（h）</span>
        </div>
      </div>
      <button class="btn primary" @click="openNew">
        <Icon name="plus" :size="15" /> 新建项目
      </button>
    </div>

    <div class="proj-grid">
      <article
        v-for="p in activeList"
        :key="p.id"
        class="proj-card"
        :class="{ 'is-dragging': dragId === p.id }"
        :style="{ '--c': p.color }"
        draggable="true"
        @dragstart="onDragStart(p.id)"
        @dragover.prevent="onDragOver(p.id)"
        @dragend="onDragEnd"
      >
        <div class="pc-top">
          <span class="drag-handle" title="拖动排序"><Icon name="grip" :size="13" /></span>
          <div class="pc-name">
            <span class="dot" />
            <span class="name-text">{{ p.name }}</span>
          </div>
          <span
            class="badge"
            :class="p.progress >= 100 || p.status === 'active' ? 'ok' : p.status === 'paused' ? 'warn' : ''"
          >{{ p.progress >= 100 ? '已完成' : p.status === 'active' ? '进行中' : p.status === 'paused' ? '暂停' : '已归档' }}</span>

          <div class="card-menu">
            <button class="icon-btn" :class="{ 'is-open': menuId === p.id }" @click.stop="menuId = menuId === p.id ? null : p.id">
              <Icon name="more" :size="16" />
            </button>
            <Transition name="fade">
              <div v-if="menuId === p.id" class="menu" @click.stop>
                <button class="menu-item" @click="openEdit(p)">
                  <Icon name="edit" :size="13" /> 编辑项目
                </button>
                <button class="menu-item" @click="viewProject(p)">
                  <Icon name="filter" :size="13" /> 在日历中筛选
                </button>
                <button class="menu-item" @click="merge(p)">
                  <Icon name="merge" :size="13" /> 合并到…
                </button>
                <button class="menu-item" @click="toggleArchive(p)">
                  <Icon name="archive" :size="13" /> {{ p.status === 'archived' ? '恢复项目' : '归档项目' }}
                </button>
                <div class="menu-sep" />
                <button class="menu-item danger" @click="removeProject(p)">
                  <Icon name="trash" :size="13" /> 删除项目…
                </button>
              </div>
            </Transition>
          </div>
        </div>

        <p v-if="p.note" class="pc-note">{{ p.note }}</p>
        <p v-else class="pc-note is-empty">
          {{ ps(p.id).last ? `最近记录 ${ps(p.id).last}` : '还没有记录' }}
        </p>

        <div class="pc-progress">
          <span class="pp-label">进度</span>
          <DragNumber
            :model-value="p.progress"
            :min="0"
            :max="100"
            :step="5"
            unit="%"
            :height="5"
            :presets="[0, 25, 50, 75, 100]"
            :color="p.color"
            :aria-label="`${p.name} 的进度`"
            @update:model-value="setProgress(p.id, $event)"
          />
        </div>
        <div v-if="dueInfo(p)" class="pc-due" :class="dueInfo(p)!.tone">
          <Icon name="calendar" :size="11" />
          <span>截止 {{ dueInfo(p)!.text }}</span>
          <span class="due-tail">{{ dueInfo(p)!.tail }}</span>
        </div>
        <div v-else class="pc-due is-empty">
          <Icon name="calendar" :size="11" />
          <button class="due-set" @click="openEdit(p)">设截止日</button>
        </div>

        <div class="pc-stats">
          <div class="pc-stat">
            <strong>{{ fmtHours(ps(p.id).monthHours) }}</strong>
            <span>本月 h · 占 {{ fmtPct(ps(p.id).monthHours / Math.max(1, monthTotal)) }}</span>
          </div>
          <div class="pc-stat">
            <strong>{{ ps(p.id).monthCount }}</strong>
            <span>本月条数</span>
          </div>
          <div class="pc-stat">
            <strong>{{ ps(p.id).total }}</strong>
            <span>累计条数</span>
          </div>
        </div>

        <div v-if="p.weeklyTarget" class="pc-target">
          <div class="target-line">
            <span>本周目标</span>
            <span>{{ fmtHours(ps(p.id).weekHours) }} / {{ p.weeklyTarget }}h</span>
          </div>
          <div class="target-bar">
            <i :style="{ width: Math.min(100, ps(p.id).weekHours / p.weeklyTarget * 100) + '%' }" />
          </div>
        </div>

        <div class="pc-actions">
          <button class="ghost-link" @click="viewProject(p)">查看记录</button>
          <button class="ghost-link" @click="openToday">记一条</button>
          <button class="ghost-link danger" @click="removeProject(p)">删除</button>
        </div>
      </article>

      <button class="new-proj-card" @click="openNew">
        <span class="np-icon"><Icon name="plus" :size="18" /></span>
        <span class="np-title">新建项目</span>
        <span class="np-sub">截止日 · 进度 · 目标工时</span>
      </button>
    </div>

    <section v-if="archivedList.length" class="archived">
      <button class="arch-head" @click="showArchived = !showArchived">
        <Icon :name="showArchived ? 'down' : 'right'" :size="13" />
        已归档 {{ archivedList.length }} 个
      </button>
      <div v-if="showArchived" class="arch-list">
        <div v-for="p in archivedList" :key="p.id" class="arch-item">
          <span class="dot" :style="{ background: p.color }" />
          <span class="arch-name">{{ p.name }}</span>
          <span class="arch-meta">{{ ps(p.id).total }} 条记录</span>
          <button class="ghost-link" @click="toggleArchive(p)">恢复</button>
          <button class="ghost-link danger" @click="removeProject(p)">删除</button>
        </div>
      </div>
    </section>

    <ProjectModal
      v-if="modalOpen"
      :project="editing"
      @close="modalOpen = false"
      @saved="modalOpen = false"
    />
  </div>
</template>

<style scoped>
.projects-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pv-head {
  display: flex;
  align-items: center;
  gap: 16px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: 13px 16px;
}
.pv-summary { display: flex; align-items: center; gap: 16px; flex: 1; min-width: 0; }
.pv-num { display: flex; flex-direction: column; gap: 1px; }
.pv-num strong { font-size: 20px; font-weight: 660; letter-spacing: -.03em; font-variant-numeric: tabular-nums; line-height: 1.15; }
.pv-num span { font-size: 10.5px; color: var(--muted); white-space: nowrap; }
.pv-summary > i { width: 1px; height: 26px; background: var(--line); }

.proj-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
  gap: 12px;
}

.proj-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: 12px 13px 10px;
  box-shadow: var(--shadow-xs);
  transition: box-shadow .18s, border-color .18s, transform .18s;
  cursor: default;
}
.proj-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--c);
}
.proj-card:hover { box-shadow: var(--shadow-sm); border-color: color-mix(in srgb, var(--c) 26%, var(--line)); }
.proj-card.is-dragging { opacity: .45; }

.pc-top { display: flex; align-items: center; gap: 6px; }
.drag-handle {
  color: var(--faint);
  opacity: 0;
  cursor: grab;
  display: grid;
  place-items: center;
  margin-left: -3px;
  transition: opacity .15s;
}
.proj-card:hover .drag-handle { opacity: 1; }
.drag-handle:active { cursor: grabbing; }

.pc-name { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
.pc-name .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex: none; }
.name-text {
  font-size: 13.5px;
  font-weight: 620;
  letter-spacing: -.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pc-top .badge { flex: none; margin-right: 2px; }
.card-menu { position: relative; flex: none; }
.card-menu .icon-btn.is-open { background: var(--bg-soft); color: var(--ink); }

.menu {
  position: absolute;
  top: 32px;
  right: 0;
  width: 168px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow-md);
  padding: 4px;
  z-index: 40;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--ink-2);
  text-align: left;
}
.menu-item:hover { background: var(--bg-soft); color: var(--ink); }
.menu-item.danger { color: var(--danger); }
.menu-item.danger:hover { background: var(--danger-soft); }
.menu-sep { height: 1px; background: var(--line-soft); margin: 4px 2px; }

.pc-note {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
  min-height: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pc-note.is-empty { color: var(--faint); }

.pc-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.pc-stat { display: flex; flex-direction: column; }
.pc-stat strong { font-size: 15px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -.02em; line-height: 1.25; }
.pc-stat span { font-size: 9.5px; color: var(--faint); }


.pc-progress { display: flex; align-items: center; gap: 7px; margin-top: 1px; }
.pp-label { font-size: 10px; color: var(--muted); flex: none; }
.pc-progress :deep(.dn-value) { min-width: 34px; height: 22px; font-size: 10.5px; }

.pc-due {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.pc-due .due-tail {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-soft);
  font-size: 9.5px;
}
.pc-due.soon { color: var(--warn); }
.pc-due.soon .due-tail { background: rgba(183, 121, 31, .14); }
.pc-due.late { color: var(--danger); }
.pc-due.late .due-tail { background: var(--danger-soft); }
.pc-due.is-empty { color: var(--faint); }
.due-set { font-size: 10.5px; color: var(--faint); padding: 1px 4px; border-radius: 4px; }
.due-set:hover { color: var(--accent); background: var(--accent-soft); }

.pc-target { display: flex; flex-direction: column; gap: 3px; padding-top: 2px; }
.target-line { display: flex; justify-content: space-between; font-size: 10px; color: var(--muted); font-variant-numeric: tabular-nums; }
.target-bar { height: 3px; border-radius: 99px; background: var(--line-soft); overflow: hidden; }
.target-bar i { display: block; height: 100%; background: color-mix(in srgb, var(--c) 70%, var(--ink)); border-radius: 99px; }

.pc-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  border-top: 1px solid var(--line-soft);
  padding-top: 7px;
  margin-top: 2px;
}
.ghost-link {
  font-size: 11px;
  color: var(--muted);
  padding: 3px 6px;
  border-radius: 5px;
}
.ghost-link:hover { background: var(--bg-soft); color: var(--ink); }
.ghost-link.danger { margin-left: auto; }
.ghost-link.danger:hover { background: var(--danger-soft); color: var(--danger); }

.new-proj-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 196px;
  border: 1px dashed var(--line);
  border-radius: var(--r-lg);
  color: var(--muted);
  transition: border-color .15s, background .15s, color .15s;
}
.new-proj-card:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.np-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: var(--bg-soft);
  margin-bottom: 2px;
}
.new-proj-card:hover .np-icon { background: var(--panel); }
.np-title { font-size: 12.5px; font-weight: 600; }
.np-sub { font-size: 10px; color: var(--faint); }

.archived { display: flex; flex-direction: column; gap: 8px; }
.arch-head {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--muted);
  align-self: flex-start;
  padding: 3px 6px;
  border-radius: 6px;
}
.arch-head:hover { background: var(--panel); color: var(--ink-2); }
.arch-list { display: flex; flex-direction: column; gap: 2px; }
.arch-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--panel);
  border: 1px solid var(--line-soft);
  font-size: 12px;
}
.arch-item .dot { width: 7px; height: 7px; border-radius: 50%; opacity: .6; }
.arch-name { font-weight: 500; }
.arch-meta { font-size: 10.5px; color: var(--faint); margin-right: auto; }

.fade-enter-active, .fade-leave-active { transition: opacity .13s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@media (max-width: 760px) {
  .projects-view { padding: 4px 12px 20px; }
  .pv-head { padding: 11px 12px; gap: 10px; }
  .pv-summary { gap: 10px; }
  .pv-summary > i:nth-of-type(2) { display: none; }
  .pv-num:nth-of-type(3) { display: none; }
  .pv-num strong { font-size: 17px; }
  .proj-grid { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .new-proj-card { min-height: 96px; }
  .drag-handle { display: none; }
}
</style>
