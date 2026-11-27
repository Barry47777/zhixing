/** 知行 · 工作区共享状态（今日概览、项目、模板） */

import { computed, reactive } from 'vue';
import { api, type EntryInput } from '../api';
import type { Overview, Project, Template } from '../types';
import { toast } from './ui';
import { todayKey } from '../utils/date';

export const workspace = reactive({
  overview: null as Overview | null,
  projects: [] as Project[],
  templates: [] as Template[],
  loading: false,
  date: todayKey(),
});

export const projectMap = computed(() => {
  const map = new Map<string, Project>();
  for (const p of workspace.projects) map.set(p.id, p);
  return map;
});

export function projectOf(id: string | null | undefined): Project | null {
  if (!id) return null;
  return projectMap.value.get(id) || null;
}

export async function refreshOverview(date?: string): Promise<void> {
  try {
    const res = await api.overview(date || workspace.date);
    workspace.overview = res;
    workspace.date = res.date;
  } catch (err: any) {
    toast(err.message || '今日概览没加载出来', 'error');
  }
}

export async function refreshProjects(includeArchived = false): Promise<void> {
  try {
    const res = await api.work.projects.list(includeArchived);
    workspace.projects = res.projects || [];
    const map = new Map(workspace.projects.map((p) => [p.id, p]));
    if (workspace.overview) {
      workspace.overview.projects = workspace.overview.projects.map((p) => map.get(p.id) || p);
    }
  } catch (err: any) {
    toast(err.message || '项目没加载出来', 'error');
  }
}

export async function refreshTemplates(): Promise<void> {
  try {
    const res = await api.work.templates.list();
    workspace.templates = res.templates || [];
  } catch (_) { /* 模板不是关键路径 */ }
}

export async function refreshWorkspace(date?: string): Promise<void> {
  workspace.loading = true;
  try {
    await Promise.all([refreshOverview(date), refreshProjects(false), refreshTemplates()]);
  } finally {
    workspace.loading = false;
  }
}

/* ------------------------------------------------------------ 记录动作 */

export async function createEntry(input: EntryInput): Promise<boolean> {
  try {
    await api.work.entries.create(input);
    await refreshOverview();
    return true;
  } catch (err: any) {
    toast(err.message || '这条没存上', 'error');
    return false;
  }
}

export async function updateEntry(id: string, input: EntryInput): Promise<boolean> {
  try {
    await api.work.entries.update(id, input);
    await refreshOverview();
    return true;
  } catch (err: any) {
    toast(err.message || '改动没存上', 'error');
    return false;
  }
}

export async function trashEntry(id: string): Promise<void> {
  try {
    await api.work.entries.remove(id);
    await refreshOverview();
    toast('已放进回收站', 'default', {
      label: '撤销',
      run: async () => {
        try { await api.work.entries.restore(id); await refreshOverview(); toast('已恢复', 'success'); }
        catch (err: any) { toast(err.message || '没能恢复', 'error'); }
      },
    });
  } catch (err: any) {
    toast(err.message || '删除失败', 'error');
  }
}

export async function moveEntry(id: string, date: string): Promise<void> {
  try {
    await api.work.entries.move(id, date);
    await refreshOverview();
    toast(`已挪到 ${date.slice(5).replace('-', ' 月 ')} 日`, 'success');
  } catch (err: any) {
    toast(err.message || '没能挪过去', 'error');
  }
}

export async function copyPreviousDay(date: string): Promise<void> {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const prev = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  try {
    const res = await api.work.entries.copy(prev, date);
    await refreshOverview(date);
    toast(res.copied ? `复制了昨天 ${res.copied} 条记录` : '昨天没有可复制的记录', res.copied ? 'success' : 'warn');
  } catch (err: any) {
    toast(err.message || '复制失败', 'error');
  }
}