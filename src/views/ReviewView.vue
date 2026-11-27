<script setup lang="ts">
/**
 * 复盘区
 * 两个视图：记录（写下来）与 归因（隔一段时间回看、结结果）。
 * 结构和类名照搬 inspiration，CSS 来自 styles/edge/*.scoped.css。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ImageRef, Note } from '../types'
import { api } from '../api'
import { app } from '../stores/app'
import { confirmDialog, toast } from '../stores/ui'
import { clipText, escapeNewlines, esc, fmtPnl, highlight, pnlClass, relTime, stripHtml } from '../utils/edge'
import EdgeTop from '../components/edge/EdgeTop.vue'
import ReviewDrawer from '../components/edge/ReviewDrawer.vue'
import LightBox from '../components/edge/LightBox.vue'
import BaseDrawer from '../components/edge/BaseDrawer.vue'
import RichEditor from '../components/edge/RichEditor.vue'

const route = useRoute()
const router = useRouter()

const notes = ref<Note[]>([])
const total = ref(0)
const tags = ref<{ name: string; count: number }[]>([])
const stats = ref<any>(null)
const loading = ref(true)

const query = ref('')
const view = ref<'record' | 'review'>('record')
const filter = ref<'all' | 'open' | 'settled' | 'pinned'>('all')
const stage = ref<'all' | 'idea' | 'judgment' | 'trade'>('all')
const type = ref<'all' | 'review' | 'strategy'>('all')
const sort = ref<'new' | 'old'>('new')
const range = ref<'all' | 'today' | '7' | '30'>('all')

const draft = ref('')
const draftTags = ref<string[]>([])
const tagInput = ref('')
const images = ref<ImageRef[]>([])
const saving = ref(false)
const uploading = ref(false)
const editor = ref<InstanceType<typeof RichEditor> | null>(null)
const editEditor = ref<InstanceType<typeof RichEditor> | null>(null)
const picker = ref<HTMLInputElement | null>(null)
const editPicker = ref<HTMLInputElement | null>(null)

const detail = ref<Note | null>(null)
const lightbox = ref<{ images: ImageRef[]; index: number } | null>(null)
const stageDraft = ref<'idea' | 'judgment' | 'trade'>('idea')

const editOpen = ref(false)
const editId = ref('')
const editText = ref('')
const editTags = ref<string[]>([])
const editType = ref<'review' | 'strategy'>('review')
const editStage = ref<'idea' | 'judgment' | 'trade'>('idea')
const editReason = ref('')
const editBusy = ref(false)

const TAGS_MAX = 8
const STAGES: [string, string][] = [['idea', '想法'], ['judgment', '判断'], ['trade', '交易']]
const OUTCOME_LABEL: Record<string, string> = { right: '对', wrong: '错', unclear: '说不清' }
const baseDrawerOpen = ref(false)
const baseTag = computed(() => app.enums?.baseTag || '底线')

const quickTags = computed(() => app.enums?.stateTags || [])
const todayStart = computed(() => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
})

const visible = computed(() => {
  let list = [...notes.value]
  if (filter.value === 'open') list = list.filter((n) => !n.result?.outcome)
  if (filter.value === 'settled') list = list.filter((n) => Boolean(n.result?.outcome))
  if (filter.value === 'pinned') list = list.filter((n) => n.pinned)
  if (stage.value !== 'all') list = list.filter((n) => n.stage === stage.value)
  if (type.value !== 'all') list = list.filter((n) => n.type === type.value)
  if (range.value === 'today') list = list.filter((n) => n.createdAt >= todayStart.value)
  if (range.value === '7') list = list.filter((n) => Date.now() - n.createdAt < 7 * 86400000)
  if (range.value === '30') list = list.filter((n) => Date.now() - n.createdAt < 30 * 86400000)
  list.sort((a, b) => (sort.value === 'old'
    ? a.createdAt - b.createdAt
    : Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt))
  return list
})

async function load() {
  loading.value = true
  try {
    const [res, st] = await Promise.all([
      api.notes.list({ zone: 'review', q: query.value.trim() || undefined, limit: 500 } as any),
      api.notes.stats('review').catch(() => null),
    ])
    notes.value = res.notes || []
    total.value = res.total || notes.value.length
    stats.value = st
    const counts = new Map<string, number>()
    notes.value.forEach((n) => n.tags.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)))
    tags.value = [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  } catch (err: any) {
    toast(err?.message || '复盘没加载出来', 'error')
  } finally {
    loading.value = false
  }

  const fromUrl = String(route.query.note || '')
  if (fromUrl) {
    await openById(fromUrl)
    await router.replace({ path: '/review', query: {} })
  }
}

watch(view, (next) => {
  // 原版：归因视图自己就是一条时间流，放下记录视图的筛选
  if (next === 'review') { filter.value = 'all'; stage.value = 'all'; type.value = 'all' }
})

let searchTimer: number | undefined
watch(query, () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => { void load() }, 220)
})

/* ------------------------------------------------------------ 记录框 */

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('读不出这个文件'))
    r.readAsDataURL(file)
  })
}

