<script setup lang="ts">
import { computed, ref } from 'vue'
import DayCell from '../components/calendar/DayCell.vue'
import Icon from '../components/base/Icon.vue'
import { activeEntries, clearEverything, data, demoSeededAt, moveEntry, projectMap, summaryOf } from '../stores/data'
import { openDrawer, session } from '../stores/session'
import { settings } from '../stores/settings'
import { confirmDialog, toast } from '../stores/ui'
import { monthMatrix, todayKey, weekdayLabels } from '../utils/date'
import { fmtHours } from '../utils/format'

const cells = computed(() => monthMatrix(session.cursor, settings.weekStartsOn))
const today = todayKey()

const filtered = computed(() => {
  if (!session.filterProject) return activeEntries.value
  if (session.filterProject === '__none') return activeEntries.value.filter((e) => !e.projectId)
  return activeEntries.value.filter((e) => e.projectId === session.filterProject)
})

const byDate = computed(() => {
  const map = new Map<string, typeof activeEntries.value>()
  filtered.value.forEach((e) => {
    if (!map.has(e.date)) map.set(e.date, [])
    map.get(e.date)!.push(e)
  })
  map.forEach((list) => list.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt))
  return map
})

const monthEntries = computed(() => {
  const y = session.cursor.getFullYear()
  const m = String(session.cursor.getMonth() + 1).padStart(2, '0')
  return filtered.value.filter((e) => e.date.startsWith(`${y}-${m}`))
})

const monthTotal = computed(() => monthEntries.value.reduce((s, e) => s + e.hours, 0))
const monthDays = computed(() => new Set(monthEntries.value.map((e) => e.date)).size)

const legend = computed(() => data.projects.filter((p) => p.status !== 'archived').slice(0, 8))
const filterName = computed(() => {
  if (!session.filterProject) return ''
  return projectMap.value.get(session.filterProject)?.name || '未分类'
})

const draggingId = ref<string | null>(null)

async function clearDemo() {
  const r = await confirmDialog({
    title: '清空演示数据？',
    message: '会删除全部演示记录和演示项目，之后从空白开始记录。清空前会自动存一份快照，误删可恢复。',
    confirmText: '清空演示数据',
  })
  if (!r.ok) return
  await clearEverything()
  toast('已清空，可以开始正式记录了', 'success')
}

function onDragStart(id: string) {
  draggingId.value = id
}

function onDrop(date: string) {
  const id = draggingId.value
  draggingId.value = null
  if (!id) return
  const entry = data.entries.find((e) => e.id === id)
  if (!entry || entry.date === date) return
  const from = entry.date
  void moveEntry(id, date).then(() => {
    toast(`已移动到 ${date}`, 'success', {
      label: '撤销',
      run: () => { void moveEntry(id, from) },
    })
  })
}
</script>

