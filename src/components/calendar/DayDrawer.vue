<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '../base/Icon.vue'
import EntryForm from '../record/EntryForm.vue'
import AttachmentGrid from '../record/AttachmentGrid.vue'
import type { Entry, EntryStatus } from '../../types.studio'
import type { EntryInput } from '../../stores/data'
import {
  addEntry, attachFilesToEntry, copyEntries, data, entriesOn,
  projectColor, projectName, restoreEntry, setSummary, summaryOf, trashEntry, updateEntry,
} from '../../stores/data'
import { closeDrawer, openDrawer, session } from '../../stores/session'
import { settings } from '../../stores/settings'
import { confirmDialog, toast } from '../../stores/ui'
import { dayLabel, prevKey, todayKey } from '../../utils/date'
import { fmtDuration, fmtHours } from '../../utils/format'

const router = useRouter()

const date = computed(() => session.drawerDate)
const isOpen = computed(() => !!date.value)

const list = computed(() => (date.value ? entriesOn(date.value) : []))
const total = computed(() => list.value.reduce((s, e) => s + e.hours, 0))
const doneCount = computed(() => list.value.filter((e) => e.status === 'done').length)
const goalPct = computed(() => Math.min(100, Math.round(total.value / Math.max(1, settings.dailyGoal) * 100)))

const editing = computed(() =>
  session.editingEntryId ? data.entries.find((e) => e.id === session.editingEntryId) || null : null,
)

const isToday = computed(() => date.value === todayKey())
const summaryDraft = ref('')
let summaryTimer: number | undefined

watch(date, (d) => {
  summaryDraft.value = d ? summaryOf(d) : ''
}, { immediate: true })

watch(summaryDraft, (val) => {
  if (!date.value) return
  window.clearTimeout(summaryTimer)
  summaryTimer = window.setTimeout(() => {
    if (date.value && val !== summaryOf(date.value)) void setSummary(date.value, val)
  }, 600)
})

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) closeDrawer()
}
window.addEventListener('keydown', onKey)

type EntryPayload = Omit<EntryInput, 'date'> & { files: File[] }

async function onCreate(payload: EntryPayload) {
  if (!date.value) return
  const { files, ...input } = payload
  const entry = await addEntry({ ...input, date: date.value })
  if (!entry) return
  if (files.length) {
    const res = await attachFilesToEntry(entry.id, entry.date, files)
    if (res.rejected.length) toast(`${res.created.length} 个附件已保存，${res.rejected[0].name}：${res.rejected[0].reason}`, 'warn')
    else toast(`已记录，附 ${res.created.length} 个附件`, 'success')
    return
  }
  toast('已记录', 'success')
}

async function onEdit(payload: EntryPayload) {
  const target = editing.value
  if (!target) return
  const { files, ...input } = payload
  await updateEntry(target.id, {
    title: input.title,
    projectId: input.projectId,
    hours: input.hours,
    status: input.status,
    priority: input.priority,
    tags: input.tags,
    note: input.note,
    subtasks: input.subtasks,
  })
  if (files.length) {
    const res = await attachFilesToEntry(target.id, target.date, files)
    if (res.rejected.length) toast(`已保存，${res.rejected.length} 个附件未能添加`, 'warn')
  }
  session.editingEntryId = null
  toast('已保存', 'success')
}

async function toggleDone(entry: Entry) {
  const next: EntryStatus = entry.status === 'done' ? 'doing' : 'done'
  await updateEntry(entry.id, { status: next })
}

async function remove(entry: Entry) {
  await trashEntry(entry.id)
  toast('已移到回收站', 'default', {
    label: '撤销',
    run: () => { void restoreEntry(entry.id) },
  })
}

async function copyPrevDay() {
  if (!date.value) return
  const n = await copyEntries(prevKey(date.value), date.value)
  toast(n ? `已复制 ${n} 条` : '前一天没有记录', n ? 'success' : 'warn')
}