async function uploadImages(files: File[]): Promise<string[]> {
  const imgs = files.filter((f) => f.type.startsWith('image/'))
  if (!imgs.length) return []
  const urls: string[] = []
  uploading.value = true
  try {
    for (const file of imgs.slice(0, 9)) {
      const data = await readAsDataUrl(file)
      const res = await api.media.upload({ data })
      if (res.image) urls.push(res.image.url)
    }
  } catch (err: any) {
    toast(err?.message || '图片没传上去', 'error')
  } finally {
    uploading.value = false
  }
  return urls
}

async function uploadAndInsert(files: File[]) {
  const urls = await uploadImages(files)
  urls.forEach((url) => {
    images.value = [...images.value, { url }]
    editor.value?.insertImage(url)
  })
}

async function uploadIntoEdit(files: File[]) {
  const urls = await uploadImages(files)
  urls.forEach((url) => editEditor.value?.insertImage(url))
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) void uploadAndInsert(Array.from(input.files))
  input.value = ''
}

function onEditPick(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) void uploadIntoEdit(Array.from(input.files))
  input.value = ''
}

function addTag(e: KeyboardEvent) {
  const el = e.target as HTMLInputElement
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    const v = el.value.trim().replace(/^#/, '')
    if (v && !draftTags.value.includes(v) && draftTags.value.length < TAGS_MAX) {
      draftTags.value = [...draftTags.value, v.slice(0, 24)]
    }
    el.value = ''
    tagInput.value = ''
  }
}

function quickTag(t: string) {
  if (draftTags.value.includes(t)) return
  if (draftTags.value.length >= TAGS_MAX) return
  draftTags.value = [...draftTags.value, t]
}

const canSave = computed(() => Boolean(stripHtml(draft.value) || images.value.length))

