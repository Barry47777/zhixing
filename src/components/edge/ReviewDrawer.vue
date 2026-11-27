<script setup lang="ts">
/** 复盘详情抽屉：事后 / 结果 / 把握 / 成长 / 错误归因，结构照搬 inspiration 的 .note-drawer */
import { computed, onMounted, ref } from 'vue'
import type { Note } from '../../types'
import { api } from '../../api'
import { app } from '../../stores/app'
import { toast } from '../../stores/ui'
import { clipText, esc, fmtDay, fmtPnl, pnlClass, relTime } from '../../utils/edge'
import LightBox from './LightBox.vue'

const props = defineProps<{ note: Note }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'edit', note: Note): void
  (e: 'changed', note: Note): void
  (e: 'goto', payload: { id: string; zone: string }): void
}>()

const note = ref<Note>({ ...props.note })
const refs = ref<{ id: string; seq: number; title: string; zone: string }[]>([])
const backrefs = ref<{ id: string; seq: number; title: string; zone: string }[]>([])
const afterText = ref(props.note.after?.text || '')
const resultNote = ref('')
const lightbox = ref<number | null>(null)
const busy = ref(false)
/** 进场动画：先挂在屏幕外，下一帧再加 .open，滑入效果才生效 */
const opened = ref(false)

const mistakes = computed(() => app.enums?.mistakes || [])
const images = computed(() => (note.value.images || []).filter((i) => i && i.url))
const trade = computed(() => note.value.trade || {})
const outcome = computed(() => note.value.result?.outcome || '')
const frozen = computed(() => Boolean(note.value.result && note.value.result.outcome))

const STAGE_LABEL: Record<string, string> = { idea: '想法', judgment: '判断', trade: '交易' }
const ZONE_TYPE: Record<string, string> = { review: '复盘', strategy: '策略', insight: '心得', idea: '灵感' }
const SIDES: Record<string, string> = { long: '做多', short: '做空', flat: '观望' }
const GROWTH: [string, string][] = [['up', '↑ 比过去强'], ['equal', '= 差不多'], ['down', '↓ 还不如']]
const OUTCOME: [string, string][] = [['right', '对'], ['wrong', '错'], ['unclear', '说不清']]

async function load() {
  try {
    const full: any = await api.notes.get(props.note.id)
    if (full?.note) note.value = full.note
    refs.value = full?.refs || []
    backrefs.value = full?.backrefs || []
    afterText.value = note.value.after?.text || ''
  } catch (_) { /* 用列表里的这份 */ }
}

onMounted(load)

function patchLocal(next: Note) {
  note.value = next
  emit('changed', next)
}

async function settle(value: string) {
  if (busy.value) return
  if (frozen.value && value !== outcome.value) {
    toast('已经结过结果了，改结果要写修订理由', 'warn')
    return
  }
  busy.value = true
  try {
    const res = await api.notes.result(note.value.id, {
      outcome: value,
      note: resultNote.value.trim() || undefined,
    })
    patchLocal(res.note)
    toast(value === 'right' ? '记下了：这次判断对了' : value === 'wrong' ? '记下了：这次判断错了' : '记下了：还说不清')
  } catch (err: any) {
    toast(err?.message || '结果没存上', 'error')
  } finally {
    busy.value = false
  }
}

async function saveAfter() {
  if (busy.value) return
  busy.value = true
  try {
    const res = await api.notes.after(note.value.id, afterText.value)
    patchLocal(res.note)
    toast('这段存下了', 'success')
  } catch (err: any) {
    toast(err?.message || '没存上', 'error')
  } finally {
    busy.value = false
  }
}

async function setGrowth(v: string) {
  try {
    const res = await api.notes.patch(note.value.id, { growth: v as any, growthAt: Date.now() })
    patchLocal(res.note)
  } catch (err: any) { toast(err?.message || '没改成功', 'error') }
}

async function setConf(v: number) {
  try {
    const res = await api.notes.patch(note.value.id, { bet: { ...(note.value.bet || {}), conf: v } })
    patchLocal(res.note)
  } catch (err: any) { toast(err?.message || '没改成功', 'error') }
}

async function setMistake(v: string) {
  try {
    const res = await api.notes.patch(note.value.id, { trade: { ...(note.value.trade || {}), mistake: v } })
    patchLocal(res.note)
  } catch (err: any) { toast(err?.message || '没改成功', 'error') }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (lightbox.value !== null) { lightbox.value = null; return }
    emit('close')
  }
}
onMounted(() => {
  window.setTimeout(() => { opened.value = true }, 30)
  window.addEventListener('keydown', onKey)
})
</script>

