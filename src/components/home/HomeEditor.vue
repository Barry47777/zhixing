<script setup lang="ts">
import { ref } from 'vue';
import Icon from '../base/Icon.vue';
import { data } from '../../stores/data';
import { confirmDialog, toast } from '../../stores/ui';
import {
  MODULE_LIBRARY, QUICK_ACTIONS, addHomeModule, exportHomeConfig, importHomeConfig,
  home, moveHomeModule, moveHomeModuleBy, removeHomeModule, resetHomeConfig,
  setHomeCompact, setHomeEditing, setHomeMode, toggleHomeModule,
  duplicateHomeModule, updateHomeModule, updateHomeModuleOptions,
  type HomeModule, type HomeSpan,
} from '../../stores/home';

const dragId = ref('');
const dropTarget = ref('');
const dropSide = ref<'before' | 'after'>('before');

const spans: HomeSpan[] = [4, 6, 8, 12];

function spanLabel(span: HomeSpan): string {
  return ({ 4: '1/3', 6: '1/2', 8: '2/3', 12: '全宽' } as Record<HomeSpan, string>)[span];
}

function close(): void {
  setHomeEditing(false);
}

function onTitleInput(id: string, e: Event): void {
  updateHomeModule(id, { title: (e.target as HTMLInputElement).value });
}

function onLimitInput(id: string, e: Event): void {
  const n = Number((e.target as HTMLInputElement).value);
  updateHomeModuleOptions(id, { limit: Math.max(1, Math.min(30, n || 1)) });
}

function onSelect(id: string, key: 'filter' | 'zone' | 'projectId', e: Event): void {
  updateHomeModuleOptions(id, { [key]: (e.target as HTMLSelectElement).value });
}

function onTextarea(id: string, e: Event): void {
  updateHomeModuleOptions(id, { text: (e.target as HTMLTextAreaElement).value });
}

function onShowWeek(id: string, e: Event): void {
  updateHomeModuleOptions(id, { showWeek: !!(e.target as HTMLInputElement).checked });
}

function toggleAction(mod: HomeModule, key: string): void {
  const current = mod.options.actions || [];
  const next = current.includes(key) ? current.filter((a) => a !== key) : [...current, key];
  updateHomeModuleOptions(mod.id, { actions: next });
}

function onDragStart(e: DragEvent, id: string): void {
  dragId.value = id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }
}

function onDragOver(e: DragEvent, id: string): void {
  if (!dragId.value || dragId.value === id) return;
  e.preventDefault();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dropSide.value = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
  dropTarget.value = id;
}

function onDrop(e: DragEvent, id: string): void {
  e.preventDefault();
  const from = dragId.value || e.dataTransfer?.getData('text/plain');
  if (from && from !== id) moveHomeModule(from, id, dropSide.value);
  clearDrag();
}

function clearDrag(): void {
  dragId.value = '';
  dropTarget.value = '';
  dropSide.value = 'before';
}

async function onReset(): Promise<void> {
  const res = await confirmDialog({
    title: '恢复默认首页？',
    message: '模块顺序、标题和内容设置都会回到初始状态。',
    confirmText: '恢复默认',
    danger: true,
  });
  if (!res.ok) return;
  resetHomeConfig();
  toast('首页布局已恢复默认', 'success');
}

