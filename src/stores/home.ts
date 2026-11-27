/**
 * 首页（回到今天）模块化布局。
 *
 * 这里只保存「首页怎么摆」：模块顺序、宽度、显示状态、标题和内容参数。
 * 数据本身仍然全部来自 stores/data / stores/workspace，不新增后端接口。
 */

import { reactive } from 'vue';
import { uid } from '../utils/format';

export type HomeModuleType =
  | 'hero' | 'week' | 'compose' | 'entries' | 'summary'
  | 'blind' | 'projects' | 'notes' | 'tags' | 'stats' | 'quick' | 'note';

export type HomeSpan = 4 | 6 | 8 | 12;

export interface HomeModuleOptions {
  /** 列表类模块最多显示几条 */
  limit?: number;
  /** 今日记录的状态筛选 */
  filter?: 'all' | 'done' | 'doing' | 'blocked';
  /** 今日记录 / 项目模块的项目筛选 */
  projectId?: string | null;
  /** 灵感模块分区 */
  zone?: 'all' | 'inspiration' | 'review';
  /** 便签模块正文 */
  text?: string;
  /** 快捷模块里放哪些动作 */
  actions?: string[];
  /** 概览模块是否显示本周节奏 */
  showWeek?: boolean;
}

export interface HomeModule {
  id: string;
  type: HomeModuleType;
  title: string;
  enabled: boolean;
  span: HomeSpan;
  options: HomeModuleOptions;
}

export interface HomeConfig {
  version: 1;
  mode: 'grid' | 'list';
  compact: boolean;
  editing: boolean;
  modules: HomeModule[];
}

export interface HomeModuleMeta {
  type: HomeModuleType;
  label: string;
  icon: string;
  desc: string;
  defaultTitle: string;
  defaultSpan: HomeSpan;
  defaultOptions: HomeModuleOptions;
}

export const MODULE_LIBRARY: HomeModuleMeta[] = [
  { type: 'hero', label: '今日概览', icon: 'today', desc: '工时、目标与完成度', defaultTitle: '今天', defaultSpan: 12, defaultOptions: { showWeek: true } },
  { type: 'week', label: '本周节奏', icon: 'chart', desc: '七天工时柱状图', defaultTitle: '本周节奏', defaultSpan: 4, defaultOptions: {} },
  { type: 'compose', label: '快速记录', icon: 'plus', desc: '五秒记一条今天做了什么', defaultTitle: '快速记录', defaultSpan: 8, defaultOptions: {} },
  { type: 'entries', label: '今日记录', icon: 'list', desc: '按项目 / 状态筛选条目', defaultTitle: '今天的记录', defaultSpan: 8, defaultOptions: { filter: 'all', projectId: null, limit: 20 } },
  { type: 'summary', label: '当日总结', icon: 'edit', desc: '停笔自动保存的日记区', defaultTitle: '当日总结', defaultSpan: 8, defaultOptions: {} },
  { type: 'blind', label: '翻一张旧牌', icon: 'spark', desc: '随机回看一条旧灵感', defaultTitle: '翻一张旧牌', defaultSpan: 4, defaultOptions: {} },
  { type: 'projects', label: '项目轨道', icon: 'folder', desc: '本月各项目投入进度', defaultTitle: '项目轨道', defaultSpan: 4, defaultOptions: { limit: 6 } },
  { type: 'notes', label: '最近灵感', icon: 'book', desc: '灵感 / 心得列表', defaultTitle: '刚记下的', defaultSpan: 4, defaultOptions: { zone: 'all', limit: 4 } },
  { type: 'tags', label: '常用标签', icon: 'tag', desc: '出现最多的标签', defaultTitle: '常用标签', defaultSpan: 4, defaultOptions: { limit: 8 } },
  { type: 'stats', label: '数字速览', icon: 'target', desc: '记录数、连续天数与待复盘', defaultTitle: '数字速览', defaultSpan: 4, defaultOptions: {} },
  { type: 'quick', label: '快捷入口', icon: 'grid', desc: '自定义常用功能按钮', defaultTitle: '快捷入口', defaultSpan: 4, defaultOptions: { actions: ['new', 'calendar', 'notes', 'review'] } },
  { type: 'note', label: '自定义便签', icon: 'type', desc: '写一句置顶提示给自己', defaultTitle: '便签', defaultSpan: 4, defaultOptions: { text: '' } },
];