const attachTarget = ref<Entry | null>(null)
const attachEl = ref<HTMLInputElement | null>(null)

function pickAttach(entry: Entry) {
  attachTarget.value = entry
  attachEl.value?.click()
}

async function onAttachPick(e: Event) {
  const input = e.target as HTMLInputElement
  const target = attachTarget.value
  const files = input.files ? Array.from(input.files) : []
  input.value = ''
  if (!target || !files.length) return
  const res = await attachFilesToEntry(target.id, target.date, files)
  if (res.rejected.length) toast(res.rejected[0].reason, 'warn')
  else toast(`已添加 ${res.created.length} 个附件`, 'success')
}

function goReview() {
  closeDrawer()
  router.push('/review')
}

function openEntry(entry: Entry) {
  session.editingEntryId = entry.id
  void nextTick(() => document.querySelector<HTMLInputElement>('.drawer .title-input')?.focus())
}

</script>

<template>
  <Teleport to="body">
    <Transition name="scrim">
      <div v-if="isOpen" class="scrim" @click="closeDrawer" />
    </Transition>
  </Teleport>

  <aside class="drawer" :class="{ 'is-open': isOpen }" :aria-hidden="!isOpen">
    <template v-if="date">
      <header class="drawer-head">
        <div class="dh-main">
          <div class="dh-date">
            {{ dayLabel(date) }}
            <span v-if="isToday" class="dh-today">今天</span>
          </div>
          <div class="dh-meta">
            <span>{{ list.length }} 条记录</span>
            <i />
            <span>{{ fmtDuration(total) }}</span>
            <i />
            <span>完成 {{ doneCount }}/{{ list.length }}</span>
          </div>
        </div>
        <button class="icon-btn" title="关闭 (Esc)" @click="closeDrawer">
          <Icon name="close" :size="18" />
        </button>
      </header>

      <div class="goal-strip">
        <span class="goal-label">今日 {{ fmtHours(total) }} / {{ fmtHours(settings.dailyGoal) }}h</span>
        <div class="goal-bar"><i :style="{ width: goalPct + '%' }" /></div>
      </div>

      <div class="drawer-body">
        <EntryForm
          v-if="editing"
          :key="'edit-' + editing.id"
          :date="date"
          :entry="editing"
          @submit="onEdit"
          @cancel="session.editingEntryId = null"
        />
        <EntryForm v-else :date="date" autofocus @submit="onCreate" />

        <div class="list-head">
          <span class="section-label">当天记录</span>
          <button class="text-btn" @click="copyPrevDay">
            <Icon name="copy" :size="12" /> 复制昨天
          </button>
        </div>

        <div v-if="!list.length" class="empty">
          <Icon name="sparkle" :size="26" />
          <strong>这天还是空白</strong>
          <span>在上面写一句话就能记下来，时长可以之后再补。</span>
        </div>

        <ul v-else class="entry-list">
          <li
            v-for="e in list"
            :key="e.id"
            class="entry"
            :class="[`s-${e.status}`, { 'is-editing': session.editingEntryId === e.id }]"
            :style="{ '--c': projectColor(e.projectId) }"
          >
            <button
              class="check"
              :class="{ 'is-done': e.status === 'done' }"
              :title="e.status === 'done' ? '标记为进行中' : '标记为已完成'"
              @click="toggleDone(e)"
            >
              <Icon v-if="e.status === 'done'" name="check" :size="11" :stroke-width="2.8" />
            </button>

            <div class="entry-main" @click="openEntry(e)">
              <div class="entry-title-row">
                <span v-if="e.priority === 2" class="prio-flag" title="紧急">!</span>
                <span class="entry-title">{{ e.title }}</span>
              </div>
              <div class="entry-meta">
                <span class="proj">
                  <i class="dot" />{{ projectName(e.projectId) }}
                </span>
                <span v-if="e.hours" class="meta-item"><Icon name="clock" :size="10" />{{ fmtHours(e.hours) }}h</span>
                <span v-if="e.status === 'doing'" class="meta-item warn">进行中</span>
                <span v-if="e.status === 'blocked'" class="meta-item danger">受阻</span>
                <span v-for="t in e.tags" :key="t" class="tag">{{ t }}</span>
              </div>
              <p v-if="e.note" class="entry-note">{{ e.note }}</p>
              <ul v-if="e.subtasks.length" class="subtasks">
                <li v-for="s in e.subtasks" :key="s.id" :class="{ 'is-done': s.done }">
                  <span class="sub-box" />
                  {{ s.text }}
                </li>
              </ul>
              <div v-if="e.attachmentIds.length" class="entry-atts" @click.stop>
                <AttachmentGrid :entry-id="e.id" :date="e.date" :ids="e.attachmentIds" editable />
              </div>
            </div>

            <div class="entry-actions">
              <button class="icon-btn" title="添加附件" @click="pickAttach(e)">
                <Icon name="clip" :size="14" />
              </button>
              <button class="icon-btn" title="编辑" @click="openEntry(e)">
                <Icon name="edit" :size="14" />
              </button>
              <button class="icon-btn danger" title="删除" @click="remove(e)">
                <Icon name="trash" :size="14" />
              </button>
            </div>
          </li>
        </ul>

        <div class="summary-block">
          <div class="list-head">
            <span class="section-label">当日总结</span>
            <span class="autosave">自动保存</span>
          </div>
          <textarea
            v-model="summaryDraft"
            rows="3"
            placeholder="今天最值得记住的一件事？卡在哪里，明天先做什么？"
          />
        </div>
      </div>

      <input
        ref="attachEl"
        type="file"
        multiple
        hidden
        accept="image/*,.pdf,.md,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.zip,.mp4"
        @change="onAttachPick"
      />

      <footer class="drawer-foot">
        <button class="btn sm ghost" @click="goReview">
          <Icon name="list" :size="13" /> 生成日报
        </button>
        <button class="btn sm primary" @click="openDrawer(isToday ? date : todayKey())">
          <Icon name="calendar" :size="13" /> {{ isToday ? '回到今天' : '跳到今天' }}
        </button>
      </footer>
    </template>
  </aside>
