/**
 * 设置适配层
 * 界面用的是 Studio Log 的字段名（dailyGoal / defaultHours / weekStartsOn …），
 * 实际存储仍然是知行的 Settings（dailyGoalHours / defaultMinutes / weekStart …）。
 */

import { reactive, watch } from 'vue'
import { app, resolvedTheme as zhixingTheme, saveSettings, DEFAULT_SETTINGS } from './app'

export interface StudioSettings {
  theme: 'light' | 'dark' | 'system'
  accent: string
  density: 'compact' | 'cozy'
  weekStartsOn: 0 | 1
  dailyGoal: number
  defaultProjectId: string | null
  defaultHours: number
  fontScale: number
  autoSnapshotHours: number
  attachmentLimitMB: number
  showWeekNumbers: boolean
  reduceMotion: boolean
}

function fromApp(): StudioSettings {
  const s = app.settings
  return {
    theme: s.theme,
    accent: s.accent,
    density: s.density,
    weekStartsOn: s.weekStart,
    dailyGoal: s.dailyGoalHours,
    defaultProjectId: s.defaultProjectId,
    defaultHours: (s.defaultMinutes || 120) / 60,
    fontScale: s.fontScale,
    autoSnapshotHours: s.snapshotHours,
    attachmentLimitMB: s.attachmentLimitMB,
    showWeekNumbers: s.showWeekNumbers,
    reduceMotion: s.reduceMotion,
  }
}

export const settings = reactive<StudioSettings>(fromApp())

let syncing = false

/** 后端返回新设置后，把界面层再对一次 */
export function syncSettingsFromApp(): void {
  syncing = true
  Object.assign(settings, fromApp())
  syncing = false
}

export async function patchSettings(patch: Partial<StudioSettings>): Promise<void> {
  Object.assign(settings, patch)
  const body: Record<string, unknown> = {}
  if (patch.theme !== undefined) body.theme = patch.theme
  if (patch.density !== undefined) body.density = patch.density
  if (patch.weekStartsOn !== undefined) body.weekStart = patch.weekStartsOn
  if (patch.dailyGoal !== undefined) body.dailyGoalHours = patch.dailyGoal
  if (patch.defaultProjectId !== undefined) body.defaultProjectId = patch.defaultProjectId
  if (patch.defaultHours !== undefined) body.defaultMinutes = Math.round(patch.defaultHours * 60)
  if (patch.fontScale !== undefined) body.fontScale = patch.fontScale
  if (patch.autoSnapshotHours !== undefined) body.snapshotHours = patch.autoSnapshotHours
  if (patch.attachmentLimitMB !== undefined) body.attachmentLimitMB = patch.attachmentLimitMB
  if (patch.showWeekNumbers !== undefined) body.showWeekNumbers = patch.showWeekNumbers
  if (patch.reduceMotion !== undefined) body.reduceMotion = patch.reduceMotion
  if (patch.accent !== undefined) body.accent = patch.accent
  await saveSettings(body as any)
  syncSettingsFromApp()
}

export function resolvedTheme(): 'light' | 'dark' {
  return zhixingTheme.value
}

export async function resetSettings(): Promise<void> {
  await saveSettings({ ...DEFAULT_SETTINGS })
  syncSettingsFromApp()
}

watch(() => ({ ...app.settings }), syncSettingsFromApp, { deep: true })
