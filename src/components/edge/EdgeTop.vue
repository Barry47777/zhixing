<script setup lang="ts">
/**
 * Edge 皮肤的顶栏：brand + 搜索 + 右侧按钮 + 分区切换（灵感 / 复盘）。
 * 结构和类名照搬 inspiration 的 .topbar / .zone-tabs，CSS 直接来自原皮肤文件。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { edgeTheme, setEdgeTheme } from '../../stores/edge'
import { lockNow } from '../../stores/auth'

const props = defineProps<{
  zone: 'inspiration' | 'review'
  query: string
  title?: string
}>()

const emit = defineEmits<{
  (e: 'update:query', v: string): void
  (e: 'base'): void
}>()

const router = useRouter()
const input = ref<HTMLInputElement | null>(null)

const brand = computed(() => props.title || (props.zone === 'inspiration' ? '灵感' : '复盘'))

function toggleTheme() {
  setEdgeTheme(edgeTheme.value === 'dark' ? 'light' : 'dark')
}

function focusSearch() {
  input.value?.focus()
}

defineExpose({ focusSearch })
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <span class="mark">◈</span>
      <div class="brand-text">
        <h1>{{ brand }}</h1>
      </div>
      <button class="back-work" type="button" title="回到工作日历（Esc 关闭当前层后再返回）" @click="router.push('/calendar')">
        <svg viewBox="0 0 24 24" class="ic" aria-hidden="true"><path d="m14 6-6 6 6 6" /><path d="M8 12h11" /></svg>
        <span>工作台</span>
      </button>
    </div>

    <div class="topbar-actions">
      <div class="search-wrap">
        <label class="search-label" for="search">搜索</label>
        <input
          id="search"
          ref="input"
          :value="query"
          type="search"
          placeholder="搜正文、标签…"
          autocomplete="off"
          spellcheck="false"
          @input="emit('update:query', ($event.target as HTMLInputElement).value)"
        />
        <kbd class="hint">/</kbd>
      </div>

      <button class="icon-btn" title="底线（不做清单）" aria-label="底线" @click="emit('base')">
        <svg viewBox="0 0 24 24" class="ic"><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h10" /></svg>
      </button>
      <button class="icon-btn" title="立即锁定，回到登录页" aria-label="立即锁定" @click="lockNow">
        <svg viewBox="0 0 24 24" class="ic"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /><path d="M12 14v3" /></svg>
      </button>
      <button class="icon-btn" title="切换主题" aria-label="切换主题" @click="toggleTheme">
        <svg v-if="edgeTheme === 'dark'" viewBox="0 0 24 24" class="ic"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
        <svg v-else viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" /></svg>
      </button>
      <button class="icon-btn io-btn" title="导入 / 导出" aria-label="导入导出" @click="router.push('/settings')">
        <svg viewBox="0 0 24 24" class="ic"><path d="M8 4v12" /><path d="m4.5 12.5 3.5 3.5 3.5-3.5" /><path d="M16 20V8" /><path d="m12.5 11.5 3.5-3.5 3.5 3.5" /></svg>
      </button>
    </div>
  </header>

  <div class="zone-tabs" :data-zone="zone" role="tablist" aria-label="分区">
    <span class="zone-pill" aria-hidden="true" />
    <button class="zone-tab" :class="{ on: zone === 'inspiration' }" role="tab" @click="router.push('/notes')">
      <b>灵感</b>
    </button>
    <button class="zone-tab" :class="{ on: zone === 'review' }" role="tab" @click="router.push('/review')">
      <b>复盘</b>
    </button>
  </div>
</template>

<style scoped>
.back-work {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: 14px;
  height: 28px;
  padding: 0 11px 0 8px;
  border: 1px solid var(--stroke);
  border-radius: 99px;
  background: rgba(255, 255, 255, .04);
  color: var(--text-dim);
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  transition: color .18s, border-color .18s, background .18s, transform .18s;
}
.back-work .ic { width: 14px; height: 14px; }
.back-work:hover {
  color: var(--text);
  border-color: var(--stroke-hi);
  background: rgba(167, 139, 250, .12);
  transform: translateX(-1px);
}
.back-work:active { transform: translateX(0) scale(.97); }
@media (max-width: 640px) {
  .back-work { margin-left: 8px; padding: 0 8px; }
  .back-work span { display: none; }
  /* 窄屏保留原版的三颗按钮；导入导出在工作区「设置与数据」里同样能进 */
  .io-btn { display: none; }
}
</style>
