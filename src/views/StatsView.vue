<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '../components/base/Icon.vue'
import { activeEntries, data, projectColor, projectName } from '../stores/data'
import { session, openDrawer } from '../stores/session'
import { settings } from '../stores/settings'
import { fmtHours, fmtPct } from '../utils/format'
import { heatmap, projectDistribution, statsOf, streakDays, topEntries, weeklySeries } from '../utils/stats'
import { fromKey, monthRange, todayKey } from '../utils/date'

const router = useRouter()

const range = computed(() => monthRange(session.cursor))
const prevCursor = computed(() => new Date(session.cursor.getFullYear(), session.cursor.getMonth() - 1, 1))
const prevRange = computed(() => monthRange(prevCursor.value))

const monthEntries = computed(() =>
  activeEntries.value.filter((e) => e.date >= range.value.start && e.date <= range.value.end),
)
const prevEntries = computed(() =>
  activeEntries.value.filter((e) => e.date >= prevRange.value.start && e.date <= prevRange.value.end),
)

const daysInMonth = computed(() =>
  new Date(session.cursor.getFullYear(), session.cursor.getMonth() + 1, 0).getDate(),
)

const stats = computed(() => statsOf(monthEntries.value, daysInMonth.value))
const prevStats = computed(() => statsOf(prevEntries.value, 30))

function delta(cur: number, prev: number): { text: string; up: boolean; flat: boolean } {
  if (!prev) return { text: cur ? '新增' : '—', up: cur > 0, flat: !cur }
  const d = Math.round((cur - prev) / prev * 1000) / 10
  return { text: `${d > 0 ? '+' : ''}${d}%`, up: d > 0, flat: d === 0 }
}

const kpis = computed(() => [
  {
    label: '本月投入',
    value: fmtHours(stats.value.total),
    unit: '小时',
    delta: delta(stats.value.total, prevStats.value.total),
    icon: 'clock',
  },
  {
    label: '活跃天数',
    value: String(stats.value.dayCount),
    unit: `/ ${daysInMonth.value} 天`,
    delta: delta(stats.value.dayCount, prevStats.value.dayCount),
    icon: 'calendar',
  },
  {
    label: '日均工时',
    value: fmtHours(stats.value.avgPerActiveDay),
    unit: '小时',
    delta: delta(stats.value.avgPerActiveDay, prevStats.value.avgPerActiveDay),
    icon: 'chart',
  },
  {
    label: '完成条目',
    value: `${stats.value.doneCount}`,
    unit: `/ ${stats.value.count} 条`,
    delta: delta(
      stats.value.count ? stats.value.doneCount / stats.value.count : 0,
      prevStats.value.count ? prevStats.value.doneCount / prevStats.value.count : 0,
    ),
    icon: 'check',
  },
])

const isNarrow = ref(window.innerWidth < 760)
const onResize = () => { isNarrow.value = window.innerWidth < 760 }
onMounted(() => window.addEventListener('resize', onResize))
onUnmounted(() => window.removeEventListener('resize', onResize))

const heatWeeks = computed(() => (isNarrow.value ? 26 : 52))
const heat = computed(() => heatmap(activeEntries.value, heatWeeks.value, settings.weekStartsOn))
const heatTotal = computed(() => heat.value.flat().reduce((s, c) => s + (c.inRange ? c.hours : 0), 0))
const streak = computed(() => streakDays(activeEntries.value))

const weekPoints = computed(() => weeklySeries(activeEntries.value, 8, settings.weekStartsOn))
const weekPeak = computed(() => Math.max(1, ...weekPoints.value.map((w) => w.hours)))

const dist = computed(() => projectDistribution(monthEntries.value, data.projects))
const distTotal = computed(() => dist.value.reduce((s, d) => s + d.hours, 0) || 1)

const statusData = computed(() => {
  const s = stats.value
  const total = Math.max(1, s.count)
  return [
    { key: 'done', label: '已完成', count: s.doneCount, pct: s.doneCount / total, color: 'var(--ok)' },
    { key: 'doing', label: '进行中', count: s.doingCount, pct: s.doingCount / total, color: 'var(--warn)' },
    { key: 'blocked', label: '受阻', count: s.blockedCount, pct: s.blockedCount / total, color: 'var(--danger)' },
  ]
})

const DONUT_R = 42
const DONUT_C = 2 * Math.PI * DONUT_R

const donutSegments = computed(() => {
  let offset = 0
  return statusData.value.map((s) => {
    const dash = s.pct * DONUT_C
    const seg = { ...s, dash, offset }
    offset += dash
    return seg
  })
})

