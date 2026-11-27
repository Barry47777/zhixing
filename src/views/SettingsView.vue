<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Icon from '../components/base/Icon.vue'
import DragNumber from '../components/base/DragNumber.vue'
import type { MigrateInspect, Snapshot, StorageInfo } from '../types'
import { api } from '../api'
import { fileToDataUrl, IS_WEB, http } from '../api/http'
import {
  clearEverything, data, demoSeededAt, emptyTrash, loadAll, purgeEntry, restoreEntry, trashedEntries,
} from '../stores/data'
import { patchSettings, resetSettings, settings } from '../stores/settings'
import { confirmDialog, toast } from '../stores/ui'
import { auth, authApi, lockNow, logoutNow } from '../stores/auth'
import { ACCENTS } from '../utils/color'
import { fmtBytes, fmtHours, relativeTime } from '../utils/format'

const snapshots = ref<Snapshot[]>([])
const storage = ref<StorageInfo | null>(null)
const migration = ref<MigrateInspect | null>(null)
const busy = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const showTrash = ref(false)

const origin = typeof location !== 'undefined' ? location.origin : ''

const themeOptions = [
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
  { value: 'system', label: '跟随系统', icon: 'monitor' },
] as const

const densityOptions = [
  { value: 'cozy', label: '舒适' },
  { value: 'compact', label: '紧凑' },
] as const

const snapshotOptions = [
  { value: 0, label: '关闭' },
  { value: 6, label: '每 6 小时' },
  { value: 12, label: '每 12 小时' },
  { value: 24, label: '每天' },
  { value: 72, label: '每 3 天' },
]

const entryCount = computed(() => data.entries.filter((e) => !e.deletedAt).length)
const projectCount = computed(() => data.projects.length)
const usagePct = computed(() => {
  const s = storage.value
  if (!s || !s.diskFree) return 0
  return Math.min(100, (s.bytes / s.diskFree) * 100)
})

const lastSavedText = computed(() => {
  const at = storage.value?.lastSavedAt
  if (!at) return '—'
  return new Date(at).toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
})

const canMigrate = computed(() => {
  const m = migration.value?.inspiration
  return !!m?.found && m.notes > 0
})

async function refresh() {
  await loadAll()
  const [snapRes, storageRes, migrateRes] = await Promise.all([
    api.system.snapshots.list(),
    api.system.storage(),
    api.system.inspectMigration(),
  ])
  snapshots.value = snapRes.snapshots || []
  storage.value = storageRes
  migration.value = migrateRes
}

onMounted(() => { void refresh() })

async function setTheme(v: 'light' | 'dark' | 'system') {
  await patchSettings({ theme: v })
}

/* 附件上限拖动时防抖写库，避免每一帧都写盘 */
let limitTimer: number | undefined
function setAttachmentLimit(v: number) {
  settings.attachmentLimitMB = v
  window.clearTimeout(limitTimer)
  limitTimer = window.setTimeout(() => { void patchSettings({ attachmentLimitMB: v }) }, 400)
}

async function exportBackup(withFiles: boolean) {
  if (IS_WEB) {
    // 网页版：导出在本地生成并由 http 层触发下载
    try {
      await http.get('/api/export?format=backup&scope=all')
      toast(withFiles ? '正在下载完整备份' : '正在下载 JSON 数据', 'success')
    } catch (err) {
      toast('导出失败：' + (err instanceof Error ? err.message : String(err)), 'error')
    }
    return
  }
  window.location.href = api.transfer.exportUrl('backup', { attachments: withFiles ? 1 : 0 })
  toast(withFiles ? '正在下载完整备份' : '正在下载 JSON 数据', 'success')
}

function pickFile() {
  fileInput.value?.click()
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const mode = await confirmDialog({
    title: '导入备份',
    message: `将读取「${file.name}」。选择导入方式：`,
    confirmText: '开始导入',
    extra: {
      label: '导入方式',
      value: 'merge',
      options: [
        { value: 'merge', label: '追加合并（保留现有数据）' },
        { value: 'replace', label: '完全覆盖（清空后恢复）' },
      ],
    },
  })
  if (!mode.ok) return
  busy.value = true
  try {
    const dataUrl = await fileToDataUrl(file)
    const res = await api.transfer.import(
      [{ name: file.name, data: dataUrl }],
      (mode.extraValue as 'merge' | 'replace') || 'merge',
      false,
      mode.extraValue === 'replace',
    )
    await refresh()
    toast(`导入完成：${res.parsed} 个文件，${res.duplicates} 条重复已跳过`, 'success')
  } catch (err) {
    toast('导入失败：' + (err instanceof Error ? err.message : String(err)), 'error')
  } finally {
    busy.value = false
  }
}

