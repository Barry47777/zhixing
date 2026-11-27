<script setup lang="ts">
/**
 * 附件区：
 * - 图片显示缩略图，点开灯箱；PDF 直接在新标签页打开（浏览器自带阅读器）
 * - 其他文件点击下载
 * - editable 时右上角有「+」，可以直接给已保存的记录补附件，也能把文件拖进来
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '../base/Icon.vue'
import { attachFilesToEntry, attachmentsOf, deleteAttachment, type AttachmentRow } from '../../stores/data'
import { fmtBytes } from '../../utils/format'
import { toast, confirmDialog } from '../../stores/ui'

const props = defineProps<{ entryId: string; date: string; editable?: boolean; ids?: string[] }>()

type Row = AttachmentRow

const items = ref<Row[]>([])
const preview = ref<{ url: string; name: string; kind: 'image' | 'pdf' | 'text' } | null>(null)
const textBody = ref('')
const fileEl = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const dragOver = ref(false)

async function load() {
  items.value = await attachmentsOf(props.entryId)
}

function revokeUrls() {
  items.value = []
}

onMounted(load)
watch(() => props.entryId, load)
// 父组件新增/删除附件后 entry.attachmentIds 会变，靠它触发重新加载
watch(() => (props.ids || []).join(','), (next, prev) => {
  if (prev !== undefined && next !== prev) void load()
})
onBeforeUnmount(revokeUrls)

const isImage = (a: Row) => (a.mime || '').startsWith('image/')
const isPdf = (a: Row) =>
  a.mime === 'application/pdf' || /\.pdf$/i.test(a.name)
const isText = (a: Row) =>
  (a.mime || '').startsWith('text/') || /\.(md|markdown|txt|csv|json|log)$/i.test(a.name)
function ext(a: Row) {
  const m = a.name.match(/\.([a-z0-9]{1,5})$/i)
  return m ? m[1].toUpperCase() : 'FILE'
}

async function open(a: Row) {
  if (isImage(a)) {
    preview.value = { url: a.url, name: a.name, kind: 'image' }
    return
  }
  if (isPdf(a)) {
    preview.value = { url: a.url, name: a.name, kind: 'pdf' }
    return
  }
  if (isText(a)) {
    textBody.value = a.size > 400 * 1024
      ? '文件较大（>400KB），请下载后查看。'
      : await fetch(a.url).then((r) => r.text()).catch(() => '无法读取该文件内容')
    preview.value = { url: a.url, name: a.name, kind: 'text' }
    return
  }
  download(a)
}

function openInTab() {
  if (preview.value) window.open(preview.value.url, '_blank', 'noopener')
}

function download(a: Row) {
  const link = document.createElement('a')
  link.href = a.url
  link.download = a.name
  link.click()
}

async function addFiles(list: File[] | FileList) {
  const files = Array.from(list)
  if (!files.length || busy.value) return
  busy.value = true
  try {
    const res = await attachFilesToEntry(props.entryId, props.date, files)
    await load()
    if (res.rejected.length) {
      toast(res.rejected[0].reason, 'warn')
    } else if (res.created.length) {
      toast(`已添加 ${res.created.length} 个附件`, 'success')
    }
  } finally {
    busy.value = false
  }
}

function pick(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) void addFiles(input.files)
  input.value = ''
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  if (!props.editable || !e.dataTransfer?.files.length) return
  void addFiles(e.dataTransfer.files)
}

async function remove(a: Row) {
  const res = await confirmDialog({
    title: '删除这个附件？',
    message: `「${a.name}」将从这条记录里移除，无法恢复。`,
    danger: true,
    confirmText: '删除',
  })
  if (!res.ok) return
  await deleteAttachment(a.id)
  await load()
  toast('附件已删除')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') preview.value = null
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div
    v-if="items.length || editable"
    class="att-grid"
    :class="{ 'is-over': dragOver }"
    @dragover.prevent="editable && (dragOver = true)"
    @dragleave="dragOver = false"
    @drop.prevent="onDrop"
  >
    <div v-for="a in items" :key="a.id" class="att" :class="{ 'is-file': !isImage(a) }">
      <button
        v-if="isImage(a)"
        class="att-thumb"
        :title="a.name"
        @click="open(a)"
      >
        <img :src="a.thumbUrl || a.url" :alt="a.name" loading="lazy" />
      </button>
      <button v-else class="att-file" :title="`查看 ${a.name}`" @click="open(a)">
        <span class="ftype" :class="{ pdf: isPdf(a) }">{{ ext(a) }}</span>
        <span class="att-name">{{ a.name }}</span>
        <span class="att-size">{{ fmtBytes(a.size) }}</span>
      </button>
      <button v-if="editable" class="att-del" title="删除附件" @click.stop="remove(a)">
        <Icon name="close" :size="11" />
      </button>
    </div>

    <button v-if="editable" class="att-add" :class="{ 'is-busy': busy }" title="添加图片 / 文件" @click="fileEl?.click()">
      <Icon name="plus" :size="14" />
    </button>
    <input
      ref="fileEl"
      type="file"
      multiple
      hidden
      accept="image/*,.pdf,.md,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.zip,.mp4"
      @change="pick"
    />
  </div>

  <Teleport to="body">
    <div v-if="preview" class="lightbox" :class="'is-' + preview.kind" @click="preview = null">
      <img v-if="preview.kind === 'image'" :src="preview.url" :alt="preview.name" @click.stop />
      <iframe v-else-if="preview.kind === 'pdf'" :src="preview.url" :title="preview.name" @click.stop />
      <pre v-else class="lb-text" @click.stop>{{ textBody }}</pre>
      <div class="lb-bar">
        <span class="lb-name">{{ preview.name }}</span>
        <button class="lb-btn" @click.stop="openInTab">新标签打开</button>
        <button class="lb-btn" @click="preview = null">关闭</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.att-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  border-radius: 8px;
  transition: box-shadow .15s, background .15s;
}
.att-grid.is-over { box-shadow: 0 0 0 2px var(--accent); background: var(--accent-soft); }
.att { position: relative; }
.att-thumb {
  width: 52px;
  height: 52px;
  border-radius: 7px;
  overflow: hidden;
  border: 1px solid var(--line);
  display: block;
  background: var(--bg-soft);
}
.att-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .2s; }
.att-thumb:hover img { transform: scale(1.06); }

.att-file {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 210px;
  height: 30px;
  padding: 0 8px 0 5px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--ink-2);
  font-size: 11px;
}
.att-file:hover { border-color: var(--accent); color: var(--accent); }
.ftype {
  flex: none;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: .02em;
  padding: 2px 4px;
  border-radius: 3px;
  background: var(--bg-soft);
  color: var(--muted);
}
.ftype.pdf { background: rgba(206, 74, 74, .12); color: #c14a4a; }
.att-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 105px; }
.att-size { font-size: 9.5px; color: var(--faint); flex: none; }

.att-add {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  border: 1px dashed var(--line);
  color: var(--muted);
  display: grid;
  place-items: center;
}
.att-add:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.att-add.is-busy { opacity: .5; pointer-events: none; }

.att-del {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--ink);
  color: var(--panel);
  opacity: 0;
  transition: opacity .15s;
}
.att:hover .att-del { opacity: 1; }

.lightbox {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(8, 9, 12, .88);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 40px;
  cursor: zoom-out;
  animation: fade .16s;
}
.lightbox img {
  max-width: min(1100px, 92vw);
  max-height: 78vh;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 30px 70px -30px rgba(0, 0, 0, .8);
  cursor: default;
}
.lightbox.is-pdf { padding: 24px; }
.lightbox iframe {
  width: min(1000px, 92vw);
  height: 82vh;
  border: 0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 30px 70px -30px rgba(0, 0, 0, .8);
  cursor: default;
}
.lightbox.is-text { padding: 24px; }
.lb-text {
  width: min(820px, 92vw);
  max-height: 76vh;
  overflow: auto;
  margin: 0;
  padding: 18px 20px;
  border-radius: 8px;
  background: #fff;
  color: #22252b;
  font-size: 12.5px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  cursor: default;
}
.lb-bar { display: flex; align-items: center; gap: 12px; color: #d5d8de; font-size: 12px; }
.lb-name { max-width: 40vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lb-btn {
  color: #fff;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, .25);
}
.lb-btn:hover { background: rgba(255, 255, 255, .12); }
</style>
