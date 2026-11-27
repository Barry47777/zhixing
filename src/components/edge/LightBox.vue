<script setup lang="ts">
/** 看大图：结构与类名照搬 inspiration 的 .lightbox */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{ images: { url: string }[]; index: number }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const cur = ref(props.index)
const img = computed(() => props.images[cur.value] || props.images[0])

function step(d: number) {
  const n = props.images.length
  if (!n) return
  cur.value = (cur.value + d + n) % n
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  if (e.key === 'ArrowLeft') step(-1)
  if (e.key === 'ArrowRight') step(1)
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="lightbox" @click.self="emit('close')">
    <button class="lb-close" aria-label="关闭" @click="emit('close')">
      <svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
    <button v-if="images.length > 1" class="lb-nav prev" aria-label="上一张" @click="step(-1)">
      <svg viewBox="0 0 24 24" class="ic"><path d="m14 6-6 6 6 6" /></svg>
    </button>
    <figure class="lb-stage" @click.stop>
      <img id="lbImg" :src="img?.url" alt="" />
      <figcaption id="lbCap">{{ images.length > 1 ? `${cur + 1} / ${images.length}` : '' }}</figcaption>
    </figure>
    <button v-if="images.length > 1" class="lb-nav next" aria-label="下一张" @click="step(1)">
      <svg viewBox="0 0 24 24" class="ic"><path d="m10 6 6 6-6 6" /></svg>
    </button>
  </div>
</template>