async function doSnapshot() {
  busy.value = true
  try {
    await api.system.snapshots.create('手动备份')
    await refresh()
    toast('已创建快照', 'success')
  } finally {
    busy.value = false
  }
}

async function restore(snap: Snapshot) {
  const res = await confirmDialog({
    title: '恢复到这份快照？',
    message: `将回到 ${new Date(snap.createdAt).toLocaleString('zh-CN')} 的状态。当前数据会先自动备份一份。`,
    confirmText: '恢复',
  })
  if (!res.ok) return
  busy.value = true
  try {
    await api.system.snapshots.restore(snap.name)
    await refresh()
    toast('已恢复', 'success')
  } catch (err) {
    toast('恢复失败：' + (err instanceof Error ? err.message : String(err)), 'error')
  } finally {
    busy.value = false
  }
}

async function removeSnapshot(snap: Snapshot) {
  const res = await confirmDialog({ title: '删除这份快照？', message: snap.reason, confirmText: '删除', danger: true })
  if (!res.ok) return
  await api.system.snapshots.remove(snap.name)
  await refresh()
  toast('快照已删除')
}

async function cleanup() {
  const res = await confirmDialog({
    title: '清理孤儿文件？',
    message: '会删除没有被任何笔记或记录引用的上传文件，不会影响正常数据。',
    confirmText: '开始清理',
  })
  if (!res.ok) return
  busy.value = true
  try {
    const r = await api.system.cleanup()
    await refresh()
    toast(`已清理 ${r.removedFiles} 个文件、${r.purgedEntries} 条残留记录`, 'success')
  } finally {
    busy.value = false
  }
}

async function runMigration() {
  const m = migration.value?.inspiration
  if (!m) return
  const res = await confirmDialog({
    title: '导入旧版灵感数据？',
    message: `在 ${m.path} 找到 ${m.notes} 条笔记、${m.mediaFiles} 个图片文件。导入是追加合并，不会删除现有内容。`,
    confirmText: '开始导入',
  })
  if (!res.ok) return
  busy.value = true
  try {
    const r = await api.system.migrateInspiration(false)
    await refresh()
    toast(`已导入 ${r.imported} 条笔记，${r.images} 个图片`, 'success')
  } finally {
    busy.value = false
  }
}

async function clearDemo() {
  const res = await confirmDialog({
    title: '清空演示数据？',
    message: '只清除首次启动时自动写入的示例内容，你自己添加的记录会保留。',
    confirmText: '清空演示',
    danger: true,
  })
  if (!res.ok) return
  busy.value = true
  try {
    await clearEverything()
    await refresh()
    toast('演示数据已清空', 'success')
  } finally {
    busy.value = false
  }
}

async function doResetSettings() {
  const res = await confirmDialog({
    title: '恢复默认设置？',
    message: '外观与偏好会回到初始值，数据不受影响。',
    confirmText: '恢复默认',
  })
  if (!res.ok) return
  await resetSettings()
  toast('设置已重置', 'success')
}

async function handleRestore(id: string) {
  await restoreEntry(id)
  await refresh()
  toast('已恢复到日历', 'success')
}

async function handlePurge(id: string) {
  const res = await confirmDialog({
    title: '彻底删除这条记录？',
    message: '记录和它的附件都会被移除，无法恢复。',
    danger: true,
    confirmText: '彻底删除',
  })
  if (!res.ok) return
  await purgeEntry(id)
  await refresh()
  toast('已彻底删除')
}

async function handleEmptyTrash() {
  const res = await confirmDialog({
    title: '清空回收站？',
    message: `${trashedEntries.value.length} 条记录将被永久删除。`,
    danger: true,
    confirmText: '清空',
  })
  if (!res.ok) return
  const n = await emptyTrash()
  await refresh()
  toast(`已永久删除 ${n} 条`, 'success')
}

