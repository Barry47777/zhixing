/** 知行 · 全局 UI 状态：Toast、确认框、抽屉与搜索面板 */

import { reactive } from 'vue';

export interface ToastItem {
  id: number;
  message: string;
  tone: 'default' | 'success' | 'warn' | 'error';
  actionLabel?: string;
  onAction?: () => void;
  leaving?: boolean;
}

export interface ConfirmExtra {
  label: string;
  options: { value: string; label: string }[];
  value: string;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  extra?: ConfirmExtra;
}

export interface ConfirmState extends ConfirmOptions {
  resolve: (v: { ok: boolean; extraValue?: string }) => void;
}

let seq = 1;

export const ui = reactive({
  toasts: [] as ToastItem[],
  confirm: null as ConfirmState | null,
  searchOpen: false,
  entryDrawer: { open: false, date: '', entryId: null as string | null },
  noteCompose: { open: false, zone: 'inspiration' as 'inspiration' | 'review' },
  commandOpen: false,
  booting: true,
});

export function toast(message: string, tone: ToastItem['tone'] = 'default', action?: { label: string; run: () => void }, ttl = 0): number {
  const id = seq++;
  const item: ToastItem = {
    id, message, tone,
    actionLabel: action?.label,
    onAction: action?.run,
  };
  ui.toasts.push(item);
  const life = ttl || (action ? 6000 : 2800);
  window.setTimeout(() => dismissToast(id), life);
  return id;
}

export function dismissToast(id: number): void {
  const item = ui.toasts.find((t) => t.id === id);
  if (!item || item.leaving) return;
  item.leaving = true;
  window.setTimeout(() => {
    const i = ui.toasts.indexOf(item);
    if (i >= 0) ui.toasts.splice(i, 1);
  }, 180);
}

export function confirmDialog(options: ConfirmOptions): Promise<{ ok: boolean; extraValue?: string }> {
  return new Promise((resolve) => {
    if (ui.confirm) ui.confirm.resolve({ ok: false });
    ui.confirm = { ...options, resolve };
  });
}

export function settleConfirm(ok: boolean): void {
  const cur = ui.confirm;
  if (!cur) return;
  ui.confirm = null;
  cur.resolve({ ok, extraValue: cur.extra?.value });
}

export function openEntryDrawer(date: string, entryId: string | null = null): void {
  ui.entryDrawer.date = date;
  ui.entryDrawer.entryId = entryId;
  ui.entryDrawer.open = true;
}

export function closeEntryDrawer(): void {
  ui.entryDrawer.open = false;
  ui.entryDrawer.entryId = null;
}