function onExport(): void {
  const blob = new Blob([exportHomeConfig()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '知行首页布局.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('布局已导出', 'success');
}

async function onImport(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const ok = importHomeConfig(await file.text());
    toast(ok ? '布局已导入' : '这个文件不是有效的首页布局', ok ? 'success' : 'error');
  } catch (_) {
    toast('布局读取失败', 'error');
  } finally {
    input.value = '';
  }
}
</script>

<template>
  <div class="home-editor" @keydown.esc="close">
    <div class="editor-mask" @click="close" />

    <aside class="editor-panel">
      <header class="editor-head">
        <div class="eh-copy">
          <span class="eh-kicker">HOME BUILDER</span>
          <h2>定制首页</h2>
          <p>拖动排序、改名、换宽度、改内容。改动会保存在这台设备上。</p>
        </div>
        <button class="icon-btn" title="完成" @click="close"><Icon name="close" :size="17" /></button>
      </header>

      <div class="editor-body">
        <section class="editor-section">
          <div class="section-head">
            <h3>布局方式</h3>
            <span>当前 {{ home.modules.length }} 个模块</span>
          </div>
          <div class="mode-row">
            <button class="mode-btn" :class="{ on: home.mode === 'grid' }" @click="setHomeMode('grid')">
              <Icon name="grid" :size="15" /><span>自适应网格</span>
            </button>
            <button class="mode-btn" :class="{ on: home.mode === 'list' }" @click="setHomeMode('list')">
              <Icon name="list" :size="15" /><span>单列长页</span>
            </button>
            <button class="mode-btn" :class="{ on: home.compact }" @click="setHomeCompact(!home.compact)">
              <Icon name="layout" :size="15" /><span>紧凑间距</span>
            </button>
          </div>
        </section>

        <section class="editor-section">
          <div class="section-head"><h3>已有模块</h3><span>拖动左侧手柄排序</span></div>

          <div class="module-list">
            <div
              v-for="mod in home.modules"
              :key="mod.id"
              class="edit-module"
              :class="{ 'is-off': !mod.enabled, 'is-drag': dragId === mod.id, 'drop-before': dropTarget === mod.id && dropSide === 'before', 'drop-after': dropTarget === mod.id && dropSide === 'after' }"
              @dragover="onDragOver($event, mod.id)"
              @drop="onDrop($event, mod.id)"
              @dragend="clearDrag"
            >
              <button
                class="em-handle"
                draggable="true"
                title="拖动排序"
                @dragstart="onDragStart($event, mod.id)"
              ><Icon name="drag" :size="15" /></button>

              <div class="em-main">
                <input class="em-title" :value="mod.title" maxlength="24" placeholder="模块名称" @input="onTitleInput(mod.id, $event)" />
                <div class="em-meta">
                  <span>{{ MODULE_LIBRARY.find((m) => m.type === mod.type)?.label || mod.type }}</span>
                  <i />
                  <span>{{ spanLabel(mod.span) }}宽</span>
                </div>

                <div class="em-spans">
                  <button
                    v-for="s in spans"
                    :key="s"
                    :class="{ on: mod.span === s }"
                    @click="updateHomeModule(mod.id, { span: s })"
                  >{{ spanLabel(s) }}</button>
                </div>

                <div v-if="mod.type === 'entries'" class="em-options">
                  <label>状态
                    <select :value="mod.options.filter || 'all'" @change="onSelect(mod.id, 'filter', $event)">
                      <option value="all">全部</option><option value="done">已完成</option>
                      <option value="doing">进行中</option><option value="blocked">受阻</option>
                    </select>
                  </label>
                  <label>项目
                    <select :value="mod.options.projectId || ''" @change="onSelect(mod.id, 'projectId', $event)">
                      <option value="">全部项目</option>
                      <option v-for="p in data.projects.filter((p) => p.status !== 'archived')" :key="p.id" :value="p.id">{{ p.name }}</option>
                    </select>
                  </label>
                  <label>条数 <input type="number" min="1" max="30" :value="mod.options.limit || 20" @input="onLimitInput(mod.id, $event)" /></label>
                </div>

                <div v-else-if="mod.type === 'notes'" class="em-options">
                  <label>分区
                    <select :value="mod.options.zone || 'all'" @change="onSelect(mod.id, 'zone', $event)">
                      <option value="all">全部</option><option value="inspiration">灵感</option><option value="review">心得</option>
                    </select>
                  </label>
                  <label>条数 <input type="number" min="1" max="30" :value="mod.options.limit || 4" @input="onLimitInput(mod.id, $event)" /></label>
                </div>

                <div v-else-if="mod.type === 'projects' || mod.type === 'tags'" class="em-options">
                  <label>条数 <input type="number" min="1" max="30" :value="mod.options.limit || 8" @input="onLimitInput(mod.id, $event)" /></label>
                </div>

                <div v-else-if="mod.type === 'hero'" class="em-options">
                  <label class="check-line"><input type="checkbox" :checked="mod.options.showWeek !== false" @change="onShowWeek(mod.id, $event)" /> 同时显示本周节奏</label>
                </div>

                <div v-else-if="mod.type === 'quick'" class="em-options quick-options">
                  <label v-for="action in QUICK_ACTIONS" :key="action.key" class="check-line">
                    <input type="checkbox" :checked="(mod.options.actions || []).includes(action.key)" @change="toggleAction(mod, action.key)" />
                    {{ action.label }}
                  </label>
                </div>

                <div v-else-if="mod.type === 'note'" class="em-options">
                  <textarea rows="3" placeholder="写一句给自己看的提示…" :value="mod.options.text || ''" @input="onTextarea(mod.id, $event)" />
                </div>
              </div>

              <div class="em-actions">
                <button title="上移" :disabled="home.modules[0]?.id === mod.id" @click="moveHomeModuleBy(mod.id, -1)"><Icon name="up" :size="14" /></button>
                <button title="下移" :disabled="home.modules[home.modules.length - 1]?.id === mod.id" @click="moveHomeModuleBy(mod.id, 1)"><Icon name="down" :size="14" /></button>
                <button :title="mod.enabled ? '暂时隐藏' : '显示模块'" @click="toggleHomeModule(mod.id)"><Icon :name="mod.enabled ? 'eye' : 'close'" :size="14" /></button>
                <button title="复制模块" @click="duplicateHomeModule(mod.id)"><Icon name="copy" :size="14" /></button>
                <button class="danger" title="删除模块" @click="removeHomeModule(mod.id)"><Icon name="trash" :size="14" /></button>
              </div>
            </div>
          </div>
        </section>

        <section class="editor-section">
          <div class="section-head"><h3>添加模块</h3><span>同类模块可以放多个，用不同筛选</span></div>
          <div class="library">
            <button v-for="item in MODULE_LIBRARY" :key="item.type" class="library-item" @click="addHomeModule(item.type)">
              <span class="lib-icon"><Icon :name="item.icon" :size="16" /></span>
              <span class="lib-copy"><strong>{{ item.label }}</strong><small>{{ item.desc }}</small></span>
              <Icon name="plus" :size="15" class="lib-plus" />
            </button>
          </div>
        </section>
      </div>

      <footer class="editor-foot">
        <button class="btn ghost sm" @click="onReset"><Icon name="restore" :size="14" /> 恢复默认</button>
        <button class="btn ghost sm" @click="onExport"><Icon name="download" :size="14" /> 导出</button>
        <label class="btn ghost sm import-btn"><Icon name="upload" :size="14" /> 导入<input type="file" accept="application/json,.json" @change="onImport" /></label>
        <button class="btn primary sm" @click="close"><Icon name="check" :size="14" /> 完成</button>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.home-editor { position: fixed; inset: 0; z-index: 200; }
.editor-mask { position: absolute; inset: 0; background: rgba(12, 14, 18, .36); backdrop-filter: blur(2px); }
.editor-panel {
  position: absolute; top: 0; right: 0; bottom: 0;
  width: min(520px, 100vw);
  display: flex; flex-direction: column;
  background: var(--panel);
  border-left: 1px solid var(--line);
  box-shadow: var(--shadow-lg);
}
.editor-head {
  flex: none; display: flex; align-items: flex-start; gap: 12px;
  padding: 20px 22px 16px; border-bottom: 1px solid var(--line-soft);
}
.eh-copy { flex: 1; min-width: 0; }
.eh-kicker { font-size: 9.5px; font-weight: 700; letter-spacing: .16em; color: var(--accent); }
.editor-head h2 { margin: 4px 0 5px; font-size: 18px; font-weight: 660; letter-spacing: -.02em; }
.editor-head p { font-size: 11.5px; line-height: 1.6; color: var(--muted); }
.icon-btn { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; color: var(--muted); }
.icon-btn:hover { background: var(--bg-soft); color: var(--ink); }

.editor-body { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 22px 24px; display: flex; flex-direction: column; gap: 24px; }
.editor-section { display: flex; flex-direction: column; gap: 10px; }
.section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.section-head h3 { font-size: 12.5px; font-weight: 650; }
.section-head span { font-size: 10.5px; color: var(--faint); }

.mode-row { display: flex; flex-wrap: wrap; gap: 6px; }
.mode-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 10px; border-radius: 8px;
  border: 1px solid var(--line); font-size: 11.5px; color: var(--muted);
}
.mode-btn:hover { border-color: var(--accent); color: var(--accent); }
.mode-btn.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 600; }