/* ---------------------------------------------------------- 本机账户 */
const oldPw = ref('')
const newPw = ref('')
const newPw2 = ref('')
const recoveryPw = ref('')
const busyAuth = ref(false)
const autoLockOptions = [
  { value: 5, label: '5 分钟' },
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 180, label: '3 小时' },
]

async function changePassword() {
  if (newPw.value.length < 8) return toast('新密码至少 8 位', 'error')
  if (newPw.value !== newPw2.value) return toast('两次输入的新密码不一样', 'error')
  busyAuth.value = true
  try {
    await authApi.password(oldPw.value, newPw.value)
    oldPw.value = newPw.value = newPw2.value = ''
    toast('密码已修改，其他窗口的登录状态已失效', 'success')
  } catch (e: any) {
    toast(e?.message || '修改失败', 'error')
  } finally { busyAuth.value = false }
}

async function regenerateRecovery() {
  if (!recoveryPw.value) return toast('先输入当前密码', 'error')
  const res = await confirmDialog({
    title: '更换恢复码？',
    message: '旧恢复码会立刻作废，新恢复码只显示这一次。',
    confirmText: '更换',
  })
  if (!res.ok) return
  busyAuth.value = true
  try {
    const r: any = await authApi.recovery(recoveryPw.value)
    recoveryPw.value = ''
    const copied = await confirmDialog({
      title: '新恢复码（只显示一次）',
      message: r.recoveryCode,
      confirmText: '我已保存',
      cancelText: '关闭',
    })
    void copied
  } catch (e: any) {
    toast(e?.message || '更换失败', 'error')
  } finally { busyAuth.value = false }
}

async function setAutoLock(minutes: number) {
  try {
    await authApi.autoLock(minutes)
    auth.autoLockMinutes = minutes
    toast('自动锁定时间已更新', 'success')
  } catch (e: any) {
    toast(e?.message || '设置失败', 'error')
  }
}

async function doLogout() {
  const res = await confirmDialog({ title: '退出登录？', message: '回到登录页，数据不会受影响。', confirmText: '退出' })
  if (res.ok) await logoutNow()
}

async function doLock() {
  const res = await confirmDialog({ title: '立即锁定？', message: '所有登录会话都会失效，需要重新输入密码。', confirmText: '锁定' })
  if (res.ok) await lockNow()
}

const shortcuts = [
  ['N', '新建记录'],
  ['T', '回到今天'],
  ['← →', '切换月份'],
  ['1 – 6', '切换页面'],
  ['/', '搜索'],
  ['Esc', '关闭抽屉'],
]
</script>

