<script setup lang="ts">
/** 底线抽屉：原版顶栏「三横线」按钮打开的「不做清单」。 */
import { ref, watch } from 'vue'
import type { Note } from '../../types'
import { api } from '../../api'
import { stripHtml } from '../../utils/edge'

const props = defineProps<{ open: boolean; baseTag: string }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'create'): void
  (e: 'open', note: Note): void
}>()

const items = ref<Note[]>([])
const loading = ref(false)

async function load() {
  if (!props.open) return
  loading.value = true
  try {
    const res: any = await api.notes.list({ zone: 'inspiration', limit: 500 } as any)
    items.value = (res.notes || []).filter((n: Note) => n.tags?.includes(props.baseTag))
      .sort((a: Note, b: Note) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt)
  } catch (_) {
    items.value = []
  } finally {
    loading.value = false
  }
}

watch(() => props.open, (v) => { if (v) void load() })

function firstLine(n: Note): string {
  const text = stripHtml(n.think || n.content || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '（空）'
  return text.length > 90 ? text.slice(0, 90) + '…' : text
}

function dateText(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
</script>

<template>
  <div v-if="open" class="drawer" role="dialog" aria-modal="true" aria-label="底线">
    <div class="drawer-backdrop" @click="emit('close')" />
    <aside class="drawer-panel">
      <div class="drawer-head">
        <div>
          <b>底线</b>
          <p>无论什么行情都不做的那几条。</p>
        </div>
        <button class="icon-btn small" aria-label="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      <ul class="drawer-list">
        <li v-for="n in items" :key="n.id" @click="emit('open', n)">
          <div class="base-main">{{ firstLine(n) }}</div>
          <div class="base-foot">
            <span>{{ dateText(n.createdAt) }}</span>
            <span v-if="n.pinned" class="pin-dot">当前</span>
            <span v-else class="dim">历史</span>
            <button class="link-btn" @click.stop="emit('open', n)">改</button>
          </div>
        </li>
        <li v-if="!loading && !items.length" class="dim" style="padding: 16px 0; cursor: default">
          还没有写底线。底线 = 无论什么行情都不做的那几条。
        </li>
      </ul>

      <div class="drawer-foot">
        <button class="ghost-btn" @click="emit('create')">写一条新底线</button>
      </div>
    </aside>
  </div>
</template>
