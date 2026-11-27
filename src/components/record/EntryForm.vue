<script setup lang="ts">
/**
 * 快速记录表单。
 * 设计原则：默认状态下 5 秒能记完一条——写标题、点项目、拖时长、回车。
 * 其余字段（优先级 / 标签 / 子任务 / 说明 / 附件）收在「更多」里，但附件也能直接从标题栏的曲别针或拖拽文件进来。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Entry, EntryStatus, Priority } from '../../types.studio'
import Icon from '../base/Icon.vue'
import DragNumber from '../base/DragNumber.vue'
import { data, projectMap, saveTemplate, tagPool } from '../../stores/data'
import { settings } from '../../stores/settings'
import { toast } from '../../stores/ui'
import { splitTags, uid } from '../../utils/format'

const props = withDefaults(defineProps<{
  date: string
  entry?: Entry | null
  autofocus?: boolean
}>(), { entry: null, autofocus: false })

const emit = defineEmits<{
  (e: 'submit', payload: {
    title: string
    projectId: string | null
    hours: number
    status: EntryStatus
    priority: Priority
    tags: string[]
    note: string
    subtasks: Entry['subtasks']
    files: File[]
  }): void
  (e: 'cancel'): void
}>()

const isEdit = computed(() => !!props.entry)

const HOUR_PRESETS = [0.5, 1, 1.5, 2, 3, 4, 6, 8]

const title = ref(props.entry?.title || '')
const projectId = ref<string | null>(
  props.entry ? props.entry.projectId : (settings.defaultProjectId || null),
)
const hours = ref<number>(props.entry ? props.entry.hours : settings.defaultHours)
const status = ref<EntryStatus>(props.entry?.status || 'done')
const priority = ref<Priority>(props.entry?.priority || 0)
const tags = ref<string[]>([...(props.entry?.tags || [])])
const tagDraft = ref('')
const note = ref(props.entry?.note || '')
const subtasks = ref<{ id: string; text: string; done: boolean }[]>(
  (props.entry?.subtasks || []).map((s) => ({ ...s })),
)
const subDraft = ref('')
const pending = ref<{ file: File; url: string | null }[]>([])
const expanded = ref(!!props.entry || false)
const dragOver = ref(false)
const titleEl = ref<HTMLInputElement | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)

const statusOptions: { value: EntryStatus; label: string; short: string }[] = [
  { value: 'done', label: '已完成', short: '完成' },
  { value: 'doing', label: '进行中', short: '进行' },
  { value: 'blocked', label: '受阻', short: '受阻' },
]

const priorityLabels: Record<number, string> = { 0: '普通', 1: '重要', 2: '紧急' }

const projectOptions = computed(() => data.projects.filter((p) => p.status !== 'archived'))

const quickTags = computed(() =>
  tagPool().map((t) => t.tag).filter((t) => !tags.value.includes(t)).slice(0, 8),
)

watch(() => props.entry, (e) => {
  if (!e) return
  title.value = e.title
  projectId.value = e.projectId
  hours.value = e.hours
  status.value = e.status
  priority.value = e.priority
  tags.value = [...e.tags]
  note.value = e.note
  subtasks.value = e.subtasks.map((s) => ({ ...s }))
  expanded.value = true
})

onMounted(() => {
  if (props.autofocus) void nextTick(() => titleEl.value?.focus())
})

onBeforeUnmount(() => {
  pending.value.forEach((p) => { if (p.url) URL.revokeObjectURL(p.url) })
})

/* ---------- 标签 ---------- */

function addTag(raw: string) {
  const parts = splitTags(raw)
  if (!parts.length) return
  tags.value = [...new Set([...tags.value, ...parts])].slice(0, 8)
  tagDraft.value = ''
}

function onTagKey(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
    e.preventDefault()
    addTag(tagDraft.value)
  }
  if (e.key === 'Backspace' && !tagDraft.value && tags.value.length) {
    tags.value = tags.value.slice(0, -1)
  }
}

function toggleTag(t: string) {
  tags.value = tags.value.includes(t) ? tags.value.filter((x) => x !== t) : [...tags.value, t]
}

/* ---------- 子任务 ---------- */

function addSubtask() {
  const t = subDraft.value.trim()
  if (!t) return
  subtasks.value = [...subtasks.value, { id: uid('s_'), text: t, done: false }]
  subDraft.value = ''
}

function removeSubtask(id: string) {
  subtasks.value = subtasks.value.filter((s) => s.id !== id)
}

/* ---------- 附件 ---------- */