<template>
  <div class="settings-view">
    <div class="settings-inner">
      <!-- 外观 -->
      <section class="set-card card">
        <header class="set-head">
          <div>
            <h3>外观</h3>
            <p>主题、强调色与日历密度</p>
          </div>
          <Icon name="palette" :size="16" class="set-icon" />
        </header>

        <div class="set-row">
          <div class="set-label">
            <strong>主题</strong>
            <span>深色模式适合夜间记录</span>
          </div>
          <div class="theme-group">
            <button
              v-for="t in themeOptions"
              :key="t.value"
              class="theme-btn"
              :class="{ 'is-on': settings.theme === t.value }"
              @click="setTheme(t.value)"
            >
              <Icon :name="t.icon" :size="14" />
              {{ t.label }}
            </button>
          </div>
        </div>

        <div class="set-row">
          <div class="set-label">
            <strong>强调色</strong>
            <span>按钮、今天、选中状态的配色</span>
          </div>
          <div class="accent-group">
            <button
              v-for="a in ACCENTS"
              :key="a.value"
              class="accent-swatch"
              :class="{ 'is-on': settings.accent === a.id }"
              :style="{ background: a.value }"
              :title="a.name"
              @click="patchSettings({ accent: a.id })"
            />
          </div>
        </div>

        <div class="set-row">
          <div class="set-label">
            <strong>日历密度</strong>
            <span>每天最多显示 3 条或 2 条</span>
          </div>
          <div class="seg">
            <button
              v-for="d in densityOptions"
              :key="d.value"
              :class="{ 'is-on': settings.density === d.value }"
              @click="patchSettings({ density: d.value })"
            >{{ d.label }}</button>
          </div>
        </div>

        <div class="set-row">
          <div class="set-label">
            <strong>字号</strong>
            <span>整体缩放 {{ Math.round(settings.fontScale * 100) }}%</span>
          </div>
          <input
            class="range"
            type="range"
            min="0.9"
            max="1.15"
            step="0.05"
            :value="settings.fontScale"
            @input="patchSettings({ fontScale: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
      </section>

      <!-- 日历与记录 -->
      <section class="set-card card">
        <header class="set-head">
          <div>
            <h3>日历与记录</h3>
            <p>周起始日、每日目标和新增记录的默认值</p>
          </div>
          <Icon name="calendar" :size="16" class="set-icon" />
        </header>

        <div class="set-row">
          <div class="set-label">
            <strong>每周从</strong>
            <span>影响月历排布与周报范围</span>
          </div>
          <div class="seg">
            <button :class="{ 'is-on': settings.weekStartsOn === 1 }" @click="patchSettings({ weekStartsOn: 1 })">周一开始</button>
            <button :class="{ 'is-on': settings.weekStartsOn === 0 }" @click="patchSettings({ weekStartsOn: 0 })">周日开始</button>
          </div>
        </div>

        <div class="set-row">
          <div class="set-label">
            <strong>每日目标工时</strong>
            <span>抽屉里的进度条与侧栏周目标会参考它</span>
          </div>
          <div class="num-group">
            <input
              type="number"
              min="0"
              max="16"
              step="0.5"
              :value="settings.dailyGoal"
              @change="patchSettings({ dailyGoal: Number(($event.target as HTMLInputElement).value) })"
            />
            <span>小时</span>
          </div>
        </div>

        <div class="set-row">
          <div class="set-label">
            <strong>默认项目</strong>
            <span>新建记录时自动选中的项目</span>
          </div>
          <select
            class="set-select"
            :value="settings.defaultProjectId || ''"
            @change="patchSettings({ defaultProjectId: (($event.target as HTMLSelectElement).value || null) })"
          >
            <option value="">未分类</option>
            <option v-for="p in data.projects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>

        <div class="set-row">
          <div class="set-label">
            <strong>默认时长</strong>
            <span>新增记录时预填的小时数</span>
          </div>
          <div class="num-group">
            <input
              type="number"
              min="0"
              max="24"
              step="0.5"
              :value="settings.defaultHours"
              @change="patchSettings({ defaultHours: Number(($event.target as HTMLInputElement).value) })"
            />
            <span>小时</span>
          </div>
        </div>

        <div class="set-row">
          <div class="set-label">
            <strong>减少动效</strong>
            <span>关闭抽屉滑入等动画</span>
          </div>
          <button
            class="switch"
            :class="{ 'is-on': settings.reduceMotion }"
            @click="patchSettings({ reduceMotion: !settings.reduceMotion })"
          />
        </div>
      </section>

      <!-- 本机账户与安全（网页版无本机账户，隐藏） -->
      <section v-if="!IS_WEB" class="set-card card">
        <header class="set-head">
          <div>
            <h3>本机账户与安全</h3>
            <p>挡住别人打开这台电脑后直接查看你的记录</p>
          </div>
          <Icon name="shield" :size="16" class="set-icon" />
        </header>

        <div class="safety">
          <div class="safety-head">
            <span class="safety-title">当前账户</span>
            <span class="safety-badge ok">已登录</span>
          </div>
          <div class="safety-grid">
            <div class="safety-row">
              <span class="safety-k">账户名</span>
              <span class="safety-v">{{ auth.username || '—' }}</span>
            </div>
            <div class="safety-row">
              <span class="safety-k">离开后自动锁定</span>
              <span class="safety-v">{{ auth.autoLockMinutes ?? 30 }} 分钟未操作</span>
            </div>
          </div>
        </div>

        <div class="sub-head" style="margin-top: 14px">
          <span class="sub-title">自动锁定时间</span>
        </div>
        <div class="chip-row">
          <button
            v-for="o in autoLockOptions"
            :key="o.value"
            class="chip-btn"
            :class="{ 'is-on': auth.autoLockMinutes === o.value }"
            @click="setAutoLock(o.value)"
          >{{ o.label }}</button>
        </div>

        <div class="sub-head" style="margin-top: 14px">
          <span class="sub-title">修改密码</span>
        </div>
        <div class="pw-grid">
          <input v-model="oldPw" type="password" autocomplete="current-password" placeholder="当前密码" />
          <input v-model="newPw" type="password" autocomplete="new-password" placeholder="新密码（至少 8 位）" />
          <input v-model="newPw2" type="password" autocomplete="new-password" placeholder="再输一次新密码" />
          <button class="btn sm primary" :disabled="busyAuth" @click="changePassword">保存新密码</button>
        </div>

        <div class="sub-head" style="margin-top: 14px">
          <span class="sub-title">恢复码</span>
        </div>
        <p class="hint-line">
          忘记密码时用它重置。换新恢复码后旧码立刻作废，新码只显示一次，请马上抄下来。
        </p>
        <div class="pw-grid two">
          <input v-model="recoveryPw" type="password" autocomplete="current-password" placeholder="输入当前密码确认" />
          <button class="btn sm" :disabled="busyAuth" @click="regenerateRecovery">换一个恢复码</button>
        </div>

        <div class="btn-row" style="margin-top: 14px">
          <button class="btn sm" @click="doLock"><Icon name="lock" :size="13" /> 立即锁定</button>
          <button class="btn sm" @click="doLogout">退出登录</button>
        </div>
      </section>

      <!-- 数据 -->
      <section class="set-card card">
        <header class="set-head">
          <div>
            <h3>数据与备份</h3>
            <p>数据只存在这台设备的数据目录里，不联网、不上传</p>
          </div>
          <Icon name="database" :size="16" class="set-icon" />
        </header>

        <div class="data-summary">
          <div class="ds-item"><strong>{{ storage?.entries ?? entryCount }}</strong><span>条记录</span></div>
          <div class="ds-item"><strong>{{ storage?.notes ?? 0 }}</strong><span>条笔记</span></div>
          <div class="ds-item"><strong>{{ snapshots.length }}</strong><span>份快照</span></div>
          <div class="ds-item"><strong>{{ fmtBytes(storage?.mediaBytes || 0) }}</strong><span>附件占用</span></div>
        </div>

        <!-- 存储位置 -->
        <div class="safety">
          <div class="safety-head">
            <span class="safety-title">存储位置</span>
            <span class="safety-badge ok">本机服务</span>
          </div>
          <div class="safety-grid">
            <div class="safety-row">
              <span class="safety-k">访问地址</span>
              <code class="safety-v mono">{{ origin }}</code>
            </div>
            <div class="safety-row">
              <span class="safety-k">数据目录</span>
              <code class="safety-v mono">{{ storage?.dataDir || '检测中…' }}</code>
            </div>
            <div class="safety-row">
              <span class="safety-k">磁盘可用</span>
              <span class="safety-v">{{ storage?.diskFree ? fmtBytes(storage.diskFree) : '未知' }}</span>
            </div>
            <div class="safety-row">
              <span class="safety-k">最后写入</span>
              <span class="safety-v">{{ lastSavedText }}</span>
            </div>
          </div>
          <div class="safety-actions">
            <button class="btn sm" :disabled="busy" @click="cleanup">清理孤儿文件</button>
          </div>
          <p class="safety-note">
            知行的数据保存在本机服务的数据目录里，不依赖浏览器缓存。请固定用上面的地址访问；
            换端口会读不到同一份数据。定期用「含附件完整备份」留一份副本更稳妥。
          </p>
        </div>

        <div class="usage">
          <div class="usage-bar"><i :style="{ width: usagePct + '%' }" /></div>
          <span>
            数据目录已用 {{ fmtBytes(storage?.bytes || 0) }}
            <template v-if="storage?.diskFree"> / 磁盘可用 {{ fmtBytes(storage.diskFree) }}</template>
          </span>
        </div>

        <div class="set-row">
          <div class="set-label">
            <strong>附件存储上限</strong>
            <span>超过后不再接收新附件；单个文件最多 40MB</span>
          </div>
          <div class="limit-slider">
            <DragNumber
              :model-value="settings.attachmentLimitMB"
              :min="50"
              :max="2000"
              :step="50"
              unit="MB"
              :height="6"
              :presets="[200, 500, 1000, 2000]"
              aria-label="附件存储上限"
              @update:model-value="setAttachmentLimit"
            />
          </div>
        </div>

        <div class="btn-row">
          <button class="btn sm" :disabled="busy" @click="exportBackup(false)">
            <Icon name="download" :size="13" /> 导出数据（JSON）
          </button>
          <button class="btn sm" :disabled="busy" @click="exportBackup(true)">
            <Icon name="download" :size="13" /> 含附件完整备份
          </button>
          <button class="btn sm" :disabled="busy" @click="pickFile">
            <Icon name="upload" :size="13" /> 导入备份
          </button>
          <input ref="fileInput" type="file" accept="application/json,.json" hidden @change="onFile" />
        </div>

        <div class="tip">
          <Icon name="info" :size="13" />
          <span>建议每周导出一次 JSON 放在网盘或移动硬盘。浏览器清缓存、换设备都会丢失本地数据。</span>
        </div>

        <div class="sub-head">
          <span class="sub-title">自动快照</span>
          <select
            class="mini-select"
            :value="settings.autoSnapshotHours"
            @change="patchSettings({ autoSnapshotHours: Number(($event.target as HTMLSelectElement).value) })"
          >
            <option v-for="o in snapshotOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <button class="btn sm ghost" @click="doSnapshot">立即备份</button>
        </div>

        <ul v-if="snapshots.length" class="snap-list">
          <li v-for="s in snapshots" :key="s.name" class="snap">
            <span class="snap-dot" />
            <div class="snap-main">
              <span class="snap-title">{{ s.reason }}</span>
              <span class="snap-sub">
                {{ new Date(s.createdAt).toLocaleString('zh-CN') }} ·
                {{ fmtBytes(s.size) }}
              </span>
            </div>
            <button class="btn sm ghost" @click="restore(s)">恢复</button>
            <button class="icon-btn danger" title="删除快照" @click="removeSnapshot(s)">
              <Icon name="trash" :size="13" />
            </button>
          </li>
        </ul>
        <p v-else class="no-snap">还没有快照，点「立即备份」创建一份。</p>
      </section>

      <!-- 回收站 -->
      <section class="set-card card">
        <header class="set-head">
          <div>
            <h3>回收站</h3>
            <p>删除的记录会保留 30 天，可随时恢复</p>
          </div>
          <button class="head-action" :class="{ 'is-on': showTrash }" @click="showTrash = !showTrash">
            {{ showTrash ? '收起' : `查看 ${trashedEntries.length} 条` }}
          </button>
        </header>

        <div v-if="showTrash">
          <div v-if="!trashedEntries.length" class="empty">
            <Icon name="trash" :size="24" />
            <strong>回收站是空的</strong>
            <span>删除的记录会先来这里，30 天后自动清理。</span>
          </div>
          <template v-else>
            <ul class="trash-list">
              <li v-for="e in trashedEntries" :key="e.id">
                <span class="trash-dot" :style="{ background: e.deletedAt ? 'var(--faint)' : 'var(--line)' }" />
                <div class="trash-main">
                  <span class="trash-title">{{ e.title }}</span>
                  <span class="trash-sub">{{ e.date }} · {{ fmtHours(e.hours) }}h · 删除于 {{ relativeTime(e.deletedAt || 0) }}</span>
                </div>
                <button class="btn sm ghost" @click="handleRestore(e.id)">恢复</button>
                <button class="icon-btn danger" @click="handlePurge(e.id)">
                  <Icon name="close" :size="13" />
                </button>
              </li>
            </ul>
            <button class="btn sm danger" style="margin-top: 10px" @click="handleEmptyTrash">清空回收站</button>
          </template>
        </div>
      </section>

      <!-- 其他 -->
      <section class="set-card card">
        <header class="set-head">
          <div>
            <h3>其他</h3>
            <p>迁移、示例数据与重置</p>
          </div>
          <Icon name="settings" :size="16" class="set-icon" />
        </header>

        <div v-if="canMigrate" class="legacy-box">
          <div>
            <strong>检测到旧版灵感数据</strong>
            <p>在 {{ migration?.inspiration.path }} 找到 {{ migration?.inspiration.notes }} 条笔记，可一键合并导入。</p>
          </div>
          <button class="btn sm primary" :disabled="busy" @click="runMigration">导入旧版灵感</button>
        </div>

        <div class="btn-row">
          <button v-if="demoSeededAt" class="btn sm" :disabled="busy" @click="clearDemo">清空演示数据</button>
          <button class="btn sm" @click="doResetSettings">恢复默认设置</button>
          <button class="btn sm" :disabled="busy" @click="refresh">刷新数据</button>
        </div>

        <div class="sub-head" style="margin-top: 14px">
          <span class="sub-title">快捷键</span>
        </div>
        <div class="shortcut-grid">
          <div v-for="s in shortcuts" :key="s[0]" class="shortcut">
            <kbd>{{ s[0] }}</kbd>
            <span>{{ s[1] }}</span>
          </div>
        </div>

        <p class="about">
          知行 · 本机服务 · 数据保存在这台设备的数据目录<br />
          本机账户只用来挡住旁人查看，不会上传任何内容。
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 24px 32px;
}
.settings-inner {
  max-width: 760px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.set-card { padding: 16px 18px 18px; }
.set-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 4px; }
.set-head h3 { font-size: 13.5px; font-weight: 650; letter-spacing: -.01em; }
.set-head p { font-size: 11px; color: var(--muted); margin-top: 2px; line-height: 1.5; }
.set-icon { margin-left: auto; color: var(--faint); flex: none; }
.head-action {
  margin-left: auto;
  font-size: 11px;
  color: var(--muted);
  border: 1px solid var(--line);
  padding: 3px 9px;
  border-radius: 6px;
  flex: none;
}
.head-action:hover, .head-action.is-on { color: var(--accent); border-color: var(--accent); }

