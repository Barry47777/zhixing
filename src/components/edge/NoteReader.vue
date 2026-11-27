<script setup lang="ts">
/** 灵感全文阅读页：结构照搬 inspiration 的 .reader，含图片、标签、引用、留言 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Note } from '../../types'
import { api } from '../../api'
import { toast } from '../../stores/ui'
import { clipText, esc, fmtDay, highlight, relTime, stripHtml } from '../../utils/edge'
import LightBox from './LightBox.vue'

const props = defineProps<{ note: Note; query?: string }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'edit', note: Note): void
  (e: 'tag', tag: string): void
  (e: 'goto', payload: { id: string; zone: string }): void
  (e: 'changed', note: Note): void
}>()

const note = ref<Note>({ ...props.note })
const refs = ref<{ id: string; seq: number; title: string; zone: string }[]>([])
const backrefs = ref<{ id: string; seq: number; title: string; zone: string }[]>([])
const lightbox = ref<number | null>(null)
const draft = ref('')
const sending = ref(false)
const scroller = ref<HTMLElement | null>(null)
const progress = ref(0)
const scrolled = ref(false)

const TYPE_LABEL: Record<string, string> = { review: '复盘', strategy: '策略', insight: '心得', idea: '灵感' }

const plain = computed(() => stripHtml(note.value.content) || note.value.think || '')
const words = computed(() => plain.value.replace(/\s+/g, '').length)
const headline = computed(() => {
  const line = plain.value.split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).find(Boolean) || '（无正文）'
  const m = line.match(/^.{6,40}?[。！？!?…]/)
  return m ? m[0] : clipText(line, 44)
})
const images = computed(() => (note.value.images || []).filter((i) => i && i.url))
const comments = computed(() => [...(note.value.comments || [])].sort((a, b) => Number(a.at) - Number(b.at)))

async function load() {
  try {
    const full: any = await api.notes.get(props.note.id)
    if (full?.note) note.value = full.note
    refs.value = full?.refs || []
    backrefs.value = full?.backrefs || []
  } catch (_) { /* 就用列表里的这一份 */ }
  await nextTick()
  onScroll()
}

onMounted(() => {
  void load()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (lightbox.value !== null) { lightbox.value = null; return }
    emit('close')
  }
}

function onScroll() {
  const el = scroller.value
  if (!el) return
  const max = el.scrollHeight - el.clientHeight
  // 跟原版一致：内容没长到需要滚动时，进度条直接是满的
  progress.value = max > 4 ? Math.min(1, Math.max(0, el.scrollTop / max)) * 100 : 100
  scrolled.value = el.scrollTop > 6
}

async function copyAll() {
  const text = plain.value
  try {
    await navigator.clipboard.writeText(text)
    toast('复制好了', 'success')
  } catch (_) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy'); toast('复制好了', 'success') } catch (_e) { toast('浏览器不让复制，手动选中吧', 'warn') }
    ta.remove()
  }
}

async function send() {
  const text = draft.value.trim()
  if (!text || sending.value) return
  sending.value = true
  try {
    const res = await api.notes.comments.add(note.value.id, text)
    note.value.comments = [...(note.value.comments || []), res.comment]
    draft.value = ''
    toast('留言加上了', 'success')
    emit('changed', note.value)
  } catch (err: any) {
    toast(err?.message || '留言没发出去', 'error')
  } finally {
    sending.value = false
  }
}

async function removeComment(id: string) {
  try {
    await api.notes.comments.remove(note.value.id, id)
    note.value.comments = (note.value.comments || []).filter((c) => c.id !== id)
    emit('changed', note.value)
  } catch (err: any) {
    toast(err?.message || '没删掉', 'error')
  }
}

function seedFromComment(text: string) {
  void navigator.clipboard.writeText(text).catch(() => {})
  toast('已复制，去灵感框里粘贴就是一条新灵感', 'success')
}
</script>