function acceptFiles(list: File[] | FileList) {
  const files = Array.from(list)
  if (!files.length) return
  const room = 8 - pending.value.length
  if (room <= 0) {
    toast('一条记录最多 8 个附件，保存后再回来加也行', 'warn')
    return
  }
  const next = files.slice(0, room).map((file) => ({
    file,
    url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
  }))
  pending.value = [...pending.value, ...next]
  if (files.length > room) toast(`只接收了前 ${room} 个`, 'warn')
}

function pickFiles() {
  fileEl.value?.click()
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) acceptFiles(input.files)
  input.value = ''
}

function removeFile(index: number) {
  const item = pending.value[index]
  if (item?.url) URL.revokeObjectURL(item.url)
  pending.value = pending.value.filter((_, i) => i !== index)
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  if (e.dataTransfer?.files?.length) {
    acceptFiles(e.dataTransfer.files)
    expanded.value = true
  }
}

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (const item of items) {
    if (item.kind === 'file') {
      const f = item.getAsFile()
      if (f) files.push(f)
    }
  }
  if (files.length) {
    e.preventDefault()
    acceptFiles(files)
    expanded.value = true
    toast(`已粘贴 ${files.length} 个文件`, 'success')
  }
}

/* ---------- 提交 ---------- */

function submit() {
  const t = title.value.trim()
  if (!t) {
    titleEl.value?.focus()
    toast('先写一句做了什么', 'warn')
    return
  }
  emit('submit', {
    title: t,
    projectId: projectId.value,
    hours: Number(hours.value) || 0,
    status: status.value,
    priority: priority.value,
    tags: tags.value,
    note: note.value.trim(),
    subtasks: subtasks.value.map((s) => ({ ...s })),
    files: pending.value.map((p) => p.file),
  })

  if (!isEdit.value) {
    title.value = ''
    tags.value = []
    tagDraft.value = ''
    note.value = ''
    subtasks.value = []
    subDraft.value = ''
    pending.value.forEach((p) => { if (p.url) URL.revokeObjectURL(p.url) })
    pending.value = []
    hours.value = settings.defaultHours
    priority.value = 0
    void nextTick(() => titleEl.value?.focus())
  }
}

function applyTemplate(tplId: string) {
  const tpl = data.templates.find((t) => t.id === tplId)
  if (!tpl) return
  title.value = tpl.title || tpl.name
  projectId.value = tpl.projectId
  hours.value = tpl.hours
  tags.value = [...tpl.tags]
  subtasks.value = tpl.subtasks.map((text) => ({ id: uid('s_'), text, done: false }))
  expanded.value = true
}

async function saveAsTemplate() {
  if (!title.value.trim()) {
    toast('先写下标题再存为模板', 'warn')
    return
  }
  await saveTemplate({
    name: title.value.trim().slice(0, 12),
    title: title.value.trim(),
    projectId: projectId.value,
    hours: Number(hours.value) || 0,
    tags: tags.value,
    subtasks: subtasks.value.map((s) => s.text),
  })
  toast('已存为模板', 'success')
}

function cyclePriority() {
  priority.value = ((priority.value + 1) % 3) as Priority
}
</script>

