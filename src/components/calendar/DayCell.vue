<script setup lang="ts">
import { computed } from 'vue'
import type { Entry } from '../../types.studio'
import { projectColor, projectName } from '../../stores/data'
import type { MonthCell } from '../../utils/date'
import { fmtHours } from '../../utils/format'
import { settings } from '../../stores/settings'
import Icon from '../base/Icon.vue'

const props = defineProps<{
  cell: MonthCell
  entries: Entry[]
  summary: string
  today?: string
}>()

const emit = defineEmits<{
  (e: 'open', date: string): void
  (e: 'move-start', id: string): void
  (e: 'move-end', date: string): void
}>()

const maxChips = computed(() => (settings.density === 'compact' ? 2 : 3))
const visible = computed(() => props.entries.slice(0, maxChips.value))
const overflow = computed(() => Math.max(0, props.entries.length - maxChips.value))
const total = computed(() => props.entries.reduce((s, e) => s + e.hours, 0))
const hasAttachment = computed(() => props.entries.some((e) => e.attachmentIds.length > 0))
const hasBlocked = computed(() => props.entries.some((e) => e.status === 'blocked'))
const hasDoing = computed(() => props.entries.some((e) => e.status === 'doing'))
const overGoal = computed(() => settings.dailyGoal > 0 && total.value > settings.dailyGoal)
</script>

<template>
  <div
    class="cell"
    :class="{
      'is-out': !cell.inMonth,
      'is-today': cell.isToday,
      'is-weekend': cell.isWeekend && cell.inMonth,
      'is-selected': false,
    }"
    role="button"
    tabindex="0"
    @click="emit('open', cell.key)"
    @keydown.enter="emit('open', cell.key)"
    @keydown.space.prevent="emit('open', cell.key)"
    @dragover.prevent
    @drop.prevent="emit('move-end', cell.key)"
  >
    <div class="cell-head">
      <span class="daynum">{{ cell.day }}</span>
      <span v-if="total > 0" class="cell-hours" :class="{ 'is-over': overGoal }">{{ fmtHours(total) }}h</span>
    </div>

    <div class="cell-body">
      <div
        v-for="e in visible"
        :key="e.id"
        class="chip"
        :style="{ '--c': projectColor(e.projectId) }"
        :title="`${e.title} · ${projectName(e.projectId)} · ${fmtHours(e.hours)}h`"
        draggable="true"
        @dragstart.stop="emit('move-start', e.id)"
        @click.stop="emit('open', cell.key)"
      >
        <span class="chip-dot" />
        <span class="chip-title">{{ e.title }}</span>
        <span v-if="e.hours" class="chip-hours">{{ fmtHours(e.hours) }}</span>
      </div>
      <button v-if="overflow" class="chip-more" @click.stop="emit('open', cell.key)">
        +{{ overflow }} 条
      </button>
    </div>

    <div class="cell-foot">
      <span v-if="summary" class="mark" title="有当日总结"><Icon name="list" :size="10" /></span>
      <span v-if="hasAttachment" class="mark" title="有附件"><Icon name="clip" :size="10" /></span>
      <span v-if="hasBlocked" class="mark mark-warn" title="有受阻事项"><Icon name="alert" :size="10" /></span>
      <span v-else-if="hasDoing" class="mark mark-doing" title="有进行中事项" />
    </div>
  </div>
</template>

<style scoped>
.cell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  min-height: 0;
  padding: 6px 6px 4px;
  background: var(--panel);
  border-right: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
  cursor: pointer;
  overflow: hidden;
  transition: background .13s;
}
.cell:hover { background: color-mix(in srgb, var(--accent) 4%, var(--panel)); }
.cell.is-weekend { background: color-mix(in srgb, var(--ink) 1.6%, var(--panel)); }
.cell.is-weekend:hover { background: color-mix(in srgb, var(--accent) 4%, var(--panel)); }
.cell.is-out { background: var(--bg); }
.cell.is-out .daynum { color: var(--faint); opacity: .6; }
.cell.is-out .chip { opacity: .45; }
.cell.is-today { background: color-mix(in srgb, var(--accent) 4%, var(--panel)); }
[data-theme="dark"] .cell.is-today { background: color-mix(in srgb, var(--accent) 3.5%, var(--panel)); }
.cell.is-today::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: var(--accent);
  opacity: .85;
  pointer-events: none;
}

.cell-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  min-height: 17px;
}
.daynum {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
  width: 19px;
  height: 19px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  letter-spacing: -.02em;
}
.is-today .daynum { background: var(--accent); color: #fff; font-weight: 700; }
.cell-hours {
  font-size: 9.5px;
  font-weight: 600;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  letter-spacing: -.01em;
}
.cell-hours.is-over { color: var(--accent); }

.cell-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
  flex: 1;
}

.chip {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: 17px;
  padding: 0 4px;
  border-radius: 3px 4px 4px 3px;
  background: color-mix(in srgb, var(--c) 12%, transparent);
  border-left: 2px solid var(--c);
  overflow: hidden;
  flex: none;
}
[data-theme="dark"] .chip {
  background: color-mix(in srgb, var(--ink) 5.5%, transparent);
  border-left-color: var(--c);
  border-left-width: 2.5px;
}
[data-theme="dark"] .chip .chip-dot { background: var(--c); }
.chip-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--c); flex: none; display: none; }
.chip-title {
  flex: 1;
  min-width: 0;
  font-size: 10.5px;
  line-height: 1;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -.01em;
}
[data-theme="dark"] .chip-title { color: #e7eaf0; }
.chip-hours {
  font-size: 9px;
  color: var(--ink-2);
  opacity: .8;
  font-variant-numeric: tabular-nums;
  flex: none;
}
.chip-more {
  font-size: 9.5px;
  color: var(--muted);
  text-align: left;
  padding: 0 4px;
  line-height: 1.5;
  flex: none;
}
.chip-more:hover { color: var(--accent); }

.cell-foot {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 10px;
  flex: none;
}
.mark {
  display: inline-flex;
  align-items: center;
  color: var(--faint);
}
.mark-doing { width: 4px; height: 4px; border-radius: 50%; background: var(--warn); }
.mark-warn { color: var(--danger); }

@media (max-width: 760px) {
  .cell { padding: 4px 3px 3px; gap: 3px; border-right-color: var(--line-soft); }
  .cell.is-today::before { border-width: 1px; }
  .daynum { font-size: 10px; width: 16px; height: 16px; }
  .cell-hours { display: block; font-size: 8px; opacity: .8; }
  .chip {
    height: 5px;
    padding: 0;
    border-radius: 2px;
    border-left: 0;
    background: var(--c);
    opacity: .72;
    gap: 0;
  }
  .chip-dot, .chip-title, .chip-hours { display: none; }
  .chip-more { font-size: 8.5px; padding: 0 2px; }
  .cell-foot { display: none; }
}
</style>
