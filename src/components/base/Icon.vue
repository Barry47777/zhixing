<script setup lang="ts">
import { computed } from 'vue';
import { ICONS, RAW_ICONS } from './icons';

const props = withDefaults(defineProps<{
  name: string
  size?: number | string
  /** Studio 原版组件传的是 stroke-width；知行侧栏等传的是 stroke，两者都认 */
  strokeWidth?: number
  stroke?: number
  fill?: boolean
}>(), {
  size: 18,
  strokeWidth: 1.7,
  stroke: undefined,
  fill: false,
});
const lineWidth = computed(() => props.stroke ?? props.strokeWidth);

/** 两套图标：知行原来的节点数组 + Studio Log 的原始 SVG 片段 */
const raw = computed(() => (ICONS[props.name] ? '' : RAW_ICONS[props.name] || ''));
const nodes = computed(() => ICONS[props.name] || ICONS.spark);
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    :stroke="fill ? 'none' : 'currentColor'"
    :stroke-width="lineWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="icon"
  >
    <g v-if="raw" v-html="raw" />
    <template v-else>
      <template v-for="(n, i) in nodes" :key="i">
        <path v-if="n.t === 'path'" :d="n.d" :fill="fill ? 'currentColor' : 'none'" />
        <circle v-else-if="n.t === 'circle'" :cx="n.cx" :cy="n.cy" :r="n.r" :fill="fill ? 'currentColor' : 'none'" />
        <line v-else-if="n.t === 'line'" :x1="n.x1" :y1="n.y1" :x2="n.x2" :y2="n.y2" />
        <rect v-else-if="n.t === 'rect'" :x="n.x" :y="n.y" :width="n.w" :height="n.h" :rx="n.rx || 0" :fill="fill ? 'currentColor' : 'none'" />
      </template>
    </template>
  </svg>
</template>

<style scoped>
.icon {
  flex: none;
  display: block;
}
</style>