<template>
  <form
    class="entry-form"
    :class="{ 'is-edit': isEdit, 'is-drag': dragOver }"
    @submit.prevent="submit"
    @dragover.prevent="dragOver = true"
    @dragleave="dragOver = false"
    @drop.prevent="onDrop"
    @paste="onPaste"
  >
    <div v-if="dragOver" class="drop-mask">
      <Icon name="clip" :size="17" />
      松手即可添加到这条记录
    </div>

    <div class="form-head">
      <span class="form-label">{{ isEdit ? '编辑记录' : '记录一件事' }}</span>
      <div class="head-tools">
        <button
          v-if="!isEdit && data.templates.length"
          type="button"
          class="mini-btn"
          @click="expanded = !expanded"
        >模板</button>
        <button type="button" class="mini-btn" @click="expanded = !expanded">
          {{ expanded ? '收起' : '更多' }}
        </button>
      </div>
    </div>

    <div class="title-row">
      <input
        ref="titleEl"
        v-model="title"
        class="title-input"
        type="text"
        placeholder="今天做了什么？回车即存"
        maxlength="80"
        @keydown.enter.prevent="submit"
      />
      <button
        type="button"
        class="clip-btn"
        :class="{ 'has-files': pending.length }"
        title="添加图片 / PDF / 文件（也可以直接拖进来，或 Ctrl+V 粘贴截图）"
        @click="pickFiles"
      >
        <Icon name="clip" :size="15" />
        <span v-if="pending.length" class="clip-count">{{ pending.length }}</span>
      </button>
      <button class="submit-btn" type="submit" :title="isEdit ? '保存' : '记录（回车）'">
        <Icon :name="isEdit ? 'check' : 'plus'" :size="16" :stroke-width="2.1" />
      </button>
    </div>

    <input ref="fileEl" type="file" multiple hidden
      accept="image/*,.pdf,.md,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.zip,.mp4" @change="onPick" />

    <div v-if="pending.length" class="pending-files">
      <div v-for="(p, i) in pending" :key="p.file.name + i" class="pf">
        <img v-if="p.url" :src="p.url" :alt="p.file.name" />
        <span v-else class="pf-ext">{{ (p.file.name.split('.').pop() || 'file').slice(0, 4).toUpperCase() }}</span>
        <span class="pf-name">{{ p.file.name }}</span>
        <button type="button" class="pf-del" title="移除" @click="removeFile(i)">
          <Icon name="close" :size="11" />
        </button>
      </div>
    </div>

    <div class="proj-chips" role="radiogroup" aria-label="项目">
      <button
        type="button"
        class="pchip"
        :class="{ 'is-on': projectId === null }"
        :style="{ '--c': 'var(--muted)' }"
        @click="projectId = null"
      >
        <i class="dot" />未分类
      </button>
      <button
        v-for="p in projectOptions"
        :key="p.id"
        type="button"
        class="pchip"
        :class="{ 'is-on': projectId === p.id }"
        :style="{ '--c': p.color }"
        :title="p.name"
        @click="projectId = p.id"
      >
        <i class="dot" />{{ p.name }}
      </button>
    </div>

    <div class="hours-row">
      <span class="row-label">时长</span>
      <DragNumber
        v-model="hours"
        :min="0"
        :max="16"
        :step="0.5"
        unit="h"
        :presets="HOUR_PRESETS"
        aria-label="这条记录的时长"
      />
      <button
        v-if="hours > 0"
        type="button"
        class="reset-hours"
        title="清零"
        @click="hours = 0"
      ><Icon name="close" :size="11" /></button>
    </div>

    <div class="status-row">
      <div class="seg">
        <button
          v-for="s in statusOptions"
          :key="s.value"
          type="button"
          class="seg-btn"
          :class="[`s-${s.value}`, { 'is-on': status === s.value }]"
          :title="s.label"
          @click="status = s.value"
        >{{ s.short }}</button>
      </div>
      <span class="spacer" />
      <button
        type="button"
        class="prio-btn"
        :class="`p${priority}`"
        :title="`优先级：${priorityLabels[priority]}（点击切换）`"
        @click="cyclePriority"
      >
        <span class="prio-dot" />{{ priorityLabels[priority] }}
      </button>
    </div>

    <div v-if="expanded" class="more-fields">
      <div v-if="!isEdit && data.templates.length" class="tpl-row">
        <span class="mini-label">模板</span>
        <button
          v-for="t in data.templates.slice(0, 4)"
          :key="t.id"
          type="button"
          class="tpl-chip"
          :style="{ '--c': t.projectId ? projectMap.get(t.projectId)?.color : 'var(--muted)' }"
          @click="applyTemplate(t.id)"
        >
          {{ t.name }}
        </button>
      </div>

      <div class="tag-block">
        <span class="mini-label">标签</span>
        <div class="tag-wrap">
          <span v-for="(t, i) in tags" :key="t" class="tag-pill">
            {{ t }}
            <button type="button" @click="tags.splice(i, 1)">
              <Icon name="close" :size="9" />
            </button>
          </span>
          <input
            v-model="tagDraft"
            class="tag-input"
            type="text"
            placeholder="输入后回车"
            @keydown="onTagKey"
            @blur="addTag(tagDraft)"
          />
        </div>
        <div v-if="quickTags.length" class="quick-tags">
          <button v-for="t in quickTags" :key="t" type="button" class="qtag" @click="toggleTag(t)">+ {{ t }}</button>
        </div>
      </div>

      <div class="sub-block">
        <span class="mini-label">子任务</span>
        <div class="sub-list">
          <div v-for="s in subtasks" :key="s.id" class="sub-item" :class="{ 'is-done': s.done }">
            <button type="button" class="sub-check" @click="s.done = !s.done">
              <Icon v-if="s.done" name="check" :size="9" :stroke-width="3" />
            </button>
            <span class="sub-text">{{ s.text }}</span>
            <button type="button" class="sub-del" @click="removeSubtask(s.id)">
              <Icon name="close" :size="10" />
            </button>
          </div>
        </div>
        <input
          v-model="subDraft"
          class="soft-input sub-input"
          type="text"
          placeholder="加一条子任务，回车确认"
          @keydown.enter.prevent="addSubtask"
        />
      </div>

      <textarea
        v-model="note"
        class="soft-input"
        rows="2"
        placeholder="补充说明：卡点、结论、下次怎么做（可选）"
      />

      <div class="attach-row">
        <button type="button" class="attach-btn" @click="pickFiles">
          <Icon name="clip" :size="13" />
          <span>添加图片 / PDF / 文件</span>
        </button>
        <span class="attach-hint">可拖拽 · 可 Ctrl+V 粘贴截图</span>
        <button v-if="!isEdit" type="button" class="attach-btn subtle" @click="saveAsTemplate">
          存为模板
        </button>
      </div>
    </div>

    <div v-if="isEdit" class="edit-actions">
      <button type="submit" class="btn primary sm">保存修改</button>
      <button type="button" class="btn sm" @click="emit('cancel')">取消</button>
    </div>
  </form>