<template>
  <div class="reader-mask" @click="emit('close')" />
  <section class="reader" :class="{ 'is-scrolled': scrolled }" role="dialog" aria-modal="true" aria-labelledby="readerTitle">
    <div class="reader-glow" aria-hidden="true" />
    <header class="reader-head">
      <div class="reader-head-inner">
        <div class="reader-head-main">
          <span class="reader-kind">{{ note.seq ? `#${note.seq} · ` : '' }}{{ TYPE_LABEL[note.type] || '灵感' }}</span>
          <h2 id="readerTitle" class="reader-title">{{ headline }}</h2>
          <p class="reader-meta">
            {{ new Date(note.createdAt).toLocaleString('zh-CN', { hour12: false }) }} · {{ words }} 字
            <template v-if="comments.length"> · {{ comments.length }} 条留言</template>
          </p>
        </div>
        <button class="reader-close" type="button" aria-label="关闭阅读页（Esc）" title="关闭（Esc）" @click="emit('close')">
          <svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div class="reader-progress" aria-hidden="true">
        <i :style="{ transform: 'scaleX(' + (progress / 100).toFixed(4) + ')' }" />
      </div>
    </header>

    <div ref="scroller" class="reader-scroll" @scroll="onScroll">
      <div class="reader-body">
        <div class="reader-content" v-html="note.content || `<p>${esc(note.think)}</p>`" />

        <section v-if="images.length" class="r-sec">
          <h4>图</h4>
          <div class="nd-imgs">
            <button
              v-for="(img, idx) in images"
              :key="idx"
              class="ni"
              :aria-label="`查看第 ${idx + 1} 张图`"
              title="点开看大图"
              @click="lightbox = idx"
            >
              <img :src="img.url" alt="" loading="lazy" />
            </button>
          </div>
        </section>

        <section v-if="note.tags.length" class="r-sec">
          <h4>标签</h4>
          <div class="r-tags">
            <button
              v-for="t in note.tags"
              :key="t"
              class="note-tag"
              type="button"
              title="只看这个标签"
              @click="emit('tag', t)"
            >#{{ t }}</button>
          </div>
        </section>

        <section v-if="refs.length" class="r-sec">
          <h4>引用</h4>
          <div class="nd-chips">
            <button
              v-for="r in refs"
              :key="r.id"
              class="ref-chip"
              :data-zone="r.zone"
              @click="emit('goto', { id: r.id, zone: r.zone })"
            >
              <i v-if="r.zone !== 'inspiration'" class="lk-zone">复盘</i>{{ clipText(r.title || String(r.seq), 24) }}
            </button>
          </div>
        </section>

        <section v-if="backrefs.length" class="r-sec">
          <h4>被引用</h4>
          <div class="nd-chips">
            <button
              v-for="r in backrefs"
              :key="r.id"
              class="ref-chip"
              :data-zone="r.zone"
              @click="emit('goto', { id: r.id, zone: r.zone })"
            >
              <i v-if="r.zone !== 'inspiration'" class="lk-zone">复盘</i>{{ clipText(r.title || String(r.seq), 24) }}
            </button>
          </div>
        </section>

        <section class="r-sec cmt-sec">
          <h4>留言 <span v-if="comments.length" class="cmt-count">{{ comments.length }}</span></h4>
          <div class="cmt-list">
            <div v-if="!comments.length" class="cmt-empty">
              <svg viewBox="0 0 24 24" class="ic" aria-hidden="true">
                <path d="M9 7H5.5A1.5 1.5 0 0 0 4 8.5v3A1.5 1.5 0 0 0 5.5 13H7v3l3.5-3h3" />
                <path d="M15.5 4.5h5" />
              </svg>
              <p>还没有留言。<span>写一句，给这条加个脚注。</span></p>
            </div>
            <div v-for="c in comments" :key="c.id" class="cmt-item">
              <span class="cmt-ava" aria-hidden="true">我</span>
              <div class="cmt-main">
                <p class="cmt-text" v-html="highlight(c.text, query || '')" />
                <div class="cmt-meta">
                  <span class="cmt-time" :title="new Date(c.at).toLocaleString('zh-CN', { hour12: false })">{{ relTime(c.at) }}</span>
                  <span class="cmt-acts">
                    <button class="cmt-act" type="button" @click="seedFromComment(c.text)">复制</button>
                    <button class="cmt-act is-danger" type="button" @click="removeComment(c.id)">删除</button>
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div class="cmt-form">
            <textarea
              v-model="draft"
              class="cmt-input"
              rows="2"
              maxlength="500"
              placeholder="写一句…给这条加个脚注"
              @keydown.ctrl.enter.prevent="send"
              @keydown.meta.enter.prevent="send"
            />
            <div class="cmt-bar">
              <span class="cmt-hint"><kbd>Ctrl</kbd><kbd>↵</kbd><span class="cmt-hint-t">发送</span></span>
              <span class="cmt-len" :class="{ 'is-near': draft.length > 440 }">{{ draft.length }} / 500</span>
              <button class="cmt-send" type="button" :disabled="!draft.trim() || sending" @click="send">留言</button>
            </div>
          </div>
        </section>
      </div>
    </div>

    <footer class="reader-foot">
      <span class="reader-foot-meta">
        {{ note.seq ? `#${note.seq}  ·  ` : '' }}{{ fmtDay(note.updatedAt) }} {{ relTime(note.updatedAt) }}改过
      </span>
      <div class="reader-foot-acts">
        <button class="rbtn" type="button" @click="copyAll">
          <svg viewBox="0 0 24 24" class="ic" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6a2.5 2.5 0 0 0-2.5 2.5V13" /></svg>
          复制全文
        </button>
        <button class="rbtn" type="button" @click="emit('edit', note)">
          <svg viewBox="0 0 24 24" class="ic" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" /></svg>
          编辑
        </button>
        <button class="rbtn is-primary" type="button" @click="emit('close')">
          完成
          <svg viewBox="0 0 24 24" class="ic" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
        </button>
      </div>
    </footer>

    <LightBox v-if="lightbox !== null" :images="images" :index="lightbox" @close="lightbox = null" />
  </section>
</template>
