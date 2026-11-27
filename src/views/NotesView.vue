<script setup lang="ts">
/**
 * 灵感区
 * 结构、类名与交互都对着 inspiration 原版做：一个框五秒记一句，下面一面墙。
 * CSS 来自 styles/edge/*.scoped.css（原皮肤文件），这里只负责数据与行为。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ImageRef, Note } from '../types'
import { api } from '../api'
import { app } from '../stores/app'
import { confirmDialog, toast } from '../stores/ui'
import { escapeNewlines, stripHtml } from '../utils/edge'
import EdgeTop from '../components/edge/EdgeTop.vue'
import NoteCard from '../components/edge/NoteCard.vue'
import NoteReader from '../components/edge/NoteReader.vue'
import LightBox from '../components/edge/LightBox.vue'
import BaseDrawer from '../components/edge/BaseDrawer.vue'
import RichEditor from '../components/edge/RichEditor.vue'

const route = useRoute()
const router = useRouter()

const notes = ref<Note[]>([])
const total = ref(0)
const tags = ref<{ name: string; count: number }[]>([])
const loading = ref(true)

const query = ref('')
const filter = ref<'all' | 'inbox' | 'filed' | 'pinned'>('all')
const noteType = ref<'all' | 'idea' | 'insight'>('all')
const activeTag = ref('')
const range = ref<'all' | 'today' | '7' | '30'>('all')
const sort = ref<'new' | 'old' | 'tag'>('new')
const layout = ref<'masonry' | 'grid' | 'list'>('masonry')

const draft = ref('')
const draftTags = ref<string[]>([])
const tagInput = ref('')
const images = ref<ImageRef[]>([])
const saving = ref(false)
const uploading = ref(false)
const inputEl = ref<InstanceType<typeof RichEditor> | null>(null)
const editEditor = ref<InstanceType<typeof RichEditor> | null>(null)
const picker = ref<HTMLInputElement | null>(null)
const editPicker = ref<HTMLInputElement | null>(null)

const reader = ref<Note | null>(null)
const lightbox = ref<{ images: ImageRef[]; index: number } | null>(null)
const editOpen = ref(false)
const editId = ref('')
const editText = ref('')
const editTags = ref<string[]>([])
const editImages = ref<ImageRef[]>([])
const editPinned = ref(false)
const editType = ref<'idea' | 'insight'>('idea')
const editBusy = ref(false)
const baseDrawerOpen = ref(false)

const TAGS_MAX = 8
const DRAFT_KEY = 'zhixing.inspire.draft'

const baseTag = computed(() => app.enums?.baseTag || '底线')
const todayStart = computed(() => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
})

const visible = computed(() => {
  let list = [...notes.value]
  if (activeTag.value) list = list.filter((n) => n.tags.includes(activeTag.value as string))
  if (noteType.value !== 'all') list = list.filter((n) => n.type === noteType.value)
  if (filter.value === 'pinned') list = list.filter((n) => n.pinned)
  if (filter.value === 'inbox') list = list.filter((n) => n.triage === 'inbox')
  if (filter.value === 'filed') list = list.filter((n) => n.triage === 'filed')
  if (range.value === 'today') list = list.filter((n) => n.createdAt >= todayStart.value)
  if (range.value === '7') list = list.filter((n) => Date.now() - n.createdAt < 7 * 86400000)
  if (range.value === '30') list = list.filter((n) => Date.now() - n.createdAt < 30 * 86400000)
  if (sort.value === 'old') list.sort((a, b) => a.createdAt - b.createdAt)
  else if (sort.value === 'tag') {
    const key = (n: Note) => (n.tags.length ? String(n.tags[0]) : '\uffff')
    list.sort((a, b) => key(a).localeCompare(key(b), 'zh') || b.createdAt - a.createdAt)
  } else {
    list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
  }
  return list
})

const spark = computed(() => {
  const days: { key: number; count: number }[] = []
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  for (let i = 29; i >= 0; i--) {
    const start = now.getTime() - i * 86400000
    days.push({ key: start, count: notes.value.filter((n) => n.createdAt >= start && n.createdAt < start + 86400000).length })
  }
  return days
})
const sparkPeak = computed(() => Math.max(1, ...spark.value.map((d) => d.count)))

const filtered = computed(() => Boolean(query.value || activeTag.value || filter.value !== 'all' || noteType.value !== 'all' || range.value !== 'all'))

async function load() {
  loading.value = true
  try {
    const res = await api.notes.list({
      zone: 'inspiration',
      q: query.value.trim() || undefined,
      limit: 400,
    } as any)
    notes.value = res.notes || []
    total.value = res.total || notes.value.length
    const counts = new Map<string, number>()
    notes.value.forEach((n) => n.tags.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)))
    tags.value = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  } catch (err: any) {
    toast(err?.message || '灵感没加载出来', 'error')
  } finally {
    loading.value = false
  }

  const fromUrl = String(route.query.note || '')
  if (fromUrl) {
    await openById(fromUrl)
    await router.replace({ path: '/notes', query: {} })
  }
}

let searchTimer: number | undefined
watch(query, () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => { void load() }, 220)
})

/* ------------------------------------------------------------ 速记框 */

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

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('读不出这个文件'))
    r.readAsDataURL(file)
  })
}