const top = computed(() => topEntries(monthEntries.value, 6))

function openEntryDate(date: string) {
  openDrawer(date)
}
</script>

<template>
  <div class="stats-view">
    <div class="kpi-row">
      <div v-for="k in kpis" :key="k.label" class="kpi card">
        <div class="kpi-top">
          <span class="kpi-label">{{ k.label }}</span>
          <span class="kpi-ico"><Icon :name="k.icon" :size="13" /></span>
        </div>
        <div class="kpi-val">
          <strong>{{ k.value }}</strong>
          <span>{{ k.unit }}</span>
        </div>
        <div class="kpi-delta" :class="{ up: k.delta.up && !k.delta.flat, flat: k.delta.flat }">
          <span v-if="!k.delta.flat">{{ k.delta.up ? '↑' : '↓' }}</span>
          {{ k.delta.text }}
          <em>较上月</em>
        </div>
      </div>
    </div>

    <div class="panel card heat-card">
      <div class="panel-head">
        <div>
          <h3>记录热力图</h3>
          <p>最近 {{ heatWeeks }} 周 · 每格一天，颜色越深当天投入越多</p>
        </div>
        <div class="heat-side">
          <div class="heat-stat"><strong>{{ fmtHours(heatTotal) }}</strong><span>小时</span></div>
          <div class="heat-stat"><strong>{{ streak }}</strong><span>天连续</span></div>
        </div>
      </div>
      <div class="heat-wrap">
        <div class="heat-grid" :style="{ gridTemplateColumns: `repeat(${heatWeeks}, minmax(0, 1fr))` }">
          <div
            v-for="(cell, i) in heat.flat()"
            :key="i"
            class="heat-cell"
            :class="`lv-${cell.level}`"
            :style="{ opacity: cell.inRange ? 1 : .22 }"
            :title="`${cell.key} · ${fmtHours(cell.hours)}h`"
            @click="openEntryDate(cell.key)"
          />
        </div>
        <div class="heat-legend">
          <span>少</span>
          <i class="lv-0" /><i class="lv-1" /><i class="lv-2" /><i class="lv-3" /><i class="lv-4" />
          <span>多</span>
        </div>
      </div>
    </div>

    <div class="panel-grid">
      <div class="panel card">
        <div class="panel-head">
          <div>
            <h3>最近 8 周</h3>
            <p>每周总投入</p>
          </div>
        </div>
        <div class="bars">
          <div v-for="w in weekPoints" :key="w.start" class="bar-col">
            <span class="bar-val">{{ w.hours ? fmtHours(w.hours) : '' }}</span>
            <div class="bar-track">
              <div class="bar" :style="{ height: Math.max(2, w.hours / weekPeak * 100) + '%' }">
                <i
                  v-for="(d, di) in w.days"
                  :key="di"
                  class="bar-seg"
                  :style="{ flexGrow: Math.max(0.01, d), opacity: d ? 0.35 + Math.min(0.65, d / 6) : 0.12 }"
                />
              </div>
            </div>
            <span class="bar-label">{{ w.label }}</span>
          </div>
        </div>
      </div>

      <div class="panel card">
        <div class="panel-head">
          <div>
            <h3>状态分布</h3>
            <p>本月 {{ stats.count }} 条记录</p>
          </div>
        </div>
        <div class="donut-wrap">
          <svg class="donut" viewBox="0 0 110 110">
            <circle cx="55" cy="55" :r="DONUT_R" fill="none" stroke="var(--line-soft)" stroke-width="11" />
            <circle
              v-for="s in donutSegments"
              :key="s.key"
              cx="55"
              cy="55"
              :r="DONUT_R"
              fill="none"
              :stroke="s.color"
              stroke-width="11"
              stroke-linecap="butt"
              :stroke-dasharray="`${Math.max(0, s.dash - 2)} ${DONUT_C}`"
              :stroke-dashoffset="-s.offset"
              transform="rotate(-90 55 55)"
              :style="{ opacity: s.count ? 1 : 0 }"
            />
            <text x="55" y="52" text-anchor="middle" class="donut-num">{{ stats.count }}</text>
            <text x="55" y="66" text-anchor="middle" class="donut-cap">条记录</text>
          </svg>
          <ul class="legend">
            <li v-for="s in statusData" :key="s.key">
              <i :style="{ background: s.color }" />
              <span>{{ s.label }}</span>
              <strong>{{ s.count }}</strong>
              <em>{{ fmtPct(s.pct) }}</em>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <div class="panel-grid">
      <div class="panel card">
        <div class="panel-head">
          <div>
            <h3>项目投入</h3>
            <p>本月各项目占用的时间</p>
          </div>
          <button class="head-link" @click="router.push('/projects')">管理项目</button>
        </div>
        <ul v-if="dist.length" class="dist">
          <li v-for="d in dist" :key="d.project.id">
            <div class="dist-top">
              <span class="dist-name">
                <i class="dot" :style="{ background: d.project.color }" />
                {{ d.project.name }}
              </span>
              <span class="dist-val">{{ fmtHours(d.hours) }}h <em>{{ fmtPct(d.hours / distTotal) }}</em></span>
            </div>
            <div class="dist-bar">
              <i :style="{ width: (d.hours / distTotal * 100) + '%', background: d.project.color }" />
            </div>
          </li>
        </ul>
        <div v-else class="empty">
          <Icon name="folder" :size="26" />
          <strong>本月还没有记录</strong>
          <span>记几条之后，这里会显示时间分配。</span>
        </div>
      </div>

      <div class="panel card">
        <div class="panel-head">
          <div>
            <h3>最耗时的记录</h3>
            <p>本月 Top 6</p>
          </div>
        </div>
        <ul v-if="top.length" class="top-list">
          <li v-for="(e, i) in top" :key="e.id" @click="openEntryDate(e.date)">
            <span class="rank">{{ i + 1 }}</span>
            <span class="top-main">
              <span class="top-title">{{ e.title }}</span>
              <span class="top-sub">{{ e.date }} · {{ projectName(e.projectId) }}</span>
            </span>
            <span class="top-hours" :style="{ color: projectColor(e.projectId) }">{{ fmtHours(e.hours) }}h</span>
          </li>
        </ul>
        <div v-else class="empty">
          <Icon name="clock" :size="26" />
          <strong>还没有记录</strong>
          <span>点右上角「记录」开始。</span>
        </div>
      </div>
    </div>

    <p class="footnote">
      统计基于 {{ range.start }} ~ {{ range.end }}，共 {{ stats.count }} 条记录 ·
      今天 {{ todayKey() }}
    </p>
  </div>