.set-row {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line-soft);
}
.set-row:last-child { border-bottom: 0; padding-bottom: 0; }
.set-label { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.set-label strong { font-size: 12.5px; font-weight: 550; }
.set-label span { font-size: 10.5px; color: var(--muted); line-height: 1.45; }

.theme-group { display: flex; gap: 3px; background: var(--bg-soft); padding: 3px; border-radius: 9px; }
.theme-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border-radius: 7px;
  font-size: 11.5px;
  color: var(--muted);
}
.theme-btn:hover { color: var(--ink-2); }
.theme-btn.is-on { background: var(--panel); color: var(--ink); font-weight: 600; box-shadow: var(--shadow-xs); }

.accent-group { display: flex; gap: 6px; }
.accent-swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  transition: transform .12s, box-shadow .12s;
}
.accent-swatch:hover { transform: scale(1.1); }
.accent-swatch.is-on { box-shadow: 0 0 0 2px var(--panel), 0 0 0 4px var(--ink); }

.range { width: 150px; accent-color: var(--accent); }
.num-group { display: flex; align-items: center; gap: 6px; }
.num-group input { width: 64px; height: 30px; font-size: 12px; }
.num-group span { font-size: 11px; color: var(--muted); }
.set-select { width: 160px; height: 30px; font-size: 12px; }