</template>

<style scoped>
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--drawer-w);
  max-width: 100vw;
  background: var(--panel);
  border-left: 1px solid var(--line);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  transform: translateX(102%);
  transition: transform calc(.3s * var(--motion)) cubic-bezier(.22, .85, .25, 1);
  z-index: 80;
  visibility: hidden;
}
.drawer.is-open { transform: translateX(0); visibility: visible; }

.drawer-head {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 18px 16px 10px 20px;
}
.dh-main { flex: 1; min-width: 0; }
.dh-date {
  font-size: 17px;
  font-weight: 660;
  letter-spacing: -.02em;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dh-today {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 2px 6px;
  border-radius: 5px;
  letter-spacing: .04em;
}
.dh-meta {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: var(--muted);
  margin-top: 3px;
  font-variant-numeric: tabular-nums;
}
.dh-meta i { width: 2.5px; height: 2.5px; border-radius: 50%; background: var(--line); }

.goal-strip {
  flex: none;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 20px 12px;
  font-size: 10px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.goal-label { flex: none; letter-spacing: .01em; }
.goal-bar {
  flex: 1;
  height: 3px;
  border-radius: 99px;
  background: var(--line);
  overflow: hidden;
}
.goal-bar i {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 99px;
  transition: width .4s;
}

.drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 16px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}
.section-label {
  font-size: 10px;
  font-weight: 650;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--muted);
}
.text-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  color: var(--muted);
  padding: 2px 4px;
  border-radius: 5px;
}
.text-btn:hover { color: var(--accent); background: var(--accent-soft); }

.entry-list { display: flex; flex-direction: column; gap: 6px; }