export const QUICK_ACTIONS = [
  { key: 'new', label: '记一条', icon: 'plus' },
  { key: 'calendar', label: '日历', icon: 'calendar' },
  { key: 'notes', label: '灵感', icon: 'spark' },
  { key: 'review', label: '复盘', icon: 'review' },
  { key: 'projects', label: '项目', icon: 'folder' },
  { key: 'stats', label: '统计', icon: 'chart' },
  { key: 'settings', label: '设置', icon: 'settings' },
];

const STORAGE_KEY = 'zhixing.home.layout.v1';

function metaOfType(type: HomeModuleType): HomeModuleMeta {
  return MODULE_LIBRARY.find((m) => m.type === type) || MODULE_LIBRARY[0];
}

function defaultModule(type: HomeModuleType, id = uid('hm-')): HomeModule {
  const meta = metaOfType(type);
  return {
    id,
    type,
    title: meta.defaultTitle,
    enabled: true,
    span: meta.defaultSpan,
    options: { ...meta.defaultOptions, actions: meta.defaultOptions.actions ? [...meta.defaultOptions.actions] : undefined },
  };
}

export function defaultHomeConfig(): HomeConfig {
  return {
    version: 1,
    mode: 'grid',
    compact: false,
    editing: false,
    modules: [
      defaultModule('hero', 'hero'),
      defaultModule('compose', 'compose'),
      defaultModule('entries', 'entries'),
      defaultModule('summary', 'summary'),
      defaultModule('blind', 'blind'),
      defaultModule('projects', 'projects'),
      defaultModule('notes', 'notes'),
      defaultModule('tags', 'tags'),
    ],
  };
}

function normalizeModule(raw: any, used: Set<string>): HomeModule | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = MODULE_LIBRARY.some((m) => m.type === raw.type) ? raw.type as HomeModuleType : null;
  if (!type) return null;
  const meta = metaOfType(type);
  let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : uid('hm-');
  if (used.has(id)) id = uid('hm-');
  used.add(id);
  const span: HomeSpan = [4, 6, 8, 12].includes(Number(raw.span)) ? Number(raw.span) as HomeSpan : meta.defaultSpan;
  const options: HomeModuleOptions = { ...meta.defaultOptions, ...(raw.options && typeof raw.options === 'object' ? raw.options : {}) };
  if (options.limit !== undefined) options.limit = Math.max(1, Math.min(30, Math.round(Number(options.limit) || meta.defaultOptions.limit || 8)));
  if (options.filter && !['all', 'done', 'doing', 'blocked'].includes(options.filter)) options.filter = 'all';
  if (options.zone && !['all', 'inspiration', 'review'].includes(options.zone)) options.zone = 'all';
  if (!Array.isArray(options.actions)) options.actions = meta.defaultOptions.actions ? [...meta.defaultOptions.actions] : [];
  options.actions = options.actions.filter((a) => QUICK_ACTIONS.some((q) => q.key === a));
  return {
    id,
    type,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 24) : meta.defaultTitle,
    enabled: raw.enabled !== false,
    span,
    options,
  };
}

function normalizeConfig(raw: any): HomeConfig {
  const base = defaultHomeConfig();
  if (!raw || typeof raw !== 'object') return base;
  const used = new Set<string>();
  const modules = Array.isArray(raw.modules)
    ? raw.modules.map((m: any) => normalizeModule(m, used)).filter(Boolean) as HomeModule[]
    : [];
  return {
    version: 1,
    mode: raw.mode === 'list' ? 'list' : 'grid',
    compact: Boolean(raw.compact),
    editing: false,
    modules: modules.length ? modules : base.modules,
  };
}

