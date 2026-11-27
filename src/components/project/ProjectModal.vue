<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Project, ProjectStatus } from '../../types.studio'
import Icon from '../base/Icon.vue'
import DateField from '../base/DateField.vue'
import DragNumber from '../base/DragNumber.vue'
import { PROJECT_COLORS } from '../../utils/color'
import { addProject, data, updateProject } from '../../stores/data'
import { toast } from '../../stores/ui'

const props = defineProps<{ project?: Project | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()

const name = ref(props.project?.name || '')
const color = ref(props.project?.color || PROJECT_COLORS[data.projects.length % PROJECT_COLORS.length])
const status = ref<ProjectStatus>(props.project?.status || 'active')
const note = ref(props.project?.note || '')
const weeklyTarget = ref(props.project?.weeklyTarget || 0)
const startDate = ref<string | null>(props.project?.startDate || null)
const dueDate = ref<string | null>(props.project?.dueDate || null)
const progress = ref(props.project?.progress || 0)
const nameEl = ref<HTMLInputElement | null>(null)
const saving = ref(false)

const isEdit = computed(() => !!props.project)

const statusOptions: { value: ProjectStatus; label: string }[] = [
  { value: 'active', label: '进行中' },
  { value: 'paused', label: '暂停' },
  { value: 'archived', label: '归档' },
]

onMounted(() => {
  window.setTimeout(() => nameEl.value?.focus(), 60)
})

async function save() {
  const n = name.value.trim()
  if (!n) {
    toast('给项目起个名字', 'warn')
    nameEl.value?.focus()
    return
  }
  saving.value = true
  try {
    if (props.project) {
      await updateProject(props.project.id, {
        name: n,
        color: color.value,
        status: status.value,
        note: note.value.trim(),
        weeklyTarget: Number(weeklyTarget.value) || 0,
        startDate: startDate.value,
        dueDate: dueDate.value,
        progress: progress.value,
      })
    } else {
      await addProject({
        name: n,
        color: color.value,
        status: status.value,
        note: note.value.trim(),
        weeklyTarget: Number(weeklyTarget.value) || 0,
        startDate: startDate.value,
        dueDate: dueDate.value,
        progress: progress.value,
      })
    }
    toast(isEdit.value ? '项目已更新' : '项目已创建', 'success')
    emit('saved')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="scrim" @click="emit('close')" />
    <div class="modal project-modal" role="dialog" aria-modal="true">
      <header class="pm-head">
        <div>
          <h2>{{ isEdit ? '编辑项目' : '新建项目' }}</h2>
          <p>项目用于归类工作内容，日历里靠颜色快速区分。</p>
        </div>
        <button class="icon-btn" @click="emit('close')">
          <Icon name="close" :size="17" />
        </button>
      </header>

      <div class="pm-body">
        <div class="field">
          <label>名称</label>
          <input
            ref="nameEl"
            v-model="name"
            type="text"
            maxlength="24"
            placeholder="例如：品牌设计 / 网站开发"
            @keydown.enter="save"
          />
        </div>

        <div class="field">
          <label>颜色</label>
          <div class="swatches">
            <button
              v-for="c in PROJECT_COLORS"
              :key="c"
              class="swatch"
              :class="{ 'is-on': color === c }"
              :style="{ background: c }"
              :title="c"
              @click="color = c"
            />
          </div>
        </div>

        <div class="field">
          <label>状态</label>
          <div class="seg">
            <button
              v-for="s in statusOptions"
              :key="s.value"
              :class="{ 'is-on': status === s.value }"
              @click="status = s.value"
            >{{ s.label }}</button>
          </div>
        </div>

        <div class="field">
          <label>时间安排</label>
          <div class="date-row">
            <DateField v-model="startDate" mode="start" placeholder="开始日" />
            <span class="arrow">→</span>
            <DateField v-model="dueDate" placeholder="截止日" />
          </div>
          <p class="field-hint">设了截止日，项目卡会显示剩余天数和超期提醒。</p>
        </div>

        <div class="field">
          <label>进度</label>
          <div class="slider-row">
            <DragNumber
              v-model="progress"
              :min="0"
              :max="100"
              :step="5"
              unit="%"
              :height="8"
              :presets="[0, 25, 50, 75, 100]"
              aria-label="项目进度"
            />
            <button v-if="progress < 100" type="button" class="mini-link" @click="progress = 100">标记完成</button>
          </div>
        </div>

        <div class="field">
          <label>每周目标工时</label>
          <div class="slider-row">
            <DragNumber
              v-model="weeklyTarget"
              :min="0"
              :max="60"
              :step="1"
              unit="h"
              :height="8"
              :presets="[0, 5, 10, 20, 30]"
              aria-label="每周目标工时"
            />
            <span class="field-hint inline">拖着调，0 表示不设目标</span>
          </div>
        </div>

        <div class="field">
          <label>备注</label>
          <textarea v-model="note" rows="2" placeholder="客户、交付节奏、注意事项…" />
        </div>
      </div>

      <footer class="pm-foot">
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn primary" :disabled="saving" @click="save">
          {{ isEdit ? '保存修改' : '创建项目' }}
        </button>
      </footer>
    </div>
  </Teleport>
</template>

<style scoped>
.modal.project-modal { width: min(480px, calc(100vw - 32px)); }
.pm-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 18px 18px 12px 20px;
}
.pm-head h2 { font-size: 16px; font-weight: 650; letter-spacing: -.02em; }
.pm-head p { font-size: 11.5px; color: var(--muted); margin-top: 3px; line-height: 1.5; }
.pm-head .icon-btn { margin-left: auto; }
.pm-body {
  padding: 4px 20px 8px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}
.pm-body input, .pm-body textarea { font-size: 13px; }

.swatches { display: flex; gap: 7px; flex-wrap: wrap; }
.swatch {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  position: relative;
  transition: transform .12s, box-shadow .12s;
}
.swatch:hover { transform: scale(1.08); }
.swatch.is-on { box-shadow: 0 0 0 2px var(--panel), 0 0 0 4px var(--ink); }
.swatch.is-on::after {
  content: "✓";
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  text-shadow: 0 1px 3px rgba(0, 0, 0, .35);
}

.date-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.date-row .arrow { color: var(--faint); font-size: 12px; }
.field-hint { font-size: 10.5px; color: var(--faint); line-height: 1.5; }
.field-hint.inline { font-size: 10px; }
.slider-row { display: flex; align-items: center; gap: 10px; }
.slider-row > :first-child { flex: 1; min-width: 0; }
.mini-link { flex: none; font-size: 10.5px; color: var(--accent); padding: 2px 6px; border-radius: 5px; }
.mini-link:hover { background: var(--accent-soft); }

.pm-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px 18px;
}
</style>