.data-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin: 10px 0;
}
.ds-item {
  background: var(--panel-2);
  border: 1px solid var(--line-soft);
  border-radius: 9px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
}
.ds-item strong { font-size: 14px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.ds-item span { font-size: 9.5px; color: var(--muted); }

/* 本机账户 */
.chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
.chip-btn {
  height: 28px; padding: 0 11px; border-radius: 99px;
  border: 1px solid var(--line); background: var(--panel);
  color: var(--muted); font: inherit; font-size: 11.5px; cursor: pointer;
  transition: border-color .15s, color .15s, background .15s;
}
.chip-btn:hover { border-color: var(--accent); color: var(--accent); }
.chip-btn.is-on { background: var(--accent-soft); border-color: var(--accent-mid); color: var(--accent); font-weight: 600; }
.pw-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.pw-grid.two { grid-template-columns: minmax(0, 1fr) auto; }
.pw-grid input {
  width: 100%; height: 32px; padding: 0 10px;
  border: 1px solid var(--line); border-radius: 8px;
  background: var(--bg-soft); color: var(--text);
  font: inherit; font-size: 12px; outline: none;
}
.pw-grid input:focus { border-color: var(--accent); background: var(--panel); }
.pw-grid .btn { height: 32px; }
.hint-line { margin: 6px 0 9px; font-size: 11px; line-height: 1.7; color: var(--muted); }

/* 数据安全 */
.safety {
  border: 1px solid var(--line-soft);
  border-radius: 11px;
  padding: 10px 12px 11px;
  margin-bottom: 10px;
  background: linear-gradient(180deg, var(--panel-2), transparent);
}
.safety-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.safety-title { font-size: 11.5px; font-weight: 640; letter-spacing: -.01em; }
.safety-badge {
  font-size: 9.5px;
  padding: 1px 7px;
  border-radius: 99px;
  font-weight: 600;
}
.safety-badge.ok { background: color-mix(in srgb, var(--ok) 14%, transparent); color: var(--ok); }
.safety-badge.warn { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); }
.safety-grid { display: grid; gap: 5px; }
.safety-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 10.5px;
}
.safety-k { color: var(--muted); flex: none; }
.safety-v { color: var(--text); text-align: right; word-break: break-all; }
.safety-v.mono { font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 10px; }
.safety-v.ok { color: var(--ok); }
.safety-v.warn { color: var(--warn); }
.safety-actions { display: flex; gap: 6px; margin-top: 9px; }
.safety-note {
  margin: 8px 0 0;
  font-size: 9.5px;
  line-height: 1.65;
  color: var(--faint);
}