</template>

<style scoped>
.entry-form {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 11px;
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  background: var(--panel-2);
  transition: border-color .16s, box-shadow .16s;
}
.entry-form:focus-within {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.entry-form.is-edit {
  border-color: var(--accent);
  background: var(--panel);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.entry-form.is-drag { border-color: var(--accent); }

.drop-mask {
  position: absolute;
  inset: 0;
  z-index: 5;
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--accent) 8%, var(--panel));
  border: 1.5px dashed var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-size: 12px;
  color: var(--accent);
  pointer-events: none;
}

.form-head { display: flex; align-items: center; justify-content: space-between; }
.form-label {
  font-size: 10px;
  font-weight: 650;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--muted);
}
.head-tools { display: flex; gap: 2px; }
.mini-btn {
  font-size: 10.5px;
  color: var(--muted);
  padding: 1px 5px;
  border-radius: 4px;
}
.mini-btn:hover { background: var(--bg-soft); color: var(--ink-2); }

.title-row { display: flex; gap: 5px; align-items: center; }
.title-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  font-size: 13.5px;
  font-weight: 500;
  background: var(--panel);
  border-color: var(--line);
}
.clip-btn {
  position: relative;
  width: 32px;
  height: 36px;
  flex: none;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: var(--muted);
  border: 1px solid transparent;
}
.clip-btn:hover { background: var(--bg-soft); color: var(--accent); border-color: var(--line); }
.clip-btn.has-files { color: var(--accent); background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
.clip-count {
  position: absolute;
  top: 3px;
  right: 2px;
  min-width: 13px;
  height: 13px;
  padding: 0 3px;
  border-radius: 99px;
  background: var(--accent);
  color: #fff;
  font-size: 8.5px;
  font-weight: 700;
  line-height: 13px;
  text-align: center;
}
.submit-btn {
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: var(--accent);
  color: #fff;
  box-shadow: 0 4px 12px -6px var(--accent);
  transition: filter .15s, transform .1s;
}
.submit-btn:hover { filter: brightness(1.07); }
.submit-btn:active { transform: scale(.96); }

.pending-files { display: flex; flex-wrap: wrap; gap: 4px; }
.pf {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 4px;
  border-radius: 6px;
  background: var(--panel);
  border: 1px solid var(--line);
  max-width: 100%;
}
.pf img { width: 20px; height: 20px; object-fit: cover; border-radius: 4px; flex: none; }
.pf-ext {
  flex: none;
  font-size: 7.5px;
  font-weight: 700;
  padding: 3px 3px;
  border-radius: 3px;
  background: var(--bg-soft);
  color: var(--muted);
}
.pf-name {
  font-size: 10.5px;
  color: var(--ink-2);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pf-del { color: var(--faint); display: grid; place-items: center; width: 16px; height: 16px; border-radius: 4px; }
.pf-del:hover { color: var(--danger); background: var(--danger-soft); }

.proj-chips {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: none;
  -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 18px), transparent);
  mask-image: linear-gradient(90deg, #000 calc(100% - 18px), transparent);
}
.proj-chips::-webkit-scrollbar { display: none; }
.pchip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  height: 25px;
  padding: 0 9px;
  border-radius: 99px;
  border: 1px solid var(--line);
  background: var(--panel);
  font-size: 11px;
  color: var(--ink-2);
  transition: border-color .14s, background .14s, color .14s;
  max-width: 132px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pchip .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--c); flex: none; }
.pchip:hover { border-color: color-mix(in srgb, var(--c) 50%, var(--line)); }
.pchip.is-on {
  border-color: var(--c);
  background: color-mix(in srgb, var(--c) 13%, var(--panel));
  color: var(--ink);
  font-weight: 600;
}

