<script setup lang="ts">
/**
 * 灵感 / 复盘共用的富文本编辑器
 *
 * 几个必须做对的细节：
 *  - 工具栏按钮 mousedown.prevent，绝不抢走编辑器的选区
 *  - styleWithCSS：让 execCommand 输出 <span style>，否则服务端会把 <font> 拆掉、颜色丢失
 *  - 字号 / 对齐走块级样式（服务端白名单只收 font-size / color / text-align）
 *  - 颜色点直接内联上色，不再依赖 CSS 属性选择器
 *  - 记住最后一次光标位置，异步上传完图片也能插回原处
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

type BlockTag = 'P' | 'DIV' | 'H2' | 'H3' | 'BLOCKQUOTE' | 'LI'

interface EditorState {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  align: string
  list: string
  block: string
  color: string
  fontSize: number
}

const props = withDefaults(defineProps<{
  modelValue?: string
  placeholder?: string
  compact?: boolean
  minHeight?: number
  submitOnEnter?: boolean
  toolbar?: 'full' | 'minimal' | 'none'
}>(), {
  modelValue: '',
  placeholder: '写点什么…',
  compact: false,
  minHeight: 168,
  submitOnEnter: false,
  toolbar: 'full',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  attach: []
  'paste-images': [files: File[]]
}>()

const HTML_COLORS = [
  { value: '', label: '默认颜色', dot: 'linear-gradient(135deg, #eef1f8 0 50%, #171a24 50%)' },
  { value: '#ff8f8f', label: '浅红', dot: '#ff8f8f' },
  { value: '#ffcd6b', label: '琥珀', dot: '#ffcd6b' },
  { value: '#7fdca4', label: '青绿', dot: '#7fdca4' },
  { value: '#8fd8ff', label: '天蓝', dot: '#8fd8ff' },
  { value: '#c9b6ff', label: '淡紫', dot: '#c9b6ff' },
]

const el = ref<HTMLDivElement | null>(null)
const state = ref<EditorState>({
  bold: false, italic: false, underline: false, strike: false,
  align: 'left', list: '', block: 'P', color: '', fontSize: 0,
})
let savedRange: Range | null = null
let applying = false

const bodyStyle = computed(() => ({ minHeight: `${props.minHeight}px` }))

/* ------------------------------------------------------------ 选区 */

function insideEditor(node: Node | null): boolean {
  return !!node && !!el.value && (node === el.value || el.value.contains(node))
}

