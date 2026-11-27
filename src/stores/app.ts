/** 知行 · 应用级状态：设置、枚举、主题 */

import { computed, reactive } from 'vue';
import { api } from '../api';
import type { Enums, Settings } from '../types';
import { accentHex, readableInk, rgba } from '../utils/color';
import { toast } from './ui';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  accent: 'teal',
  density: 'cozy',
  fontScale: 1,
  weekStart: 1,
  dailyGoalHours: 6,
  defaultProjectId: null,
  defaultMinutes: 120,
  reduceMotion: false,
  showWeekNumbers: false,
  snapshotHours: 12,
  attachmentLimitMB: 200,
  startView: 'today',
  welcomeDone: false,
};

const systemDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export const app = reactive({
  settings: { ...DEFAULT_SETTINGS } as Settings,
  enums: null as Enums | null,
  ready: false,
  saving: false,
  systemDark: systemDark ? systemDark.matches : true,
  serverError: '',
});

export const resolvedTheme = computed<'dark' | 'light'>(() => {
  if (app.settings.theme === 'system') return app.systemDark ? 'dark' : 'light';
  return app.settings.theme === 'light' ? 'light' : 'dark';
});

export function applyTheme(): void {
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme.value;
  root.dataset.density = app.settings.density;
  root.dataset.motion = app.settings.reduceMotion ? 'off' : '';
  root.style.setProperty('--font-scale', String(app.settings.fontScale || 1));

  const accent = accentHex(app.settings.accent, resolvedTheme.value);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-soft', rgba(accent, 0.12));
  root.style.setProperty('--accent-mid', rgba(accent, 0.24));
  root.style.setProperty('--accent-ink', readableInk(accent));
  root.style.setProperty('--motion', app.settings.reduceMotion ? '0' : '1');

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolvedTheme.value === 'dark' ? '#0c0e12' : '#f5f6f8');

  try {
    localStorage.setItem('zhixing.settings', JSON.stringify(app.settings));
  } catch (_) { /* 忽略隐私模式 */ }
}

if (systemDark && systemDark.addEventListener) {
  systemDark.addEventListener('change', (e) => {
    app.systemDark = e.matches;
    if (app.settings.theme === 'system') applyTheme();
  });
}

export async function initApp(): Promise<void> {
  try {
    const [settingsRes, enumsRes] = await Promise.all([api.settings.get(), api.enums()]);
    app.settings = { ...DEFAULT_SETTINGS, ...settingsRes.settings };
    app.enums = enumsRes;
    applyTheme();

    // 这次重做把工作区恢复成 Studio Log 的浅色底；只在首次升级时应用一次。
    // 之后用户在设置里选深色/跟随系统都会被尊重。
    let lightMigrated = false;
    try {
      lightMigrated = localStorage.getItem('zhixing.studio-light-v1') === '1';
      localStorage.setItem('zhixing.studio-light-v1', '1');
    } catch (_) { /* 隐私模式下忽略 */ }
    if (!lightMigrated && app.settings.theme === 'dark') {
      await saveSettings({ theme: 'light' });
    }

    app.ready = true;
  } catch (err: any) {
    app.serverError = err?.message || '连不上本地服务';
    applyTheme();
    throw err;
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const prev = { ...app.settings };
  app.settings = { ...app.settings, ...patch };
  applyTheme();
  app.saving = true;
  try {
    const res = await api.settings.save(patch);
    app.settings = { ...DEFAULT_SETTINGS, ...res.settings };
    applyTheme();
  } catch (err: any) {
    app.settings = prev;
    applyTheme();
    toast(err.message || '设置没能保存', 'error');
  } finally {
    app.saving = false;
  }
}

export async function refreshEnums(): Promise<void> {
  try { app.enums = await api.enums(); } catch (_) { /* 保留旧值 */ }
}