<template>
  <div class="note-drawer-mask" @click="emit('close')" />
  <aside class="note-drawer" :class="{ open: opened }" aria-label="记录详情">
    <div class="nd-head">
      <span class="nd-kind">
        #{{ note.seq }} · {{ STAGE_LABEL[note.stage || ''] || ZONE_TYPE[note.type] || '复盘' }}
        <template v-if="frozen"> · 已结</template>
      </span>
      <button class="nd-close" type="button" aria-label="关闭" @click="emit('close')">
        <svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>

    <div class="nd-body">
      <div v-if="note.content" class="nd-content" v-html="note.content" />
      <template v-else>
        <div v-if="note.seen" class="nd-text"><b>看到</b><p>{{ note.seen }}</p></div>
        <div v-if="note.think" class="nd-text"><b>想到</b><p>{{ note.think }}</p></div>
      </template>

      <div v-if="images.length" class="nd-sec">
        <h4>图</h4>
        <div class="nd-imgs">
          <button v-for="(img, idx) in images" :key="idx" class="ni" @click="lightbox = idx">
            <img :src="img.url" alt="" loading="lazy" />
          </button>
        </div>
      </div>

      <div class="nd-sec">
        <h4>事后</h4>
        <textarea
          v-model="afterText"
          class="nd-textarea"
          rows="4"
          placeholder="事后想想：哪里做对了、哪里错了、下次怎么做"
        />
        <div class="nd-chips">
          <button class="mini-btn text" :disabled="busy" @click="saveAfter">存下这段</button>
        </div>
      </div>

      <div class="nd-sec">
        <h4>结果</h4>
        <div class="nd-chips">
          <button
            v-for="[val, text] in OUTCOME"
            :key="val"
            class="q-chip"
            :class="{ on: outcome === val }"
            @click="settle(val)"
          >{{ text }}</button>
        </div>
        <div class="nd-chips" style="margin-top: 8px">
          <input v-model="resultNote" class="nd-input" placeholder="一句话说明（可选）" maxlength="200" />
        </div>
      </div>

      <div class="nd-sec">
        <h4>把握</h4>
        <div class="nd-chips">
          <button
            v-for="v in [1, 2, 3, 4, 5]"
            :key="v"
            class="q-chip"
            :class="{ on: Number(note.bet?.conf) === v }"
            @click="setConf(v)"
          >{{ v }}</button>
        </div>
      </div>

      <div class="nd-sec">
        <h4>成长</h4>
        <div class="nd-chips">
          <button
            v-for="[val, text] in GROWTH"
            :key="val"
            class="q-chip"
            :class="{ on: note.growth === val }"
            @click="setGrowth(val)"
          >{{ text }}</button>
        </div>
      </div>

      <div v-if="mistakes.length" class="nd-sec">
        <h4>错误归因</h4>
        <div class="nd-chips">
          <button
            v-for="m in mistakes"
            :key="m"
            class="q-chip"
            :class="{ on: trade.mistake === m }"
            @click="setMistake(m)"
          >{{ m }}</button>
        </div>
      </div>

      <details v-if="trade.symbol || trade.pnl != null || note.bet?.invalid" class="nd-more">
        <summary>当时写下的细节</summary>
        <div class="nd-rows">
          <div v-if="trade.symbol" class="nd-row"><span>标的</span><b>{{ trade.symbol }}</b></div>
          <div v-if="trade.side" class="nd-row"><span>方向</span><b>{{ SIDES[trade.side] }}</b></div>
          <div v-if="trade.qty != null" class="nd-row"><span>手数</span><b>{{ trade.qty }}</b></div>
          <div v-if="trade.entry != null" class="nd-row"><span>入场</span><b>{{ trade.entry }}</b></div>
          <div v-if="trade.stop != null" class="nd-row"><span>止损</span><b>{{ trade.stop }}</b></div>
          <div v-if="trade.target != null" class="nd-row"><span>目标</span><b>{{ trade.target }}</b></div>
          <div v-if="trade.pnl != null" class="nd-row"><span>盈亏</span><b :class="pnlClass(trade.pnl)">{{ fmtPnl(trade.pnl) }}</b></div>
          <div v-if="trade.rMultiple != null" class="nd-row"><span>R 倍数</span><b>R {{ trade.rMultiple }}</b></div>
          <div v-if="trade.rating" class="nd-row"><span>执行度</span><b>{{ '★'.repeat(trade.rating) }}{{ '☆'.repeat(5 - trade.rating) }}</b></div>
          <div v-if="note.bet?.invalid" class="nd-row"><span>失效条件</span><b>{{ note.bet.invalid }}</b></div>
        </div>
      </details>

      <div v-if="note.tags.length" class="nd-sec">
        <h4>标签</h4>
        <div class="nd-chips">
          <span v-for="t in note.tags" :key="t" class="note-tag">#{{ t }}</span>
        </div>
      </div>

      <div v-if="refs.length" class="nd-sec">
        <h4>引用</h4>
        <div class="nd-chips">
          <button
            v-for="r in refs"
            :key="r.id"
            class="ref-chip"
            :data-zone="r.zone"
            @click="emit('goto', { id: r.id, zone: r.zone })"
          ><i v-if="r.zone !== 'inspiration'" class="lk-zone">复盘</i>{{ clipText(r.title || String(r.seq), 24) }}</button>
        </div>
      </div>

      <div v-if="backrefs.length" class="nd-sec">
        <h4>被引用</h4>
        <div class="nd-chips">
          <button
            v-for="r in backrefs"
            :key="r.id"
            class="ref-chip"
            :data-zone="r.zone"
            @click="emit('goto', { id: r.id, zone: r.zone })"
          ><i v-if="r.zone !== 'inspiration'" class="lk-zone">复盘</i>{{ clipText(r.title || String(r.seq), 24) }}</button>
        </div>
      </div>

      <div class="nd-sec">
        <h4>变更</h4>
        <div class="nd-rows">
          <div class="nd-row"><span>建立</span><b>{{ fmtDay(note.createdAt) }}</b></div>
          <div class="nd-row"><span>最后改动</span><b>{{ fmtDay(note.updatedAt) }} · {{ relTime(note.updatedAt) }}</b></div>
          <div class="nd-row"><span>修订</span><b>{{ note.revisions.length ? `${note.revisions.length} 次` : '' }}</b></div>
        </div>
      </div>

      <div class="nd-sec">
        <div class="nd-chips">
          <button class="mini-btn text" @click="emit('edit', note)">编辑</button>
        </div>
      </div>
    </div>

    <LightBox v-if="lightbox !== null" :images="images" :index="lightbox" @close="lightbox = null" />
  </aside>
</template>
