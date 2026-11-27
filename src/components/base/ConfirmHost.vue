<script setup lang="ts">
import { ref, watch } from 'vue'
import { settleConfirm, ui } from '../../stores/ui'

const extraValue = ref('')

watch(() => ui.confirm, (c) => {
  extraValue.value = c?.extra?.value || ''
})

function cancel() {
  settleConfirm(false)
}

function accept() {
  if (ui.confirm?.extra) ui.confirm.extra.value = extraValue.value
  settleConfirm(true)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="ui.confirm" class="scrim" style="z-index: 90" @click="cancel" />
    </Transition>
    <Transition name="fade">
      <div v-if="ui.confirm" class="confirm" role="dialog" aria-modal="true">
        <h3>{{ ui.confirm.title }}</h3>
        <p v-if="ui.confirm.message">{{ ui.confirm.message }}</p>

        <div v-if="ui.confirm.extra" class="extra">
          <label>{{ ui.confirm.extra.label }}</label>
          <select v-model="extraValue">
            <option v-for="opt in ui.confirm.extra.options" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="confirm-actions">
          <button class="btn" @click="cancel">{{ ui.confirm.cancelText || '取消' }}</button>
          <button
            class="btn"
            :class="ui.confirm.danger ? 'danger-solid' : 'primary'"
            @click="accept"
          >{{ ui.confirm.confirmText || '确定' }}</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm {
  position: fixed;
  z-index: 100;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(400px, calc(100vw - 36px));
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  padding: 20px;
  animation: pop .18s cubic-bezier(.2, .9, .3, 1);
}
.confirm h3 {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -.015em;
  line-height: 1.4;
}
.confirm p {
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.65;
  margin-top: 6px;
}
.extra { margin-top: 14px; display: flex; flex-direction: column; gap: 5px; }
.extra label { font-size: 11px; font-weight: 600; color: var(--muted); }
.extra select { height: 33px; font-size: 12.5px; }
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
.danger-solid {
  background: var(--danger);
  border-color: transparent;
  color: #fff;
}
.danger-solid:hover { filter: brightness(1.06); background: var(--danger); color: #fff; }
</style>