.limit-slider { width: min(260px, 46%); }
.usage { display: flex; align-items: center; gap: 9px; font-size: 10px; color: var(--faint); margin-bottom: 10px; }
.usage-bar { flex: 1; height: 3px; border-radius: 99px; background: var(--line-soft); overflow: hidden; }
.usage-bar i { display: block; height: 100%; background: var(--accent); border-radius: 99px; min-width: 2px; }

.btn-row { display: flex; flex-wrap: wrap; gap: 6px; }
.tip {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 10px;
  padding: 8px 10px;
  background: var(--accent-soft);
  border-radius: 8px;
  font-size: 10.5px;
  color: var(--accent);
  line-height: 1.55;
}
.tip svg { flex: none; margin-top: 1px; }

.sub-head { display: flex; align-items: center; gap: 8px; margin: 16px 0 8px; }
.sub-title { font-size: 10px; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.mini-select { height: 27px; font-size: 11px; padding: 0 22px 0 7px; }
.sub-head .btn { margin-left: auto; }

.snap-list { display: flex; flex-direction: column; gap: 3px; }
.snap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  font-size: 11.5px;
}
.snap:hover { background: var(--bg-soft); }
.snap-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--line); flex: none; }
.snap-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.snap-title { font-weight: 500; }
.snap-sub { font-size: 10px; color: var(--faint); font-variant-numeric: tabular-nums; }
.no-snap { font-size: 11px; color: var(--faint); padding: 6px 2px; }