function saveRange() {
  const sel = window.getSelection()
  if (sel?.rangeCount && insideEditor(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange()
}

function restoreRange() {
  const sel = window.getSelection()
  if (!sel) return
  if (savedRange && insideEditor(savedRange.commonAncestorContainer)) {
    sel.removeAllRanges()
    sel.addRange(savedRange)
    return
  }
  if (!el.value) return
  el.value.focus()
  const r = document.createRange()
  r.selectNodeContents(el.value)
  r.collapse(false)
  sel.removeAllRanges()
  sel.addRange(r)
}

function ensureFocus() {
  if (!el.value) return false
  if (!insideEditor(document.activeElement)) restoreRange()
  else if (!document.activeElement) el.value.focus()
  return true
}

/* ------------------------------------------------------------ 同步 */

function html(): string {
  return el.value?.innerHTML || ''
}

function onInput() {
  saveRange()
  if (!applying) emit('update:modelValue', html())
  syncState()
}

function setHtml(value: string) {
  if (!el.value || applying) return
  if (el.value.innerHTML === (value || '')) return
  applying = true
  el.value.innerHTML = value || ''
  applying = false
  savedRange = null
  nextTick(syncState)
}

/** 外部异步上传完图片后调用：插回最后的光标处 */
function insertImage(url: string) {
  if (!el.value) return
  restoreRange()
  document.execCommand('insertHTML', false, `<p><img src="${url}" alt="" /></p>`)
  emit('update:modelValue', html())
  saveRange()
  syncState()
}

function focus() {
  restoreRange()
  el.value?.focus()
}

function clear() {
  if (!el.value) return
  el.value.innerHTML = ''
  savedRange = null
  emit('update:modelValue', '')
  syncState()
}

defineExpose({ focus, setHtml, getHtml: html, insertImage, clear, saveRange })

/* ------------------------------------------------------------ 命令 */

function exec(cmd: string, value?: string) {
  if (!ensureFocus()) return
  document.execCommand('styleWithCSS', false, 'true')
  document.execCommand(cmd, false, value)
  emit('update:modelValue', html())
  saveRange()
  syncState()
}

function selectedBlocks(): HTMLElement[] {
  const root = el.value
  const sel = window.getSelection()
  if (!root || !sel?.rangeCount) return []
  const range = sel.getRangeAt(0)
  const found = new Set<HTMLElement>()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const nodeEl = node as HTMLElement
      const tag = nodeEl.tagName as BlockTag
      if (['P', 'DIV', 'H2', 'H3', 'BLOCKQUOTE', 'LI'].includes(tag) && range.intersectsNode(nodeEl)) {
        found.add(nodeEl)
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  while (walker.nextNode()) { /* 遍历收集 */ }
  return [...found]
}

function anchorBlock(): HTMLElement | null {
  const sel = window.getSelection()
  if (!sel?.anchorNode) return null
  const node = sel.anchorNode.nodeType === Node.ELEMENT_NODE
    ? sel.anchorNode as HTMLElement
    : sel.anchorNode.parentElement
  return node?.closest('p, div, h2, h3, blockquote, li') as HTMLElement | null
}

function setFontSize(px: number) {
  if (!ensureFocus()) return
  const blocks = selectedBlocks()
  const targets = blocks.length ? blocks : ([anchorBlock()].filter(Boolean) as HTMLElement[])
  targets.forEach((block) => { block.style.fontSize = px ? `${px}px` : '' })
  emit('update:modelValue', html())
  saveRange()
  syncState()
}

function stepFontSize(delta: number) {
  const cur = state.value.fontSize || 17
  const next = Math.max(13, Math.min(24, cur + delta * 3))
  setFontSize(next === 17 ? 0 : next)
}

function setColor(color: string) {
  if (!ensureFocus()) return
  document.execCommand('styleWithCSS', false, 'true')
  if (!color) {
    // 「默认色」写成当前正文色，避免浏览器生成会被服务端剥掉的 <font>
    const rootColor = getComputedStyle(el.value as HTMLElement).color
    document.execCommand('foreColor', false, rootColor)
  } else {
    document.execCommand('foreColor', false, color)
  }
  emit('update:modelValue', html())
  saveRange()
  syncState()
}

function formatBlock(tag: string) {
  if (!ensureFocus()) return
  document.execCommand('styleWithCSS', false, 'true')
  const current = state.value.block.toLowerCase()
  document.execCommand('formatBlock', false, current === tag.toLowerCase() ? 'p' : tag)
  emit('update:modelValue', html())
  saveRange()
  syncState()
}

function clearFormat() {
  if (!ensureFocus()) return
  document.execCommand('removeFormat')
  if (['H2', 'H3', 'BLOCKQUOTE'].includes(state.value.block)) {
    document.execCommand('formatBlock', false, 'p')
  }
  selectedBlocks().forEach((block) => {
    block.style.fontSize = ''
    block.style.textAlign = ''
  })
  emit('update:modelValue', html())
  saveRange()
  syncState()
}

/* ------------------------------------------------------------ 状态 */

function query(cmd: string): boolean {
  try { return document.queryCommandState(cmd) } catch { return false }
}

function syncState() {
  const block = anchorBlock()
  const style = block ? getComputedStyle(block) : null
  const sel = window.getSelection()
  let color = ''
  let node = sel?.anchorNode?.nodeType === Node.ELEMENT_NODE
    ? sel.anchorNode as HTMLElement
    : sel?.anchorNode?.parentElement || null
  while (node && node !== el.value) {
    if (node instanceof HTMLElement && node.style.color) { color = node.style.color; break }
    node = node.parentElement
  }
  const fontSize = style ? Math.round(parseFloat(style.fontSize) || 0) : 0
  state.value = {
    bold: query('bold'),
    italic: query('italic'),
    underline: query('underline'),
    strike: query('strikeThrough'),
    align: block?.style.textAlign || 'left',
    list: query('insertUnorderedList') ? 'ul' : query('insertOrderedList') ? 'ol' : '',
    block: block?.tagName || 'P',
    color,
    fontSize: fontSize === 17 ? 0 : fontSize,
  }
}

function onSelectionChange() {
  if (insideEditor(document.activeElement) || insideEditor(window.getSelection()?.anchorNode || null)) syncState()
}

/* ------------------------------------------------------------ 事件 */

function onKeydown(e: KeyboardEvent) {
  if (props.submitOnEnter && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault()
    emit('submit')
    return
  }
  if (e.key === 'Tab') {
    e.preventDefault()
    document.execCommand('insertText', false, '  ')
    onInput()
  }
  saveRange()
}

function onPaste(e: ClipboardEvent) {
  const files = Array.from(e.clipboardData?.files || [])
  if (files.some((f) => f.type.startsWith('image/'))) {
    e.preventDefault()
    emit('paste-images', files)
    return
  }
  // 纯文本粘贴：去掉外部网页的标签和样式，只留文字
  const text = e.clipboardData?.getData('text/plain')
  if (text) {
    e.preventDefault()
    document.execCommand('insertText', false, text)
    onInput()
  }
}

function onFocus() {
  document.execCommand('styleWithCSS', false, 'true')
  saveRange()
  syncState()
}

watch(() => props.modelValue, (v) => setHtml(v))

onMounted(() => {
  if (el.value) el.value.innerHTML = props.modelValue || ''
  document.addEventListener('selectionchange', onSelectionChange)
  nextTick(syncState)
})

onBeforeUnmount(() => document.removeEventListener('selectionchange', onSelectionChange))
</script>

<template>
  <div class="rich-editor" :class="{ 're-compact': compact }">
    <div v-if="toolbar !== 'none'" class="re-toolbar" role="toolbar" aria-label="文字格式">
      <div class="re-group" role="group" aria-label="字号">
        <button class="ed-btn" type="button" title="字号小一点" @mousedown.prevent @click="stepFontSize(-1)">A-</button>
        <button class="ed-btn" type="button" title="字号大一点" @mousedown.prevent @click="stepFontSize(1)">A+</button>
      </div>
      <span class="ed-sep" aria-hidden="true" />
      <div class="re-group" role="group" aria-label="字形">
        <button class="ed-btn" :class="{ on: state.bold }" type="button" title="加粗 Ctrl+B" @mousedown.prevent @click="exec('bold')"><b>B</b></button>
        <button class="ed-btn" :class="{ on: state.italic }" type="button" title="斜体 Ctrl+I" @mousedown.prevent @click="exec('italic')"><i>I</i></button>
        <button class="ed-btn" :class="{ on: state.underline }" type="button" title="下划线 Ctrl+U" @mousedown.prevent @click="exec('underline')"><u>U</u></button>
        <button class="ed-btn" :class="{ on: state.strike }" type="button" title="删除线" @mousedown.prevent @click="exec('strikeThrough')"><s>S</s></button>
      </div>
      <span class="ed-sep" aria-hidden="true" />
      <div class="re-group re-colors" role="group" aria-label="文字颜色">
        <button
          v-for="c in HTML_COLORS"
          :key="c.label"
          class="ed-dot"
          :class="{ on: state.color === c.value || (!c.value && !state.color) }"
          type="button"
          :title="c.label"
          :data-color="c.value"
          :style="{ background: c.dot, color: c.dot }"
          @mousedown.prevent
          @click="setColor(c.value)"
        />
      </div>
      <span class="ed-sep" aria-hidden="true" />
      <div class="re-group" role="group" aria-label="对齐与列表">
        <button class="ed-btn" :class="{ on: state.align === 'left' || !state.align }" type="button" title="左对齐" @mousedown.prevent @click="exec('justifyLeft')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 10h10M4 14h16M4 18h10" /></svg>
        </button>
        <button class="ed-btn" :class="{ on: state.align === 'center' }" type="button" title="居中" @mousedown.prevent @click="exec('justifyCenter')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 10h10M4 14h16M7 18h10" /></svg>
        </button>
        <button class="ed-btn" :class="{ on: state.align === 'right' }" type="button" title="右对齐" @mousedown.prevent @click="exec('justifyRight')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M10 10h10M4 14h16M10 18h10" /></svg>
        </button>
        <button class="ed-btn" :class="{ on: state.list === 'ul' }" type="button" title="项目符号" @mousedown.prevent @click="exec('insertUnorderedList')">•</button>
        <button class="ed-btn" :class="{ on: state.list === 'ol' }" type="button" title="编号列表" @mousedown.prevent @click="exec('insertOrderedList')">1.</button>
      </div>
      <span v-if="toolbar === 'full'" class="ed-sep" aria-hidden="true" />
      <div v-if="toolbar === 'full'" class="re-group" role="group" aria-label="段落结构">
        <button class="ed-btn" :class="{ on: state.block === 'H2' }" type="button" title="小标题" @mousedown.prevent @click="formatBlock('h2')">H</button>
        <button class="ed-btn" :class="{ on: state.block === 'BLOCKQUOTE' }" type="button" title="引用" @mousedown.prevent @click="formatBlock('blockquote')">❝</button>
      </div>
      <span v-if="toolbar === 'full'" class="ed-sep" aria-hidden="true" />
      <div v-if="toolbar === 'full'" class="re-group" role="group" aria-label="编辑历史">
        <button class="ed-btn" type="button" title="撤销 Ctrl+Z" @mousedown.prevent @click="exec('undo')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
        </button>
        <button class="ed-btn" type="button" title="重做 Ctrl+Y" @mousedown.prevent @click="exec('redo')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
        </button>
        <button class="ed-btn" type="button" title="清除格式" @mousedown.prevent @click="clearFormat">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16.5 12.5 8l4 4L8 20.5H4z" /><path d="m10 10 4 4" /><path d="M14 5h6" /></svg>
        </button>
        <button class="ed-btn" type="button" title="插入图片（也可 Ctrl+V 粘贴）" @mousedown.prevent @click="emit('attach')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="3" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="m4 17 5-5 4.5 4.5L17 13l3.5 3.5" /></svg>
        </button>
      </div>
    </div>

    <div
      ref="el"
      class="ed-body re-body"
      :class="{ 're-mini': compact }"
      :style="bodyStyle"
      contenteditable="true"
      role="textbox"
      aria-multiline="true"
      :data-placeholder="placeholder"
      spellcheck="false"
      @input="onInput"
      @keydown="onKeydown"
      @paste="onPaste"
      @mouseup="saveRange"
      @keyup="saveRange"
      @focus="onFocus"
    />
  </div>
</template>

<style scoped>
.rich-editor {
  border-radius: 10px;
  overflow: hidden;
}
.re-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  padding: 7px 9px;
  border-bottom: 1px solid var(--stroke, rgba(255, 255, 255, .08));
  background: linear-gradient(180deg, rgba(255, 255, 255, .035), transparent);
}
.re-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.re-colors { gap: 6px; padding: 0 3px; }
.re-toolbar :deep(.ed-btn) {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--text-dim, #9aa0b4);
  font: 500 12.5px/1 var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  min-width: 28px;
  height: 27px;
  padding: 0 6px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background .14s ease, color .14s ease;
}
.re-toolbar :deep(.ed-btn:hover) { background: rgba(255, 255, 255, .07); color: var(--text, #eef1f8); }
.re-toolbar :deep(.ed-btn.on) { background: rgba(159, 228, 255, .16); color: #9fe4ff; }
.re-toolbar :deep(.ed-btn b) { font-weight: 700; }
.re-toolbar :deep(.ed-btn i) { font-style: italic; }
.re-toolbar :deep(.ed-btn u) { text-decoration: underline; }
.re-toolbar :deep(.ed-btn s) { text-decoration: line-through; }
.re-toolbar :deep(.ed-btn svg) {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.re-toolbar :deep(.ed-sep) {
  width: 1px;
  height: 17px;
  margin: 0 3px;
  background: var(--stroke, rgba(255, 255, 255, .1));
}
.re-toolbar :deep(.ed-dot) {
  appearance: none;
  width: 15px;
  height: 15px;
  min-width: 15px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, .28);
  border-radius: 50%;
  cursor: pointer;
  transition: transform .14s ease;
}
.re-toolbar :deep(.ed-dot:hover) { transform: scale(1.15); }
.re-toolbar :deep(.ed-dot.on) {
  box-shadow: 0 0 0 2px var(--bg, #08070d), 0 0 0 3px currentColor;
}
.re-body {
  outline: none;
  overflow-y: auto;
  max-height: 60vh;
  font-size: 17px;
  line-height: 1.75;
  color: var(--text, #eef1f8);
  word-break: break-word;
}
.re-body.re-mini { font-size: 15px; line-height: 1.65; padding: 12px 14px 14px; }
.re-body :deep(p) { margin: 0 0 .55em; }
.re-body :deep(p:last-child) { margin-bottom: 0; }
.re-body :deep(ul), .re-body :deep(ol) { margin: .35em 0 .6em; padding-left: 1.3em; }
.re-body :deep(li) { margin: .15em 0; }
.re-body :deep(h2) { font-size: 1.35em; font-weight: 700; margin: .6em 0 .4em; }
.re-body :deep(blockquote) {
  margin: .5em 0;
  padding: 2px 0 2px 12px;
  border-left: 2px solid rgba(159, 228, 255, .5);
  color: var(--text-dim, #9aa0b4);
}
.re-body :deep(img) {
  max-width: 100%;
  border-radius: 10px;
  margin: 10px 0;
  display: block;
  box-shadow: 0 6px 22px rgba(0, 0, 0, .28);
}
.re-body[data-placeholder]:empty::before {
  content: attr(data-placeholder);
  color: var(--text-mute, #6b7288);
  pointer-events: none;
}
.re-body:has(> p:only-child:empty)::before {
  content: attr(data-placeholder);
  color: var(--text-mute, #6b7288);
  pointer-events: none;
}
</style>