.hours-row { display: flex; align-items: center; gap: 8px; }
.row-label { font-size: 10.5px; color: var(--muted); flex: none; }
.reset-hours {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--faint);
  flex: none;
}
.reset-hours:hover { background: var(--bg-soft); color: var(--ink-2); }

.status-row { display: flex; align-items: center; gap: 6px; }
.seg {
  display: inline-flex;
  padding: 2px;
  border-radius: 8px;
  background: var(--bg-soft);
  border: 1px solid var(--line-soft);
  gap: 1px;
}
.seg-btn {
  height: 23px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--muted);
  transition: background .14s, color .14s;
}
.seg-btn:hover { color: var(--ink-2); }
.seg-btn.is-on { background: var(--panel); color: var(--ink); font-weight: 600; box-shadow: var(--shadow-xs); }
.seg-btn.s-done.is-on { color: #2f7d4f; }
.seg-btn.s-doing.is-on { color: var(--warn); }
.seg-btn.s-blocked.is-on { color: var(--danger); }
[data-theme="dark"] .seg-btn.s-done.is-on { color: #6ec08e; }

.spacer { flex: 1; }
.prio-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--panel);
  font-size: 10.5px;
  color: var(--muted);
}
.prio-btn .prio-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--faint); }
.prio-btn.p1 { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, var(--line)); background: rgba(183, 121, 31, .1); }
.prio-btn.p1 .prio-dot { background: var(--warn); }
.prio-btn.p2 { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, var(--line)); background: var(--danger-soft); }
.prio-btn.p2 .prio-dot { background: var(--danger); }

.more-fields { display: flex; flex-direction: column; gap: 7px; padding-top: 3px; border-top: 1px dashed var(--line-soft); margin-top: 1px; }

.tpl-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.mini-label { font-size: 10.5px; color: var(--muted); flex: none; }
.tpl-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 99px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--ink-2);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.tpl-chip::before {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--c, var(--muted));
}
.tpl-chip:hover { border-color: var(--accent); color: var(--accent); }

.tag-block, .sub-block { display: flex; flex-direction: column; gap: 5px; }
.tag-wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 3px 5px;
  border-radius: 7px;
  background: var(--panel);
  border: 1px solid var(--line);
}
.tag-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 21px;
  padding: 0 3px 0 7px;
  border-radius: 5px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10.5px;
}
.tag-pill button { display: grid; place-items: center; width: 15px; height: 15px; border-radius: 3px; color: inherit; opacity: .7; }
.tag-pill button:hover { opacity: 1; background: rgba(0,0,0,.06); }
.tag-input {
  flex: 1;
  min-width: 70px;
  height: 22px;
  border: 0;
  background: transparent;
  box-shadow: none;
  padding: 0 2px;
  font-size: 11.5px;
}
.tag-input:focus { outline: none; box-shadow: none; }
.quick-tags { display: flex; flex-wrap: wrap; gap: 3px; }
.qtag {
  font-size: 10px;
  color: var(--muted);
  padding: 1px 6px;
  border-radius: 99px;
  background: var(--bg-soft);
}
.qtag:hover { color: var(--accent); background: var(--accent-soft); }

.sub-list { display: flex; flex-direction: column; gap: 2px; }
.sub-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--ink-2);
  padding: 2px 3px;
  border-radius: 5px;
}
.sub-item:hover { background: var(--bg-soft); }
.sub-item.is-done .sub-text { text-decoration: line-through; color: var(--muted); }
.sub-check {
  width: 13px;
  height: 13px;
  border-radius: 3.5px;
  border: 1.3px solid var(--line);
  display: grid;
  place-items: center;
  color: #fff;
  flex: none;
}
.sub-item.is-done .sub-check { background: var(--accent); border-color: var(--accent); }
.sub-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.sub-del { color: var(--faint); width: 16px; height: 16px; border-radius: 4px; display: grid; place-items: center; opacity: 0; }
.sub-item:hover .sub-del { opacity: 1; }
.sub-del:hover { color: var(--danger); background: var(--danger-soft); }

.soft-input {
  width: 100%;
  font-size: 12px;
  padding: 7px 9px;
  background: var(--panel);
  resize: vertical;
}
.sub-input { padding: 5px 8px; }

.attach-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.attach-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--ink-2);
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px dashed var(--line);
}
.attach-btn:hover { border-color: var(--accent); color: var(--accent); }
.attach-btn.subtle { border-style: solid; color: var(--muted); margin-left: auto; }
.attach-hint { font-size: 10px; color: var(--faint); }

.edit-actions { display: flex; gap: 6px; margin-top: 2px; }
</style>