<template>
  <div class="calendar-view">
    <div v-if="demoSeededAt" class="demo-bar">
      <Icon name="info" :size="13" />
      <span>现在显示的是<strong>演示数据</strong>，不是你录入的内容。</span>
      <button class="demo-clear" @click="clearDemo">清空，开始正式记录</button>
    </div>

    <div v-if="session.filterProject" class="filter-bar">
      <Icon name="filter" :size="13" />
      <span>只看 <strong>{{ filterName }}</strong></span>
      <button class="filter-clear" @click="session.filterProject = null">清除筛选</button>
    </div>

    <div class="cal-card">
      <div class="weekdays">
        <span
          v-for="(w, i) in weekdayLabels(settings.weekStartsOn)"
          :key="w"
          :class="{ 'is-weekend': (settings.weekStartsOn === 1 && i >= 5) || (settings.weekStartsOn === 0 && (i === 0 || i === 6)) }"
        >{{ w }}</span>
      </div>
      <div class="cal-grid">
        <DayCell
          v-for="cell in cells"
          :key="cell.key"
          :cell="cell"
          :entries="byDate.get(cell.key) || []"
          :summary="summaryOf(cell.key)"
          :today="today"
          @open="openDrawer"
          @move-start="onDragStart"
          @move-end="onDrop"
        />
      </div>
    </div>

    <div class="cal-foot">
      <div class="legend">
        <button
          v-for="p in legend"
          :key="p.id"
          class="legend-item"
          :class="{ 'is-on': session.filterProject === p.id }"
          @click="session.filterProject = session.filterProject === p.id ? null : p.id"
        >
          <span class="dot" :style="{ background: p.color }" />
          <span>{{ p.name }}</span>
        </button>
        <button
          class="legend-item"
          :class="{ 'is-on': session.filterProject === '__none' }"
          @click="session.filterProject = session.filterProject === '__none' ? null : '__none'"
        >
          <span class="dot" style="background: var(--faint)" />
          <span>未分类</span>
        </button>
      </div>
      <div class="month-sum">
        <span><strong>{{ fmtHours(monthTotal) }}</strong> 小时</span>
        <i />
        <span>{{ monthDays }} 天有记录</span>
        <i />
        <span>{{ monthEntries.length }} 条</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calendar-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 8px 24px 14px;
  gap: 8px;
  overflow: hidden;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--ink-2);
  background: var(--accent-soft);
  color: var(--accent);
  padding: 7px 11px;
  border-radius: 9px;
  flex: none;
}
.filter-bar strong { font-weight: 650; }

.demo-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  font-size: 12px;
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 11%, transparent);
  border: 1px solid color-mix(in srgb, var(--warn) 22%, transparent);
  padding: 7px 11px;
  border-radius: 9px;
}
.demo-bar strong { font-weight: 650; }
.demo-bar span { flex: 1; min-width: 0; }
.demo-clear {
  flex: none;
  border: 1px solid color-mix(in srgb, var(--warn) 35%, transparent);
  background: transparent;
  color: var(--warn);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 7px;
  cursor: pointer;
}
.demo-clear:hover { background: color-mix(in srgb, var(--warn) 14%, transparent); }

@media (max-width: 700px) {
  .demo-bar { flex-wrap: wrap; font-size: 11px; }
  .demo-clear { width: 100%; padding: 5px 9px; }
}
.filter-clear {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--accent);
  opacity: .8;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.filter-clear:hover { opacity: 1; }

.cal-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  overflow: hidden;
  box-shadow: var(--shadow-xs);
}

.weekdays {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  flex: none;
  border-bottom: 1px solid var(--line);
  background: var(--panel-2);
}
.weekdays span {
  padding: 7px 8px 6px;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: .08em;
  color: var(--muted);
  text-align: right;
  text-transform: uppercase;
}
.weekdays span:first-child { text-align: left; }
.weekdays span.is-weekend { color: var(--faint); }

.cal-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  grid-auto-rows: minmax(var(--cell-min), 1fr);
}

.cal-foot {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: none;
  min-height: 22px;
}
.legend {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-wrap: wrap;
  min-width: 0;
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--muted);
  padding: 2px 6px;
  border-radius: 6px;
}
.legend-item:hover { background: var(--panel); color: var(--ink-2); }
.legend-item.is-on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.legend-item .dot { width: 6px; height: 6px; border-radius: 50%; }

.month-sum {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.month-sum strong { color: var(--ink); font-weight: 650; font-size: 12px; }
.month-sum i { width: 3px; height: 3px; border-radius: 50%; background: var(--line); }

@media (max-width: 1100px) {
  .calendar-view { padding: 0 16px 12px; }
  .legend-item span:last-child { display: none; }
  .legend-item .dot { width: 8px; height: 8px; }
}

@media (max-width: 760px) {
  .calendar-view { padding: 0 10px 10px; gap: 6px; overflow-y: auto; }
  .cal-card { border-radius: 12px; }
  .cal-grid { grid-auto-rows: minmax(66px, 1fr); }
  .weekdays span { padding: 5px 4px; font-size: 9.5px; text-align: center; }
  .weekdays span:first-child { text-align: center; }
  .cal-foot { display: none; }
}
</style>