function readConfig(): HomeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeConfig(JSON.parse(raw)) : defaultHomeConfig();
  } catch (_) {
    return defaultHomeConfig();
  }
}

export const home = reactive<HomeConfig>(readConfig());

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      mode: home.mode,
      compact: home.compact,
      modules: home.modules,
    }));
  } catch (_) { /* 隐私模式下只保留本次会话 */ }
}

export function moduleMeta(type: HomeModuleType): HomeModuleMeta {
  return metaOfType(type);
}

export function setHomeEditing(value: boolean): void {
  home.editing = value;
}

export function setHomeMode(mode: 'grid' | 'list'): void {
  home.mode = mode;
  persist();
}

export function setHomeCompact(value: boolean): void {
  home.compact = value;
  persist();
}

export function addHomeModule(type: HomeModuleType): HomeModule {
  const mod = defaultModule(type);
  home.modules.push(mod);
  persist();
  return mod;
}

export function duplicateHomeModule(id: string): HomeModule | null {
  const index = home.modules.findIndex((m) => m.id === id);
  if (index < 0) return null;
  const source = home.modules[index];
  const copy: HomeModule = {
    ...source,
    id: uid('hm-'),
    title: `${source.title} 副本`.slice(0, 24),
    options: { ...source.options, actions: source.options.actions ? [...source.options.actions] : undefined },
  };
  home.modules.splice(index + 1, 0, copy);
  persist();
  return copy;
}

export function removeHomeModule(id: string): void {
  const index = home.modules.findIndex((m) => m.id === id);
  if (index < 0) return;
  home.modules.splice(index, 1);
  persist();
}

export function updateHomeModule(id: string, patch: Partial<HomeModule>): void {
  const mod = home.modules.find((m) => m.id === id);
  if (!mod) return;
  Object.assign(mod, patch);
  persist();
}

export function updateHomeModuleOptions(id: string, patch: Partial<HomeModuleOptions>): void {
  const mod = home.modules.find((m) => m.id === id);
  if (!mod) return;
  mod.options = { ...mod.options, ...patch };
  persist();
}

export function toggleHomeModule(id: string): void {
  const mod = home.modules.find((m) => m.id === id);
  if (!mod) return;
  mod.enabled = !mod.enabled;
  persist();
}

/** 把 fromId 移到 targetId 前 / 后 */
export function moveHomeModule(fromId: string, targetId: string, side: 'before' | 'after' = 'before'): void {
  if (fromId === targetId) return;
  const from = home.modules.findIndex((m) => m.id === fromId);
  if (from < 0) return;
  const [item] = home.modules.splice(from, 1);
  let target = home.modules.findIndex((m) => m.id === targetId);
  if (target < 0) {
    home.modules.push(item);
  } else {
    if (side === 'after') target += 1;
    home.modules.splice(target, 0, item);
  }
  persist();
}

export function moveHomeModuleBy(id: string, delta: number): void {
  const index = home.modules.findIndex((m) => m.id === id);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= home.modules.length) return;
  const [item] = home.modules.splice(index, 1);
  home.modules.splice(next, 0, item);
  persist();
}

export function resetHomeConfig(): void {
  const fresh = defaultHomeConfig();
  home.version = fresh.version;
  home.mode = fresh.mode;
  home.compact = fresh.compact;
  home.modules = fresh.modules;
  persist();
}

export function exportHomeConfig(): string {
  return JSON.stringify({
    version: 1,
    mode: home.mode,
    compact: home.compact,
    modules: home.modules,
  }, null, 2);
}

export function importHomeConfig(text: string): boolean {
  try {
    const next = normalizeConfig(JSON.parse(text));
    home.version = next.version;
    home.mode = next.mode;
    home.compact = next.compact;
    home.modules = next.modules;
    persist();
    return true;
  } catch (_) {
    return false;
  }
}