</template>

<style scoped>
.stats-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.kpi { padding: 12px 14px 13px; }
.kpi-top { display: flex; align-items: center; justify-content: space-between; }
.kpi-label { font-size: 11px; color: var(--muted); font-weight: 500; }
.kpi-ico {
  width: 22px;
  height: 22px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  background: var(--bg-soft);
  color: var(--muted);
  flex: none;
}
.kpi-val { display: flex; align-items: baseline; gap: 4px; margin-top: 3px; }
.kpi-val strong {
  font-size: 25px;
  font-weight: 660;
  letter-spacing: -.03em;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
}
.kpi-val span { font-size: 11px; color: var(--muted); }
.kpi-delta { font-size: 10.5px; color: var(--muted); margin-top: 3px; display: flex; align-items: center; gap: 3px; }
.kpi-delta em { font-style: normal; color: var(--faint); margin-left: 2px; }
.kpi-delta.up { color: var(--ok); }
.kpi-delta.flat { color: var(--faint); }

.panel { padding: 14px 16px 16px; }
.panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.panel-head h3 { font-size: 13px; font-weight: 640; letter-spacing: -.01em; }
.panel-head p { font-size: 10.5px; color: var(--muted); margin-top: 1px; }
.head-link { font-size: 11px; color: var(--muted); }
.head-link:hover { color: var(--accent); }

.heat-card { padding-bottom: 12px; }
.heat-side { display: flex; gap: 18px; }
.heat-stat { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.25; }
.heat-stat strong { font-size: 16px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.heat-stat span { font-size: 9.5px; color: var(--muted); }

.heat-wrap { display: flex; flex-direction: column; gap: 7px; }
.heat-grid {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(7, minmax(0, 1fr));
  grid-template-columns: repeat(52, minmax(0, 1fr));
  gap: 3px;
}
.heat-cell {
  aspect-ratio: 1;
  border-radius: 2.5px;
  background: var(--line-soft);
  cursor: pointer;
  transition: transform .1s, outline-color .1s;
}
.heat-cell:hover { outline: 1.5px solid var(--accent); outline-offset: 1px; }
.heat-cell.lv-1 { background: color-mix(in srgb, var(--accent) 25%, var(--line-soft)); }
.heat-cell.lv-2 { background: color-mix(in srgb, var(--accent) 45%, var(--line-soft)); }
.heat-cell.lv-3 { background: color-mix(in srgb, var(--accent) 70%, var(--line-soft)); }
.heat-cell.lv-4 { background: var(--accent); }
.heat-legend {
  display: flex;
  align-items: center;
  gap: 3px;
  justify-content: flex-end;
  font-size: 9.5px;
  color: var(--faint);
}
.heat-legend i { width: 9px; height: 9px; border-radius: 2px; background: var(--line-soft); }
.heat-legend i.lv-1 { background: color-mix(in srgb, var(--accent) 25%, var(--line-soft)); }
.heat-legend i.lv-2 { background: color-mix(in srgb, var(--accent) 45%, var(--line-soft)); }
.heat-legend i.lv-3 { background: color-mix(in srgb, var(--accent) 70%, var(--line-soft)); }
.heat-legend i.lv-4 { background: var(--accent); }
.heat-legend span { margin: 0 2px; }

.panel-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 12px; }

