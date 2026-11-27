<script setup lang="ts">
/** 灵感卡片：结构与类名照搬 inspiration 的 inspirationCard()，CSS 由原皮肤提供 */
import { computed } from 'vue'
import type { Note } from '../../types'
import { clipText, esc, fmtDay, highlight, relTime, stripHtml } from '../../utils/edge'

const props = defineProps<{
  note: Note
  index: number
  query?: string
  baseTag?: string
}>()

const emit = defineEmits<{
  (e: 'read', note: Note): void
  (e: 'edit', note: Note): void
  (e: 'pin', note: Note): void
  (e: 'remove', note: Note): void
  (e: 'upgrade', note: Note): void
  (e: 'file', note: Note): void
  (e: 'tag', tag: string): void
  (e: 'image', payload: { note: Note; index: number }): void
}>()

const TYPE_LABEL: Record<string, string> = {
  review: '复盘', strategy: '策略', insight: '心得', idea: '灵感',
}

const text = computed(() => stripHtml(props.note.content) || props.note.think || '')
const folded = computed(() => text.value.length > 180 || text.value.split('\n').length > 7)
const preview = computed(() => (folded.value ? text.value.replace(/\s+/g, ' ').slice(0, 180) : text.value))
const commentCount = computed(() => (props.note.comments || []).length)
const images = computed(() => (props.note.images || []).filter((i) => i && i.url))
const isNew = computed(() => Date.now() - props.note.createdAt < 4000)
</script>

<template>
  <article
    class="note note-simple"
    :class="[`t-${note.type}`, { pinned: note.pinned }]"
    :data-id="note.id"
    :style="{ animationDelay: (isNew ? 0 : Math.min(index * 24, 200)) + 'ms' }"
  >
    <div class="note-top">
      <span v-if="note.seq" class="note-seq" :title="`引用这条：在正文里写 @${note.seq}`">#{{ note.seq }}</span>
      <span class="note-type">{{ TYPE_LABEL[note.type] || '灵感' }}</span>
      <span v-if="note.triage === 'inbox'" class="note-badge inbox">待归类</span>
    </div>

    <div class="note-text" :class="{ 'is-folded': folded }" v-html="highlight(preview, query || '')" />
    <button v-if="folded" type="button" class="nt-more" @click="emit('read', note)">
      全文<span class="nt-meta">共 {{ text.length }} 字</span>
    </button>

    <div v-if="images.length" class="note-images" :class="`n-${Math.min(images.length, 3)}`">
      <button
        v-for="(img, idx) in images"
        :key="idx"
        class="ni"
        :aria-label="`查看第 ${idx + 1} 张图`"
        @click.stop="emit('image', { note, index: idx })"
      >
        <img :src="img.url" alt="" loading="lazy" />
      </button>
    </div>

    <div v-if="note.tags.length" class="note-tags">
      <span v-for="t in note.tags" :key="t" class="note-tag" @click.stop="emit('tag', t)">#{{ t }}</span>
    </div>

    <div class="note-foot">
      <span class="note-time" :title="new Date(note.createdAt).toLocaleString('zh-CN', { hour12: false })">
        {{ fmtDay(note.createdAt) }}　{{ relTime(note.createdAt) }}
      </span>
      <div class="note-actions">
        <button class="mini-btn text cmt-btn" title="看全文、留言" @click.stop="emit('read', note)">
          {{ commentCount ? `留言 ${commentCount}` : '详情' }}
        </button>
        <button class="mini-btn text" title="复制成一条复盘记录（原灵感保留）" @click.stop="emit('upgrade', note)">升级</button>
        <button
          v-if="note.triage === 'inbox'"
          class="mini-btn text"
          title="归档，不再占待归类"
          @click.stop="emit('file', note)"
        >归档</button>
        <button class="mini-btn" :class="{ on: note.pinned }" :title="note.pinned ? '取消置顶' : '置顶'" @click.stop="emit('pin', note)">
          <svg viewBox="0 0 24 24" class="ic"><path d="M12 3.5v9" /><path d="M8 7.5h8" /><path d="m9 12.5-1.5 8h9l-1.5-8" /></svg>
        </button>
        <button class="mini-btn" title="编辑" @click.stop="emit('edit', note)">
          <svg viewBox="0 0 24 24" class="ic"><path d="M15.5 4.5l4 4L8 20l-4.5.5L4 16Z" /></svg>
        </button>
        <button class="mini-btn danger" title="删除" @click.stop="emit('remove', note)">
          <svg viewBox="0 0 24 24" class="ic"><path d="M4 7h16" /><path d="M9.5 4h5" /><path d="M6.5 7l.8 13h9.4l.8-13" /></svg>
        </button>
      </div>
    </div>
  </article>
</template>