.module-list { display: flex; flex-direction: column; gap: 8px; }
.edit-module {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px; border: 1px solid var(--line); border-radius: 11px;
  background: var(--panel-2);
  transition: opacity .15s, border-color .15s, box-shadow .15s;
}
.edit-module.is-off { opacity: .55; }
.edit-module.is-drag { opacity: .4; }
.edit-module.drop-before { box-shadow: -3px 0 0 var(--accent); }
.edit-module.drop-after { box-shadow: 3px 0 0 var(--accent); }
.em-handle { flex: none; width: 24px; height: 28px; display: grid; place-items: center; color: var(--faint); cursor: grab; }
.em-handle:active { cursor: grabbing; }
.em-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.em-title {
  width: 100%; height: 27px; padding: 0 8px; border-radius: 7px;
  border: 1px solid transparent; background: transparent;
  font-size: 12.5px; font-weight: 600; color: var(--ink);
}
.em-title:hover, .em-title:focus { border-color: var(--line); background: var(--panel); outline: none; }
.em-meta { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--faint); }
.em-meta i { width: 2px; height: 2px; border-radius: 50%; background: var(--line); }
.em-spans { display: flex; gap: 4px; }
.em-spans button {
  height: 22px; padding: 0 7px; border-radius: 6px;
  font-size: 10px; color: var(--muted); background: var(--panel); border: 1px solid var(--line-soft);
}
.em-spans button:hover { color: var(--accent); border-color: var(--accent); }
.em-spans button.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.em-options { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding-top: 2px; }
.em-options label { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; color: var(--muted); }
.em-options select, .em-options input[type="number"] {
  height: 25px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--panel); color: var(--ink); font-size: 11px; padding: 0 6px;
}
.em-options input[type="number"] { width: 54px; }
.em-options textarea {
  width: 100%; border: 1px solid var(--line); border-radius: 7px;
  background: var(--panel); font-size: 11.5px; line-height: 1.6; padding: 7px 8px; resize: vertical;
}
.check-line { cursor: pointer; }
.check-line input { accent-color: var(--accent); }
.quick-options { gap: 6px 12px; }
.em-actions { flex: none; display: flex; flex-direction: column; gap: 3px; }
.em-actions button {
  width: 25px; height: 23px; display: grid; place-items: center;
  border-radius: 6px; color: var(--muted);
}
.em-actions button:hover:not(:disabled) { background: var(--bg-soft); color: var(--ink); }
.em-actions button.danger:hover { color: var(--danger); background: var(--danger-soft); }
.em-actions button:disabled { opacity: .3; cursor: default; }

.library { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.library-item {
  display: flex; align-items: center; gap: 8px; text-align: left;
  padding: 9px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel-2);
}
.library-item:hover { border-color: var(--accent); background: var(--accent-soft); }
.lib-icon { width: 28px; height: 28px; flex: none; display: grid; place-items: center; border-radius: 8px; background: var(--panel); color: var(--accent); }
.lib-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.lib-copy strong { font-size: 11.5px; font-weight: 600; }
.lib-copy small { font-size: 9.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lib-plus { color: var(--faint); flex: none; }

.editor-foot {
  flex: none; display: flex; align-items: center; gap: 6px;
  padding: 13px 22px; border-top: 1px solid var(--line-soft); background: var(--panel-2);
}
.editor-foot .primary { margin-left: auto; }
.import-btn { position: relative; overflow: hidden; }
.import-btn input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }

@media (max-width: 520px) {
  .editor-head, .editor-body, .editor-foot { padding-left: 15px; padding-right: 15px; }
  .library { grid-template-columns: 1fr; }
  .editor-foot { flex-wrap: wrap; }
}
</style>
