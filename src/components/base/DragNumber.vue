<script setup lang="ts">
/**
 * 拖拽数字轴：一条轨道，按住拖动即可改数值。
 * - 指针拖动 / 点轨道跳转 / 键盘 ←→（Shift 精细） / 点数字弹出快捷值
 * - 数值吸附到 step，避免出现 2.4999 这类脏数据
 */
import { computed, onBeforeUnmount, ref } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: number
  min?: number
  max?: number
  step?: number
  unit?: string
  /** 快捷值，点数值弹出 */
  presets?: number[]
  /** 显示右侧数值胶囊 */
  showValue?: boolean
  /** 轨道高度，px */
  height?: number
  /** 轨道颜色，默认强调色 */
  color?: string
  disabled?: boolean
  ariaLabel?: string
}>(), {
  min: 0,
  max: 24,
  step: 0.5,
  unit: 'h',
  presets: () => [],
  showValue: true,
  height: 6,
  color: '',
  disabled: false,
  ariaLabel: '数值',
})

const emit = defineEmits<{ (e: 'update:modelValue', v: number): void }>()

const trackEl = ref<HTMLElement | null>(null)
const dragging = ref(false)
const hover = ref(false)
const presetsOpen = ref(false)

const value = computed(() => clampSnap(props.modelValue))
const pct = computed(() => {
  const span = props.max - props.min || 1
  return Math.max(0, Math.min(100, ((value.value - props.min) / span) * 100))
})

const display = computed(() => {
  const v = value.value
  const rounded = Math.round(v * 100) / 100
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2).replace(/0$/, '')}${props.unit}`
})

function decimals(step: number): number {
  const s = String(step)
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

function clampSnap(v: number): number {
  if (!isFinite(v)) return props.min
  const steps = Math.round((v - props.min) / props.step)
  const snapped = props.min + steps * props.step
  const fixed = Number(snapped.toFixed(decimals(props.step) + 1))
  return Math.min(props.max, Math.max(props.min, fixed))
}

function commit(v: number) {
  const next = clampSnap(v)
  if (next !== props.modelValue) emit('update:modelValue', next)
}

function valueAt(clientX: number): number {
  const el = trackEl.value
  if (!el) return value.value
  const r = el.getBoundingClientRect()
  const ratio = (clientX - r.left) / Math.max(1, r.width)
  return props.min + ratio * (props.max - props.min)
}

function onPointerDown(e: PointerEvent) {
  if (props.disabled) return
  presetsOpen.value = false
  dragging.value = true
  commit(valueAt(e.clientX))
  try {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  } catch {
    /* 某些环境（合成事件 / 已释放的指针）不支持捕获，忽略即可 */
  }
  e.preventDefault()
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  commit(valueAt(e.clientX))
}

function onPointerUp(e: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  const el = e.currentTarget as HTMLElement
  try {
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  } catch { /* ignore */ }
}

function nudge(delta: number) {
  commit(value.value + delta)
}

function onKey(e: KeyboardEvent) {
  if (props.disabled) return
  const fine = e.shiftKey ? props.step / 2 : props.step
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { nudge(-fine); e.preventDefault() }
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { nudge(fine); e.preventDefault() }
  if (e.key === 'Home') { commit(props.min); e.preventDefault() }
  if (e.key === 'End') { commit(props.max); e.preventDefault() }
}

function pickPreset(v: number) {
  commit(v)
  presetsOpen.value = false
}

function onDocDown(e: MouseEvent) {
  if (!presetsOpen.value) return
  const el = e.target as HTMLElement
  if (!el.closest('.dn-wrap')) presetsOpen.value = false
}
window.addEventListener('pointerdown', onDocDown)
onBeforeUnmount(() => window.removeEventListener('pointerdown', onDocDown))
</script>

<template>
  <div
    class="dn dn-wrap"
    :class="{ 'is-dragging': dragging, 'is-disabled': disabled }"
    :style="{ '--dn-h': height + 'px', '--dn-c': color || 'var(--accent)' }"
  >
    <div
      ref="trackEl"
      class="dn-track"
      role="slider"
      tabindex="0"
      :aria-label="ariaLabel"
      :aria-valuemin="min"
      :aria-valuemax="max"
      :aria-valuenow="value"
      :aria-valuetext="display"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerenter="hover = true"
      @pointerleave="hover = false"
      @keydown="onKey"
    >
      <i class="dn-fill" :style="{ width: pct + '%' }" />
      <i class="dn-knob" :style="{ left: pct + '%' }" />
    </div>

    <button
      v-if="showValue"
      type="button"
      class="dn-value"
      :title="presets.length ? '点击选择常用值' : '拖动左侧轨道调整'"
      :disabled="disabled"
      @click.stop="presetsOpen = !presetsOpen"
    >{{ display }}</button>

    <Transition name="dn-pop">
      <div v-if="presetsOpen && presets.length" class="dn-presets">
        <button
          v-for="p in presets"
          :key="p"
          type="button"
          class="dn-preset"
          :class="{ 'is-on': p === value }"
          @click.stop="pickPreset(p)"
        >{{ p }}{{ unit }}</button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.dn {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
}
.dn-track {
  position: relative;
  flex: 1;
  min-width: 54px;
  height: var(--dn-h);
  border-radius: 99px;
  background: var(--line);
  cursor: ew-resize;
  touch-action: none;
  outline: none;
  transition: background .15s;
}
.dn-track:hover,
.dn-track:focus-visible { background: color-mix(in srgb, var(--dn-c) 22%, var(--line)); }
.dn-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 99px;
  background: var(--dn-c);
  opacity: .85;
}
.dn-knob {
  position: absolute;
  top: 50%;
  width: calc(var(--dn-h) + 6px);
  height: calc(var(--dn-h) + 6px);
  margin-left: calc((var(--dn-h) + 6px) / -2);
  border-radius: 50%;
  background: var(--panel);
  border: 2px solid var(--dn-c);
  box-shadow: 0 1px 4px rgba(0, 0, 0, .18);
  transform: translateY(-50%);
  transition: transform .12s;
  pointer-events: none;
}
.dn.is-dragging .dn-knob,
.dn-track:focus-visible .dn-knob { transform: translateY(-50%) scale(1.16); }
.dn.is-disabled { opacity: .45; pointer-events: none; }

.dn-value {
  flex: none;
  min-width: 40px;
  height: 26px;
  padding: 0 7px;
  border-radius: 7px;
  border: 1px solid var(--line);
  background: var(--panel);
  font-size: 11.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
  letter-spacing: -.01em;
}
.dn-value:hover { border-color: var(--dn-c); color: var(--dn-c); }

.dn-presets {
  position: absolute;
  bottom: calc(100% + 4px);
  right: 0;
  display: flex;
  gap: 3px;
  padding: 4px;
  border-radius: 9px;
  background: var(--panel);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-md);
  z-index: 12;
}
.dn-preset {
  height: 24px;
  padding: 0 7px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}
.dn-preset:hover { background: var(--bg-soft); }
.dn-preset.is-on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }

.dn-pop-enter-active, .dn-pop-leave-active { transition: opacity .12s, transform .12s; }
.dn-pop-enter-from, .dn-pop-leave-to { opacity: 0; transform: translateY(3px); }
</style>