.trash-list { display: flex; flex-direction: column; gap: 3px; margin-top: 8px; }
.trash-list li { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 7px; }
.trash-list li:hover { background: var(--bg-soft); }
.trash-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.trash-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.trash-title { font-size: 12px; text-decoration: line-through; text-decoration-color: var(--line); color: var(--ink-2); }
.trash-sub { font-size: 10px; color: var(--faint); font-variant-numeric: tabular-nums; }

.legacy-box {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  border-radius: 9px;
  margin: 10px 0 4px;
}
.legacy-box strong { font-size: 12px; color: var(--accent); }
.legacy-box p { font-size: 10.5px; color: var(--ink-2); margin-top: 2px; line-height: 1.5; }
.legacy-box > div { flex: 1; }

.shortcut-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 14px; }
.shortcut { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--muted); }
.shortcut kbd {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-2);
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 5px;
  min-width: 24px;
  text-align: center;
}

.about {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--line-soft);
  font-size: 10.5px;
  color: var(--faint);
  line-height: 1.7;
}

@media (max-width: 760px) {
  .settings-view { padding: 4px 12px 24px; }
  .set-card { padding: 14px 14px 16px; }
  .set-row { flex-wrap: wrap; gap: 8px; }
  .set-label { flex: 1 1 100%; }
  .data-summary { grid-template-columns: repeat(2, 1fr); }
  .shortcut-grid { grid-template-columns: repeat(2, 1fr); }
  .theme-group { width: 100%; }
  .theme-btn { flex: 1; justify-content: center; }
}
</style>
