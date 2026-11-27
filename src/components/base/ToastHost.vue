<script setup lang="ts">
import Icon from './Icon.vue'
import { dismissToast, ui } from '../../stores/ui'
</script>

<template>
  <Teleport to="body">
    <div class="toasts">
      <TransitionGroup name="toast">
        <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="`t-${t.tone}`">
          <Icon
            :name="t.tone === 'success' ? 'check' : t.tone === 'error' || t.tone === 'warn' ? 'alert' : 'info'"
            :size="14"
          />
          <span class="toast-text">{{ t.message }}</span>
          <button v-if="t.actionLabel" class="toast-action" @click="t.onAction?.(); dismissToast(t.id)">
            {{ t.actionLabel }}
          </button>
          <button class="toast-close" @click="dismissToast(t.id)">
            <Icon name="close" :size="11" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 300;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 8px 10px 8px 12px;
  border-radius: 10px;
  background: var(--ink);
  color: var(--panel);
  font-size: 12.5px;
  box-shadow: var(--shadow-md);
  max-width: 340px;
}
[data-theme="dark"] .toast { background: #2a3038; color: #eef1f5; }
.toast.t-success svg { color: #6ee7a8; }
.toast.t-warn svg { color: #f3c969; }
.toast.t-error svg { color: #ff8f8a; }
.toast-text { flex: 1; }
.toast-action {
  font-size: 12px;
  font-weight: 600;
  color: #a8bcff;
  padding: 2px 6px;
  border-radius: 5px;
  white-space: nowrap;
}
.toast-action:hover { background: rgba(255, 255, 255, .12); color: #fff; }
.toast-close { color: rgba(255, 255, 255, .45); display: grid; place-items: center; }
.toast-close:hover { color: #fff; }

.toast-enter-active, .toast-leave-active { transition: all .24s cubic-bezier(.2, .9, .3, 1); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(8px) scale(.97); }
</style>