.bars { display: flex; align-items: flex-end; gap: 6px; height: 128px; padding-top: 12px; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px; height: 100%; min-width: 0; }
.bar-val { font-size: 9px; color: var(--muted); font-variant-numeric: tabular-nums; height: 11px; }
.bar-track { flex: 1; width: 100%; display: flex; align-items: flex-end; }
.bar {
  width: 100%;
  border-radius: 4px 4px 2px 2px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--accent-soft);
  transition: height .45s cubic-bezier(.2, .8, .2, 1);
}
.bar-seg { display: block; width: 100%; background: var(--accent); }
.bar-label { font-size: 9px; color: var(--faint); font-variant-numeric: tabular-nums; }

.donut-wrap { display: flex; align-items: center; gap: 18px; }
.donut { width: 108px; height: 108px; flex: none; }
.donut-num { font-size: 18px; font-weight: 660; fill: var(--ink); font-variant-numeric: tabular-nums; }
.donut-cap { font-size: 8px; fill: var(--muted); }
.legend { flex: 1; display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.legend li { display: flex; align-items: center; gap: 6px; font-size: 11.5px; }
.legend i { width: 7px; height: 7px; border-radius: 2px; flex: none; }
.legend span { color: var(--ink-2); flex: 1; }
.legend strong { font-weight: 650; font-variant-numeric: tabular-nums; }
.legend em { font-style: normal; font-size: 10px; color: var(--faint); width: 32px; text-align: right; }

.dist { display: flex; flex-direction: column; gap: 9px; }
.dist-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dist-name { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); min-width: 0; }
.dist-name .dot { width: 7px; height: 7px; border-radius: 50%; }
.dist-val { font-size: 11px; font-variant-numeric: tabular-nums; color: var(--ink); white-space: nowrap; }
.dist-val em { font-style: normal; color: var(--faint); font-size: 10px; margin-left: 3px; }
.dist-bar { height: 5px; border-radius: 99px; background: var(--line-soft); margin-top: 4px; overflow: hidden; }
.dist-bar i { display: block; height: 100%; border-radius: 99px; transition: width .5s; }

.top-list { display: flex; flex-direction: column; }
.top-list li {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 4px;
  border-radius: 7px;
  cursor: pointer;
  border-bottom: 1px solid var(--line-soft);
}
.top-list li:last-child { border-bottom: 0; }
.top-list li:hover { background: var(--bg-soft); }
.rank {
  width: 17px;
  height: 17px;
  border-radius: 5px;
  background: var(--bg-soft);
  color: var(--muted);
  font-size: 9.5px;
  font-weight: 650;
  display: grid;
  place-items: center;
  flex: none;
}
.top-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.top-title { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.top-sub { font-size: 10px; color: var(--muted); font-variant-numeric: tabular-nums; }
.top-hours { font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; }

.footnote { font-size: 10.5px; color: var(--faint); text-align: center; padding-top: 2px; }

@media (max-width: 1100px) {
  .kpi-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .panel-grid { grid-template-columns: minmax(0, 1fr); }
  .stats-view { padding: 4px 16px 24px; }
}

@media (max-width: 760px) {
  .stats-view { padding: 4px 12px 20px; gap: 10px; }
  .kpi-row { gap: 8px; }
  .kpi { padding: 10px 12px; }
  .kpi-val strong { font-size: 21px; }
  .panel { padding: 12px 13px 14px; }
  .heat-grid { gap: 2px; }
  .heat-stat:nth-child(2) { display: none; }
  .heat-side { gap: 0; }
  .donut-wrap { gap: 12px; }
  .donut { width: 92px; height: 92px; }
}
</style>