function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve({ w: 0, h: 0 })
    img.src = src
  })
}

async function pickFiles(files: File[]) {
  const imgs = files.filter((f) => f.type.startsWith('image/'))
  if (!imgs.length) return
  if (images.value.length >= 9) { toast('一条最多 9 张图', 'warn'); return }
  uploading.value = true
  try {
    for (const file of imgs.slice(0, 9 - images.value.length)) {
      const data = await readAsDataUrl(file)
      const size = await imageSize(data)
      const res = await api.media.upload({ data, w: size.w, h: size.h })
      if (res.image) images.value = [...images.value, res.image]
    }
  } catch (err: any) {
    toast(err?.message || '图片没传上去', 'error')
  } finally {
    uploading.value = false
  }
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) void pickFiles(Array.from(input.files))
  input.value = ''
}

async function uploadIntoEdit(files: File[]) {
  const imgs = files.filter((f) => f.type.startsWith('image/'))
  if (!imgs.length) return
  if (editImages.value.length >= 9) { toast('一条最多 9 张图', 'warn'); return }
  uploading.value = true
  try {
    for (const file of imgs.slice(0, 9 - editImages.value.length)) {
      const data = await readAsDataUrl(file)
      const size = await imageSize(data)
      const res = await api.media.upload({ data, w: size.w, h: size.h })
      if (res.image) {
        editImages.value = [...editImages.value, res.image]
        editEditor.value?.insertImage(res.image.url)
      }
    }
  } catch (err: any) {
    toast(err?.message || '图片没传上去', 'error')
  } finally {
    uploading.value = false
  }
}

function onEditPick(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) void uploadIntoEdit(Array.from(input.files))
  input.value = ''
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return
    const obj = JSON.parse(raw)
    const saved = String(obj.text || '')
    // 旧版草稿是纯文本，升级后按富文本片段接住
    draft.value = /<[a-z][\s\S]*>/i.test(saved) ? saved : (saved ? `<p>${escapeNewlines(saved)}</p>` : '')
    draftTags.value = Array.isArray(obj.tags) ? obj.tags : []
  } catch (_) { /* 坏草稿就丢掉 */ }
}

watch([draft, draftTags], () => {
  try {
    if (stripHtml(draft.value).trim() || draftTags.value.length) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: draft.value, tags: draftTags.value }))
    } else {
      localStorage.removeItem(DRAFT_KEY)
    }
  } catch (_) { /* 私密模式 */ }
})