async function save() {
  if (saving.value || uploading.value) return
  const html = draft.value || ''
  if (!stripHtml(html) && !images.value.length) { toast('先写一句', 'warn'); return }
  saving.value = true
  try {
    const pendingTag = tagInput.value.trim().replace(/^#/, '')
    const res = await api.notes.create({
      zone: 'review',
      type: 'review',
      stage: stageDraft.value,
      content: html || `<p>${escapeNewlines('')}</p>`,
      tags: pendingTag ? [...draftTags.value, pendingTag].slice(0, TAGS_MAX) : draftTags.value,
      images: images.value,
      did: 'none',
      triage: 'inbox',
    })
    draft.value = ''
    editor.value?.clear()
    draftTags.value = []
    tagInput.value = ''
    images.value = []
    notes.value = [res.note, ...notes.value]
    total.value += 1
    toast(`记下了 ✦ #${res.note.seq}`)
    void nextTick(() => editor.value?.focus())
  } catch (err: any) {
    toast(err?.message || '这次没存进去', 'error')
  } finally {
    saving.value = false
  }
}

/* ------------------------------------------------------------ 卡片动作 */

function patchLocal(next: Note) {
  const idx = notes.value.findIndex((n) => n.id === next.id)
  if (idx >= 0) notes.value[idx] = next
  if (detail.value?.id === next.id) detail.value = next
}

async function settle(n: Note, outcome: string) {
  try {
    const res = await api.notes.result(n.id, { outcome })
    patchLocal(res.note)
    toast(outcome === 'right' ? '记下了：对' : outcome === 'wrong' ? '记下了：错' : '记下了：说不清')
  } catch (err: any) { toast(err?.message || '结果没存上', 'error') }
}

async function togglePin(n: Note) {
  try {
    const res = await api.notes.patch(n.id, { pinned: !n.pinned })
    patchLocal(res.note)
  } catch (err: any) { toast(err?.message || '置顶没改成功', 'error') }
}

async function toggleFile(n: Note) {
  const next = n.triage === 'inbox' ? 'filed' : 'inbox'
  try {
    const res = await api.notes.patch(n.id, { triage: next })
    patchLocal(res.note)
    toast(next === 'filed' ? '归档了，留在墙里' : '移回待归类')
  } catch (err: any) { toast(err?.message || '没改成功', 'error') }
}

async function removeNote(n: Note) {
  const r = await confirmDialog({
    title: `删掉复盘 #${n.seq}？`,
    message: '删掉后不能恢复。已经结过结果的记录也一样会消失。',
    confirmText: '删除',
    danger: true,
  })
  if (!r.ok) return
  try {
    await api.notes.remove(n.id)
    notes.value = notes.value.filter((x) => x.id !== n.id)
    total.value = Math.max(0, total.value - 1)
    if (detail.value?.id === n.id) detail.value = null
    toast('删掉了')
  } catch (err: any) { toast(err?.message || '没删掉', 'error') }
}

function openImage(n: Note, index: number) {
  lightbox.value = { images: (n.images || []).filter((i) => i && i.url), index }
}

async function openById(id: string) {
  let n = notes.value.find((x) => x.id === id)
  if (!n) {
    try {
      const res: any = await api.notes.get(id)
      n = res?.note || null
    } catch (_) { toast('这条不在了', 'warn') }
  }
  if (n) detail.value = n
}

/** 引用跳转：同区打开详情，跨区切分区后再打开 */
async function gotoRef(payload: { id: string; zone: string }) {
  const id = payload.id
  if (payload.zone && payload.zone !== 'review') {
    if (route.path !== '/notes') {
      await router.push({ path: '/notes', query: { note: id } })
      return
    }
  }
  await openById(id)
  if (route.query.note) await router.replace({ path: '/review', query: {} })
}

/* ------------------------------------------------------------ 编辑 */

function openEdit(n: Note) {
  editId.value = n.id
  editText.value = n.content || ''
  editType.value = n.type === 'strategy' ? 'strategy' : 'review'
  editStage.value = (n.stage || 'idea') as any
  editTags.value = [...n.tags]
  editReason.value = ''
  editOpen.value = true
}

function closeEdit() {
  editOpen.value = false
}

function editAddTag(e: KeyboardEvent) {
  const el = e.target as HTMLInputElement
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    const v = el.value.trim().replace(/^#/, '')
    if (v && !editTags.value.includes(v) && editTags.value.length < TAGS_MAX) {
      editTags.value = [...editTags.value, v.slice(0, 24)]
    }
    el.value = ''
  }
}

async function saveEdit() {
  if (editBusy.value) return
  const target = notes.value.find((n) => n.id === editId.value)
  const html = editText.value || ''
  if (!stripHtml(html)) { toast('正文空着', 'warn'); return }
  if (target?.result?.outcome && !editReason.value.trim()) {
    toast('这条已经结结果了，改正文要写一句修订理由', 'warn')
    return
  }
  editBusy.value = true
  try {
    const res = await api.notes.patch(editId.value, {
      type: editType.value,
      stage: editStage.value,
      content: html,
      tags: editTags.value,
      revision: target?.result?.outcome ? { reason: editReason.value.trim() } : undefined,
    })
    patchLocal(res.note)
    closeEdit()
    toast('改好了', 'success')
  } catch (err: any) {
    toast(err?.message || '没改成', 'error')
  } finally {
    editBusy.value = false
  }
}

/* ------------------------------------------------------------ 概览 */

const overview = computed(() => {
  const s = stats.value
  if (!s) return null
  const byType = s.byType || {}
  return {
    total: s.total || 0,
    settled: s.review?.settled || s.settled || 0,
    open: s.review ? Math.max(0, (s.review.count || 0) - (s.review.settled || 0)) : (s.open || 0),
    winRate: s.review?.winRate,
    pnl: s.review?.pnl || 0,
    inbox: s.inbox || 0,
    byType,
  }
})

/* ------------------------------------------------------------ 键盘 */

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  const typing = !!t && (['INPUT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable)
  if (typing) return
  if (e.key === '/') {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('#search')?.focus()
  }
  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault()
    editor.value?.focus()
  }
}

onMounted(() => {
  void load()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="shell">
    <EdgeTop v-model:query="query" zone="review" @base="baseDrawerOpen = true" />

    <nav class="review-nav" aria-label="复盘视图">
      <button class="rn-btn" :class="{ on: view === 'record' }" @click="view = 'record'">记录</button>
      <button class="rn-btn" :class="{ on: view === 'review' }" @click="view = 'review'">归因</button>
    </nav>

    <section v-if="view === 'record'" id="recordCapture" class="capture">
      <div id="recordCard" class="capture-card record-card">
        <RichEditor
          ref="editor"
          v-model="draft"
          placeholder="看到什么、想到什么，写下来就行…"
          :min-height="168"
          @attach="picker?.click()"
          @paste-images="uploadAndInsert"
        />
        <div class="re-stage-row" role="group" aria-label="层级">
          <button
            v-for="[val, text] in STAGES"
            :key="val"
            class="stage-tab"
            :class="{ on: stageDraft === val }"
            @click="stageDraft = val as any"
          >{{ text }}</button>
        </div>

        <div v-if="quickTags.length" class="quick-tags" role="group" aria-label="常用标签">
          <button v-for="t in quickTags" :key="t" class="q-chip" :class="{ on: draftTags.includes(t) }" @click="quickTag(t)">{{ t }}</button>
        </div>

        <div class="capture-foot">
          <div class="tag-input-wrap">
            <span class="hash">#</span>
            <input id="tagInput" v-model="tagInput" type="text" placeholder="加标签，回车确认" autocomplete="off" spellcheck="false" @keydown="addTag" />
          </div>
          <div class="tag-chips">
            <button v-for="t in draftTags" :key="t" class="tag-chip" @click="draftTags = draftTags.filter((x) => x !== t)">
              #{{ t }}<span class="x">×</span>
            </button>
          </div>
          <button class="attach-btn" title="插图到光标处（也可以直接 Ctrl+V 粘贴）" :class="{ 'is-busy': uploading }" @click="picker?.click()">
            <svg viewBox="0 0 24 24" class="ic"><rect x="3" y="4.5" width="18" height="15" rx="3" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="m4 17 5-5 4.5 4.5L17 13l3.5 3.5" /></svg>
            <span>加图</span>
          </button>
          <button class="primary-btn" :disabled="!canSave || saving" @click="save">
            <span>{{ saving ? '存…' : '记下来' }}</span>
            <svg viewBox="0 0 24 24" class="ic"><path d="M5 12h13" /><path d="m12.5 5.5 6.5 6.5-6.5 6.5" /></svg>
          </button>
        </div>
        <input ref="picker" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden @change="onPick" />
      </div>
    </section>

    <section class="meta-row">
      <div class="filters">
        <button class="filter-btn" :class="{ active: filter === 'all' }" @click="filter = 'all'">全部</button>
        <button v-if="view === 'record'" class="filter-btn" :class="{ active: filter === 'open' }" @click="filter = 'open'">未结</button>
        <button v-if="view === 'record'" class="filter-btn" :class="{ active: filter === 'settled' }" @click="filter = 'settled'">已结</button>
        <button class="filter-btn" :class="{ active: filter === 'pinned' }" @click="filter = 'pinned'">置顶</button>
        <button
          v-for="[val, text] in view === 'record' ? STAGES : []"
          :key="val"
          class="filter-btn"
          :class="{ active: stage === val }"
          @click="stage = stage === val ? 'all' : (val as any)"
        >{{ text }}</button>
        <button
          v-for="t in tags.slice(0, 6)"
          :key="t.name"
          class="filter-btn"
          @click="query = t.name"
        >#{{ t.name }} <span style="opacity:.5">{{ t.count }}</span></button>
      </div>
    </section>

    <section class="viewbar">
      <div class="vb-group vb-sort" role="group" aria-label="排序">
        <button class="vb-chip" :class="{ on: sort === 'new' }" @click="sort = 'new'">最新</button>
        <button class="vb-chip" :class="{ on: sort === 'old' }" @click="sort = 'old'">最早</button>
      </div>
      <div class="vb-group vb-range" role="group" aria-label="时间范围">
        <button class="vb-chip" :class="{ on: range === 'all' }" @click="range = 'all'">全部</button>
        <button class="vb-chip" :class="{ on: range === 'today' }" @click="range = 'today'">今天</button>
        <button class="vb-chip" :class="{ on: range === '7' }" @click="range = '7'">近 7 天</button>
        <button class="vb-chip" :class="{ on: range === '30' }" @click="range = '30'">近 30 天</button>
      </div>
      <button
        v-if="overview"
        class="vb-clear"
        style="margin-left: auto; text-decoration: none; opacity: .75"
        type="button"
        @click="filter = 'all'; stage = 'all'; query = ''"
      >
        {{ overview.total }} 条 · 未结 {{ overview.open }} · 已结 {{ overview.settled }}
      </button>
    </section>

    <main id="wall" class="wall layout-masonry" aria-live="polite">
      <!-- 记录视图：正文 + 层级 + 标签，结结果留给归因 -->
      <template v-if="view === 'record'">
        <article
          v-for="(n, i) in visible"
          :key="n.id"
          class="note note-rec"
          :class="[`t-${n.type}`, { pinned: n.pinned }]"
          :style="{ animationDelay: Math.min(i * 24, 200) + 'ms' }"
        >
          <div class="note-top">
            <span v-if="n.seq" class="note-seq">#{{ n.seq }}</span>
            <span class="note-type">{{ n.stage === 'judgment' ? '判断' : n.stage === 'trade' ? '交易' : '想法' }}</span>
            <span v-if="n.result?.outcome" class="note-badge done">已结</span>
            <span v-if="n.trade?.symbol || n.trade?.pnl != null" class="note-meta note-meta-lead">
              <span v-if="n.trade?.symbol" class="chip-sym">{{ n.trade.symbol }}</span>
              <span v-if="n.trade?.pnl != null" class="chip-r" :class="pnlClass(n.trade.pnl)">{{ fmtPnl(n.trade.pnl) }}</span>
            </span>
          </div>
          <div class="note-content" v-html="n.content || `<p>${esc(n.think)}</p>`" />
          <div v-if="n.tags.length" class="note-tags">
            <span v-for="t in n.tags" :key="t" class="note-tag" @click="query = t">#{{ t }}</span>
          </div>
          <div class="note-foot">
            <span class="note-time">{{ relTime(n.createdAt) }}</span>
            <div class="note-actions">
              <button class="mini-btn text cmt-btn" @click="detail = n">详情</button>
              <button class="mini-btn text" title="去归因里结结果、补事后" @click="detail = n; view = 'review'">归因</button>
              <button class="mini-btn" :class="{ on: n.pinned }" title="置顶" @click="togglePin(n)">
                <svg viewBox="0 0 24 24" class="ic"><path d="M12 3.5v9" /><path d="M8 7.5h8" /><path d="m9 12.5-1.5 8h9l-1.5-8" /></svg>
              </button>
              <button class="mini-btn" title="编辑" @click="openEdit(n)">
                <svg viewBox="0 0 24 24" class="ic"><path d="M15.5 4.5l4 4L8 20l-4.5.5L4 16Z" /></svg>
              </button>
              <button class="mini-btn danger" title="删除" @click="removeNote(n)">
                <svg viewBox="0 0 24 24" class="ic"><path d="M4 7h16" /><path d="M9.5 4h5" /><path d="M6.5 7l.8 13h9.4l.8-13" /></svg>
              </button>
            </div>
          </div>
        </article>
      </template>

      <!-- 归因视图：结果、事后、成长 -->
      <template v-else>
        <article
          v-for="(n, i) in visible"
          :key="n.id"
          class="note"
          :class="[`t-${n.type}`, { pinned: n.pinned }]"
          :style="{ animationDelay: Math.min(i * 24, 200) + 'ms' }"
        >
          <div class="note-top">
            <span v-if="n.seq" class="note-seq">#{{ n.seq }}</span>
            <span v-if="n.result?.outcome" class="note-badge done">已结</span>
            <span v-else class="note-badge open">未结</span>
            <span v-if="n.trade?.symbol" class="chip-sym">{{ n.trade.symbol }}</span>
            <span v-if="n.trade?.pnl != null" class="chip-r" :class="pnlClass(n.trade.pnl)">{{ fmtPnl(n.trade.pnl) }}</span>
          </div>

          <div v-if="n.content" class="note-content" v-html="n.content" />
          <div v-else class="seg seg-think">
            <span class="seg-label">想到</span>
            <p class="seg-text" v-html="highlight(n.think || '', query)" />
          </div>

          <div v-if="n.result?.outcome" class="seg seg-result">
            <p class="seg-text">
              <b class="oc" :class="n.result.outcome">{{ OUTCOME_LABEL[n.result.outcome] }}</b>
              <template v-if="n.result.note">　{{ n.result.note }}</template>
            </p>
            <p v-if="n.callRight" class="seg-note">思路本身：{{ OUTCOME_LABEL[n.callRight] }}</p>
          </div>
          <div v-else class="seg seg-result is-open">
            <div class="settle-row">
              <span class="settle-tip">{{ n.did === 'skipped' ? '没做，可回填思路' : '结果' }}</span>
              <button @click="settle(n, 'right')">对</button>
              <button @click="settle(n, 'wrong')">错</button>
              <button @click="settle(n, 'unclear')">说不清</button>
            </div>
          </div>

          <div v-if="n.after?.text" class="seg seg-after">
            <span class="seg-label">事后</span>
            <p class="seg-text" v-html="highlight(n.after.text, query)" />
          </div>

          <div v-if="n.tags.length" class="note-tags">
            <span v-for="t in n.tags" :key="t" class="note-tag" @click="query = t">#{{ t }}</span>
          </div>

          <div class="note-foot">
            <span class="note-time">{{ relTime(n.createdAt) }}</span>
            <div class="note-actions">
              <button class="note-more" @click="detail = n">详情</button>
            </div>
          </div>
        </article>
      </template>
    </main>

    <div v-if="!loading && !visible.length" class="empty">
      <div class="empty-mark">◈</div>
      <h2>{{ view === 'review' ? '还没有复盘' : '还没有记录' }}</h2>
      <p>{{ view === 'review' ? '上面那个框，看到什么、想到什么，写完按「记下来」。' : '先写一条，过几天再回来判一次。' }}</p>
    </div>

    <details v-if="overview" class="overview">
      <summary>概览</summary>
      <div class="stats">
        <div class="stat"><b>{{ overview.total }}</b><span>总记录</span></div>
        <div class="stat"><b>{{ overview.open }}</b><span>未结</span></div>
        <div class="stat"><b>{{ overview.settled }}</b><span>已结</span></div>
        <div class="stat"><b>{{ overview.winRate == null ? '—' : overview.winRate + '%' }}</b><span>胜率</span></div>
        <div class="stat"><b :class="pnlClass(overview.pnl)">{{ fmtPnl(overview.pnl) }}</b><span>累计盈亏</span></div>
        <div class="stat"><b>{{ overview.inbox }}</b><span>待归类</span></div>
      </div>
    </details>

    <footer class="foot">
      <span>{{ total }} 条记录</span>
    </footer>

    <ReviewDrawer
      v-if="detail"
      :note="detail"
      @close="detail = null"
      @changed="patchLocal"
      @edit="openEdit"
      @goto="gotoRef"
    />

    <BaseDrawer
      :open="baseDrawerOpen"
      :base-tag="baseTag"
      @close="baseDrawerOpen = false"
      @create="baseDrawerOpen = false; router.push('/notes?base=1')"
      @open="(n: Note) => { baseDrawerOpen = false; void openById(n.id) }"
    />

    <LightBox
      v-if="lightbox"
      :images="lightbox.images"
      :index="lightbox.index"
      @close="lightbox = null"
    />

    <div v-if="editOpen" class="modal">
      <div class="modal-backdrop" @click="closeEdit" />
      <div class="modal-card wide" role="dialog" aria-modal="true" aria-label="编辑记录">
        <div class="modal-head">
          <div class="modal-tabs">
            <div class="type-tabs small" role="tablist">
              <button class="type-tab" :class="{ on: editType === 'review' }" @click="editType = 'review'">复盘</button>
              <button class="type-tab" :class="{ on: editType === 'strategy' }" @click="editType = 'strategy'">策略</button>
            </div>
            <div class="stage-tabs small" role="tablist">
              <button
                v-for="[val, text] in STAGES"
                :key="val"
                class="stage-tab"
                :class="{ on: editStage === val }"
                @click="editStage = val as any"
              >{{ text }}</button>
            </div>
          </div>
          <button class="icon-btn small" aria-label="关闭" @click="closeEdit">
            <svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div class="modal-body-edit">
          <RichEditor
            ref="editEditor"
            v-model="editText"
            placeholder="正文…"
            :min-height="240"
            @attach="editPicker?.click()"
            @paste-images="uploadIntoEdit"
          />
          <input ref="editPicker" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden @change="onEditPick" />
        </div>

        <div class="modal-foot">
          <div class="tag-input-wrap">
            <span class="hash">#</span>
            <input type="text" placeholder="回车添加标签" autocomplete="off" spellcheck="false" @keydown="editAddTag" />
          </div>
          <div class="tag-chips">
            <button v-for="t in editTags" :key="t" class="tag-chip" @click="editTags = editTags.filter((x) => x !== t)">
              #{{ t }}<span class="x">×</span>
            </button>
          </div>
          <input v-model="editReason" class="nd-input" style="flex: 1; min-width: 160px" placeholder="修订理由（已结结果时必填）" />
          <button class="ghost-btn" @click="closeEdit">取消</button>
          <button class="primary-btn" :disabled="editBusy" @click="saveEdit">{{ editBusy ? '保存…' : '保存' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