.entry {
  display: flex;
  gap: 8px;
  padding: 9px 8px 9px 9px;
  border-radius: var(--r-md);
  border: 1px solid var(--line-soft);
  background: var(--panel);
  transition: border-color .15s, background .15s;
  border-left: 2.5px solid var(--c);
}
.entry:hover { border-color: var(--line); background: var(--panel-2); }
.entry.is-editing { border-color: var(--accent); }
.entry.s-blocked { background: color-mix(in srgb, var(--danger) 4%, var(--panel)); }

.check {
  width: 17px;
  height: 17px;
  margin-top: 1px;
  border-radius: 50%;
  border: 1.5px solid var(--line);
  display: grid;
  place-items: center;
  color: #fff;
  flex: none;
  transition: background .15s, border-color .15s;
}
.check:hover { border-color: var(--c); }
.check.is-done { background: var(--c); border-color: var(--c); }

.entry-main { flex: 1; min-width: 0; cursor: pointer; }
.entry-title-row { display: flex; align-items: center; gap: 5px; }
.entry-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.s-done .entry-title { color: var(--ink-2); }
.prio-flag {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 10px;
  font-weight: 800;
  display: grid;
  place-items: center;
  flex: none;
}

.entry-meta {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  margin-top: 3px;
  font-size: 10.5px;
  color: var(--muted);
}
.proj { display: inline-flex; align-items: center; gap: 4px; }
.proj .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--c); }
.meta-item { display: inline-flex; align-items: center; gap: 3px; font-variant-numeric: tabular-nums; }
.meta-item.warn { color: var(--warn); }
.meta-item.danger { color: var(--danger); font-weight: 600; }
.tag {
  font-size: 9.5px;
  color: var(--ink-2);
  background: var(--bg-soft);
  padding: 1px 5px;
  border-radius: 4px;
}

.entry-note {
  font-size: 11.5px;
  color: var(--ink-2);
  line-height: 1.55;
  margin-top: 5px;
  padding-left: 7px;
  border-left: 2px solid var(--line);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.subtasks { margin-top: 5px; display: flex; flex-direction: column; gap: 2px; }
.subtasks li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--ink-2);
}
.subtasks li.is-done { color: var(--muted); text-decoration: line-through; }
.sub-box {
  width: 9px;
  height: 9px;
  border-radius: 2.5px;
  border: 1.2px solid var(--line);
  flex: none;
}
.subtasks li.is-done .sub-box { background: var(--accent); border-color: var(--accent); }

.entry-atts { margin-top: 6px; }

.entry-actions {
  display: flex;
  flex-direction: column;
  gap: 1px;
  opacity: .32;
  transition: opacity .15s;
  flex: none;
}
.entry:hover .entry-actions,
.entry:focus-within .entry-actions { opacity: 1; }
.entry-actions .icon-btn { width: 24px; height: 24px; }

.summary-block { display: flex; flex-direction: column; gap: 7px; margin-top: 2px; }
.autosave { font-size: 10px; color: var(--faint); }
.summary-block textarea {
  font-size: 12.5px;
  line-height: 1.65;
  background: var(--panel-2);
  border-color: var(--line-soft);
  resize: vertical;
}

.drawer-foot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 20px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--line-soft);
  background: var(--panel);
}

.scrim-enter-active, .scrim-leave-active { transition: opacity .22s; }
.scrim-enter-from, .scrim-leave-to { opacity: 0; }

@media (max-width: 760px) {
  .drawer {
    width: 100%;
    top: 0;
    border-left: 0;
    transform: translateY(102%);
  }
  .drawer.is-open { transform: translateY(0); }
  .drawer-head { padding: 16px 14px 8px 16px; }
  .goal-strip { padding: 0 16px 10px; }
  .drawer-body { padding: 0 12px 12px 16px; }
  .entry-actions { opacity: 1; }
}
</style>