async function save() {
  const html = draft.value
  if ((!stripHtml(html).trim() && !images.value.length) || saving.value || uploading.value) return
  saving.value = true
  try {
    const pendingTag = tagInput.value.trim().replace(/^#/, '')
    const body = html || `<p><br /></p>`
    const res = await api.notes.create({
      zone: 'inspiration',
      type: 'idea',
      content: body,
      tags: pendingTag ? [...draftTags.value, pendingTag].slice(0, TAGS_MAX) : draftTags.value,
      images: images.value,
      triage: 'inbox',
    })
    draft.value = ''
    draftTags.value = []
    tagInput.value = ''
    images.value = []
    localStorage.removeItem(DRAFT_KEY)
    notes.value = [res.note, ...notes.value]
    total.value += 1
    toast(`记下了 ✦ #${res.note.seq}`)
    void nextTick(() => inputEl.value?.focus())
    void load()
  } catch (err: any) {
    toast(err?.message || '这次没存进去，草稿留在本地了', 'error')
  } finally {
    saving.value = false
  }
}

/* ------------------------------------------------------------ 卡片动作 */

function patchLocal(next: Note) {
  const idx = notes.value.findIndex((n) => n.id === next.id)
  if (idx >= 0) notes.value[idx] = next
  if (reader.value?.id === next.id) reader.value = next
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

async function upgrade(n: Note) {
  try {
    const res = await api.notes.create({
      zone: 'review',
      type: 'review',
      stage: 'idea',
      think: stripHtml(n.content) || n.think,
      content: n.content,
      tags: n.tags,
      images: n.images,
      derivedFrom: n.id,
      triage: 'inbox',
    })
    toast(`已升级成复盘 #${res.note.seq}，原灵感留着`)
  } catch (err: any) { toast(err?.message || '升级没成功', 'error') }
}

async function removeNote(n: Note) {
  const r = await confirmDialog({
    title: `删掉灵感 #${n.seq}？`,
    message: '这条会从墙上消失。如果有别的记录引用了它，引用关系会保留，打开会提示已删除。',
    confirmText: '删除',
    danger: true,
  })
  if (!r.ok) return
  try {
    await api.notes.remove(n.id)
    notes.value = notes.value.filter((x) => x.id !== n.id)
    total.value = Math.max(0, total.value - 1)
    if (reader.value?.id === n.id) reader.value = null
    toast('删掉了')
  } catch (err: any) { toast(err?.message || '没删掉', 'error') }
}

function openTag(tag: string) {
  activeTag.value = activeTag.value === tag ? '' : tag
  reader.value = null
}

function openReader(n: Note) {
  reader.value = n
}

function newBase() {
  baseDrawerOpen.value = false
  draftTags.value = [baseTag.value]
  void nextTick(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    inputEl.value?.focus()
  })
  toast(`正文写一句，标签已带上 #${baseTag.value}`)
}

function openBaseNote(n: Note) {
  baseDrawerOpen.value = false
  openReader(n)
}

async function openById(id: string) {
  let n = notes.value.find((x) => x.id === id)
  if (!n) {
    try {
      const res: any = await api.notes.get(id)
      n = res?.note || null
    } catch (_) { toast('这条不在了', 'warn') }
  }
  if (n) openReader(n)
}

/** 引用跳转：同区打开全文，跨区切分区后再打开（浏览器后退也能回到来源区） */
async function gotoRef(payload: { id: string; zone: string }) {
  const id = payload.id
  if (payload.zone && payload.zone !== 'inspiration') {
    if (route.path !== '/review') {
      await router.push({ path: '/review', query: { note: id } })
      return
    }
  }
  await openById(id)
  if (route.query.note) await router.replace({ path: '/notes', query: {} })
}

function openImage(n: Note, index: number) {
  lightbox.value = { images: (n.images || []).filter((i) => i && i.url), index }
}

/* ------------------------------------------------------------ 编辑 */

function openEdit(n: Note) {
  editId.value = n.id
  editText.value = n.content || ''
  editType.value = n.type === 'insight' ? 'insight' : 'idea'
  editTags.value = [...n.tags]
  editImages.value = [...(n.images || [])]
  editPinned.value = n.pinned
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
  const html = editText.value || ''
  if (!stripHtml(html).trim() && !editImages.value.length) { toast('正文和图片都空着', 'warn'); return }
  editBusy.value = true
  try {
    const res = await api.notes.patch(editId.value, {
      type: editType.value,
      content: html || `<p><br /></p>`,
      tags: editTags.value,
      images: editImages.value,
      pinned: editPinned.value,
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
    inputEl.value?.focus()
  }
}

onMounted(() => {
  restoreDraft()
  if (String(route.query.base || '') === '1') {
    draftTags.value = [baseTag.value]
    void router.replace({ path: '/notes', query: {} })
    void nextTick(() => inputEl.value?.focus())
  }
  void load()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="shell">
    <EdgeTop v-model:query="query" zone="inspiration" @base="baseDrawerOpen = true" />

    <section class="capture">
      <div class="capture-card inspire-card">
        <label class="capture-label" for="inspireInput">想到什么</label>
        <RichEditor
          ref="inputEl"
          v-model="draft"
          placeholder="想到什么就写什么，一句话也行…（Enter 记下，Shift+Enter 换行）"
          :min-height="86"
          compact
          :submit-on-enter="true"
          @submit="save"
          @attach="picker?.click()"
          @paste-images="pickFiles"
        />

        <div v-if="images.length" class="attach-strip">
          <div v-for="(img, idx) in images" :key="idx" class="thumb">
            <img :src="img.url" alt="" />
            <button class="thumb-x" aria-label="移除" @click="images.splice(idx, 1)">
              <svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </div>

        <div class="capture-foot">
          <div class="tag-input-wrap">
            <label class="hash" for="inspireTagInput">标签 #</label>
            <input
              id="inspireTagInput"
              v-model="tagInput"
              type="text"
              placeholder="可选，回车确认"
              autocomplete="off"
              spellcheck="false"
              @keydown="addTag"
            />
          </div>
          <div class="tag-chips">
            <button v-for="t in draftTags" :key="t" class="tag-chip" @click="draftTags = draftTags.filter((x) => x !== t)">
              #{{ t }}<span class="x">×</span>
            </button>
          </div>
          <button class="attach-btn" title="加图（也可以直接 Ctrl+V 粘贴）" :class="{ 'is-busy': uploading }" @click="picker?.click()">
            <svg viewBox="0 0 24 24" class="ic"><rect x="3" y="4.5" width="18" height="15" rx="3" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="m4 17 5-5 4.5 4.5L17 13l3.5 3.5" /></svg>
            <span>加图</span>
          </button>
          <button class="primary-btn" :disabled="(!draft.trim() && !images.length) || saving || uploading" @click="save">
            <span>{{ saving ? '存…' : '记下来' }}</span>
            <svg viewBox="0 0 24 24" class="ic"><path d="M5 12h13" /><path d="m12.5 5.5 6.5 6.5-6.5 6.5" /></svg>
          </button>
        </div>
        <input ref="picker" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden @change="onPick" />
      </div>
    </section>

    <section class="meta-row">
      <div class="filters">
        <button
          class="filter-btn"
          :class="{ active: !activeTag && filter === 'all' && noteType === 'all' }"
          @click="filter = 'all'; activeTag = ''; noteType = 'all'"
        >全部</button>
        <button class="filter-btn t-idea" :class="{ active: noteType === 'idea' }" @click="noteType = noteType === 'idea' ? 'all' : 'idea'">灵感</button>
        <button class="filter-btn t-insight" :class="{ active: noteType === 'insight' }" @click="noteType = noteType === 'insight' ? 'all' : 'insight'">心得</button>
        <button class="filter-btn" :class="{ active: filter === 'inbox' }" @click="filter = filter === 'inbox' ? 'all' : 'inbox'">待归类</button>
        <button class="filter-btn" :class="{ active: filter === 'filed' }" @click="filter = filter === 'filed' ? 'all' : 'filed'">已归档</button>
        <button class="filter-btn" :class="{ active: filter === 'pinned' }" @click="filter = filter === 'pinned' ? 'all' : 'pinned'">置顶</button>
        <button
          v-for="t in tags.filter((x) => x.name !== baseTag).slice(0, 8)"
          :key="t.name"
          class="filter-btn"
          :class="{ active: activeTag === t.name }"
          @click="openTag(t.name)"
        >#{{ t.name }} <span style="opacity:.5">{{ t.count }}</span></button>
      </div>
    </section>

    <section class="viewbar">
      <div class="vb-group vb-layout" role="group" aria-label="排列方式">
        <button class="vb-btn" :class="{ on: layout === 'masonry' }" title="瀑布" aria-label="瀑布" @click="layout = 'masonry'">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="11" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="17" width="7" height="4" rx="1.5" /><rect x="14" y="13" width="7" height="8" rx="1.5" /></svg>
        </button>
        <button class="vb-btn" :class="{ on: layout === 'grid' }" title="网格" aria-label="网格" @click="layout = 'grid'">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></svg>
        </button>
        <button class="vb-btn" :class="{ on: layout === 'list' }" title="列表" aria-label="列表" @click="layout = 'list'">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1.5" /><rect x="3" y="11" width="18" height="5" rx="1.5" /><rect x="3" y="18" width="18" height="3" rx="1.5" /></svg>
        </button>
      </div>

      <div class="vb-group vb-range" role="group" aria-label="时间范围">
        <button class="vb-chip" :class="{ on: range === 'all' }" @click="range = 'all'">全部</button>
        <button class="vb-chip" :class="{ on: range === 'today' }" @click="range = 'today'">今天</button>
        <button class="vb-chip" :class="{ on: range === '7' }" @click="range = '7'">近 7 天</button>
        <button class="vb-chip" :class="{ on: range === '30' }" @click="range = '30'">近 30 天</button>
      </div>

      <div class="vb-group vb-sort" role="group" aria-label="排序">
        <button class="vb-chip" :class="{ on: sort === 'new' }" title="新的在上（置顶优先）" @click="sort = 'new'">最新</button>
        <button class="vb-chip" :class="{ on: sort === 'old' }" title="最早的在上" @click="sort = 'old'">最早</button>
        <button class="vb-chip" :class="{ on: sort === 'tag' }" title="按第一个标签分组" @click="sort = 'tag'">按标签</button>
      </div>

      <div class="vb-spark" role="group" aria-label="近 30 天活动">
        <i
          v-for="(d, i) in spark"
          :key="i"
          :class="{ has: d.count > 0 }"
          :style="{ height: Math.max(3, d.count / sparkPeak * 100) + '%' }"
          :title="`${new Date(d.key).getMonth() + 1}/${new Date(d.key).getDate()} · ${d.count} 条`"
        />
      </div>
      <button v-if="filtered" class="vb-clear" type="button" @click="filter = 'all'; activeTag = ''; noteType = 'all'; range = 'all'; query = ''">清筛选</button>
    </section>

    <main id="wall" class="wall" :class="`layout-${layout}`" aria-live="polite">
      <NoteCard
        v-for="(n, i) in visible"
        :key="n.id"
        :note="n"
        :index="i"
        :query="query"
        :base-tag="baseTag"
        @read="openReader"
        @edit="openEdit"
        @pin="togglePin"
        @remove="removeNote"
        @upgrade="upgrade"
        @file="toggleFile"
        @tag="openTag"
        @image="({ note, index }) => openImage(note, index)"
      />
    </main>

    <div v-if="!loading && !visible.length" class="empty">
      <div class="empty-mark">◈</div>
      <h2>{{ filtered ? '没有匹配的记录' : '还没有灵感' }}</h2>
      <p>{{ filtered ? '换个关键词，或者清掉筛选。' : '上面那个框，想到什么就敲一句，回车存下。' }}</p>
    </div>

    <footer class="foot">
      <span>{{ total }} 条记录</span>
    </footer>

    <NoteReader
      v-if="reader"
      :note="reader"
      :query="query"
      @close="reader = null"
      @edit="openEdit"
      @tag="openTag"
      @goto="gotoRef"
      @changed="(n) => patchLocal(n)"
    />

    <BaseDrawer
      :open="baseDrawerOpen"
      :base-tag="baseTag"
      @close="baseDrawerOpen = false"
      @create="newBase"
      @open="openBaseNote"
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
              <button class="type-tab" :class="{ on: editType === 'idea' }" @click="editType = 'idea'">灵感</button>
              <button class="type-tab" :class="{ on: editType === 'insight' }" @click="editType = 'insight'">心得</button>
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

        <div v-if="editImages.length" class="attach-strip">
          <div v-for="(img, idx) in editImages" :key="idx" class="thumb">
            <img :src="img.url" alt="" />
            <button class="thumb-x" aria-label="移除" @click="editImages.splice(idx, 1)">
              <svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </div>

        <div class="modal-foot">
          <div class="tag-input-wrap">
            <span class="hash">#</span>
            <input id="tagInput" type="text" placeholder="回车添加标签" autocomplete="off" spellcheck="false" @keydown="editAddTag" />
          </div>
          <div class="tag-chips">
            <button v-for="t in editTags" :key="t" class="tag-chip" @click="editTags = editTags.filter((x) => x !== t)">
              #{{ t }}<span class="x">×</span>
            </button>
          </div>
          <label class="modal-pin"><input v-model="editPinned" type="checkbox" /> 置顶</label>
          <button class="ghost-btn" @click="closeEdit">取消</button>
          <button class="primary-btn" :disabled="editBusy" @click="saveEdit">{{ editBusy ? '保存…' : '保存' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
