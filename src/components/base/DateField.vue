<script setup lang="ts">
/**
 * 日期选择：一个按钮 + 弹层。
 * 常用日期一键点（今天 / 本周五 / 下周五 / 本月底），也可以直接选日历。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { addDays, endOfMonth, format, nextFriday } from 'date-fns'
import Icon from './Icon.vue'
import { fromKey, keyOf, todayKey } from '../../utils/date'

const props = withDefaults(defineProps<{
  modelValue: string | null
  placeholder?: string
  /** 是否允许清除 */
  clearable?: boolean
  /** due = 截止日（会提示剩余/逾期）；start = 开始日（提示已进行的天数） */
  mode?: 'due' | 'start'
}>(), { placeholder: '选择日期', clearable: true, mode: 'due' })

const emit = defineEmits<{ (e: 'update:modelValue', v: string | null): void }>()

const open = ref(false)

const label = computed(() => {
  if (!props.modelValue) return null
  const d = fromKey(props.modelValue)
  const diff = Math.round((d.getTime() - fromKey(todayKey()).getTime()) / 86400000)
  const text = format(d, 'M 月 d 日')

  if (props.mode === 'start') {
    if (diff === 0) return { text, hint: '今天开始', tone: 'now' }
    if (diff > 0) return { text, hint: `${diff} 天后开始`, tone: 'future' }
    return { text, hint: `已进行 ${1 - diff} 天`, tone: 'past' }
  }

  if (diff === 0) return { text, hint: '今天到期', tone: 'now' }
  if (diff === 1) return { text, hint: '明天到期', tone: 'soon' }
  if (diff === -1) return { text, hint: '逾期 1 天', tone: 'late' }
  if (diff > 0) return { text, hint: `还有 ${diff} 天`, tone: diff <= 3 ? 'soon' : 'future' }
  return { text, hint: `逾期 ${-diff} 天`, tone: 'late' }
})

const quick = computed(() => {
  const today = new Date()
  const base = fromKey(todayKey())
  const friday = nextFriday(today)
  return [
    { label: '今天', value: keyOf(base) },
    { label: '本周五', value: keyOf(friday) },
    { label: '两周后', value: keyOf(addDays(base, 14)) },
    { label: '本月底', value: keyOf(endOfMonth(base)) },
  ]
})

function pick(v: string | null) {
  emit('update:modelValue', v)
  open.value = false
}

function onNative(e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (v) pick(v)
}

function onDocDown(e: MouseEvent) {
  if (!open.value) return
  if (!(e.target as HTMLElement).closest('.df-wrap')) open.value = false
}
window.addEventListener('pointerdown', onDocDown)
onBeforeUnmount(() => window.removeEventListener('pointerdown', onDocDown))
</script>

<template>
  <div class="df df-wrap">
    <button type="button" class="df-btn" :class="label ? 'has-value ' + label.tone : ''" @click="open = !open">
      <Icon name="calendar" :size="13" />
      <span class="df-text">{{ label ? label.text : placeholder }}</span>
      <span v-if="label" class="df-hint">{{ label.hint }}</span>
    </button>

    <Transition name="df-pop">
      <div v-if="open" class="df-pop">
        <div class="df-quick">
          <button
            v-for="q in quick"
            :key="q.label"
            type="button"
            class="df-chip"
            :class="{ 'is-on': modelValue === q.value }"
            @click="pick(q.value)"
          >{{ q.label }}</button>
        </div>
        <label class="df-native">
          <span>选具体日期</span>
          <input type="date" :value="modelValue || ''" @change="onNative" />
        </label>
        <button v-if="clearable && modelValue" type="button" class="df-clear" @click="pick(null)">
          清除日期
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.df { position: relative; display: inline-flex; min-width: 0; }
.df-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 9px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--panel);
  font-size: 12px;
  color: var(--muted);
  min-width: 0;
}
.df-btn:hover { border-color: var(--accent); color: var(--ink); }
.df-btn.has-value { color: var(--ink); }
.df-btn.has-value.late { border-color: color-mix(in srgb, var(--danger) 40%, var(--line)); }
.df-text { font-variant-numeric: tabular-nums; white-space: nowrap; }
.df-hint {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-soft);
  color: var(--muted);
  white-space: nowrap;
}
.late .df-hint { background: var(--danger-soft); color: var(--danger); }
.soon .df-hint { background: rgba(183, 121, 31, .14); color: var(--warn); }

.df-pop {
  position: absolute;
  top: calc(100% + 5px);
  left: 0;
  width: 236px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--panel);
  box-shadow: var(--shadow-md);
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.df-quick { display: flex; flex-wrap: wrap; gap: 4px; }
.df-chip {
  height: 26px;
  padding: 0 9px;
  border-radius: 7px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  font-size: 11.5px;
  color: var(--ink-2);
}
.df-chip:hover { border-color: var(--accent); color: var(--accent); }
.df-chip.is-on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 600; }

.df-native {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--muted);
  border-top: 1px solid var(--line-soft);
  padding-top: 7px;
}
.df-native input {
  flex: 1;
  min-width: 0;
  height: 28px;
  font-size: 11.5px;
  padding: 0 6px;
  border-radius: 7px;
}

.df-clear {
  align-self: flex-start;
  font-size: 11px;
  color: var(--muted);
  padding: 2px 6px;
  border-radius: 5px;
}
.df-clear:hover { color: var(--danger); background: var(--danger-soft); }

.df-pop-enter-active, .df-pop-leave-active { transition: opacity .12s, transform .12s; }
.df-pop-enter-from, .df-pop-leave-to { opacity: 0; transform: translateY(-3px); }
</style>
