/** 知行 · 接口封装（与 docs/API.md 一一对应） */

import { http, qs } from './http';
import type {
  Attachment, DayLog, Entry, Enums, ImportSummary, ImageRef, MigrateInspect, Note, NoteStats, Overview,
  Project, RulerData, SearchResults, Settings, Snapshot, StorageInfo, Template, WorkStats, BlindCard,
} from '../types';

type Ok<T> = { ok: true } & T;

/* ------------------------------------------------------------ 基础 */

const base = {
  health: () => http.get<Ok<{ app: string; version: number; notes: number; entries: number; projects: number }>>('/api/health'),
  enums: () => http.get<Ok<Enums>>('/api/enums'),
  settings: {
    get: () => http.get<Ok<{ settings: Settings }>>('/api/settings'),
    save: (patch: Partial<Settings>) => http.put<Ok<{ settings: Settings }>>('/api/settings', patch),
  },
  overview: (date?: string) => http.get<Ok<Overview>>(`/api/overview${qs({ date })}`),
  search: (q: string, limit = 8) => http.get<Ok<SearchResults>>(`/api/search${qs({ q, limit })}`),
};

/* ------------------------------------------------------------ 笔记 */

export interface NoteQuery {
  q?: string;
  tag?: string;
  type?: string;
  zone?: string;
  stage?: string;
  status?: 'open' | 'settled' | 'inbox';
  growth?: 'pending';
  days?: number;
  desk?: string;
  incomplete?: number;
  projectId?: string;
  entryId?: string;
  pinned?: number;
}

export type NoteInput = Partial<Pick<Note,
  'zone' | 'type' | 'stage' | 'content' | 'seen' | 'think' | 'bet' | 'did' | 'skipReason' | 'trade' |
  'callRight' | 'after' | 'growth' | 'growthAt' | 'triage' | 'derivedFrom' | 'tags' | 'images' |
  'pinned' | 'projectId' | 'entryId'>> & { result?: { outcome: string; note?: string }; revision?: { reason: string } };

export const notes = {
  list: (query: NoteQuery = {}) =>
    http.get<Ok<{ notes: Note[]; total: number; desk?: Record<string, number> }>>(`/api/notes${qs(query as any)}`),
  create: (body: NoteInput) => http.post<Ok<{ note: Note }>>('/api/notes', body),
  get: (id: string) => http.get<Ok<{ note: Note; refs: any[]; backrefs: any[]; incomplete: string[] }>>(`/api/notes/${id}`),
  patch: (id: string, body: NoteInput) => http.patch<Ok<{ note: Note }>>(`/api/notes/${id}`, body),
  remove: (id: string) => http.del<Ok<{ id: string }>>(`/api/notes/${id}`),
  result: (id: string, body: { outcome: string; note?: string; mistake?: string | null; callRight?: string | null }) =>
    http.post<Ok<{ note: Note }>>(`/api/notes/${id}/result`, body),
  after: (id: string, text: string) => http.post<Ok<{ note: Note }>>(`/api/notes/${id}/after`, { text }),
  comments: {
    list: (id: string) => http.get<Ok<{ comments: Note['comments'] }>>(`/api/notes/${id}/comments`),
    add: (id: string, text: string) => http.post<Ok<{ comment: Note['comments'][number] }>>(`/api/notes/${id}/comments`, { text }),
    remove: (id: string, cid: string) => http.del<Ok<{}>>(`/api/notes/${id}/comments/${cid}`),
  },
  stats: (zone: string) => http.get<Ok<NoteStats>>(`/api/stats/notes${qs({ zone })}`),
};

export const review = {
  week: (days = 7) => http.get<Ok<{ picks: any[] }>>(`/api/review/week${qs({ days })}`),
  next: () => http.get<Ok<{ card: BlindCard | null; ageMin: number; pool: number; lastReviewAt: number }>>('/api/review/next'),
  reveal: (id: string) => http.get<Ok<{ reveal: { think: string; bet: any; result: any; after: any; createdAt: number } }>>(`/api/review/${id}/reveal`),
  verdict: (id: string, body: { verdict: string; newThink?: string; newConf?: number | null }) =>
    http.post<Ok<{ note: Note }>>(`/api/review/${id}/verdict`, body),
  ruler: () => http.get<Ok<RulerData>>('/api/ruler'),
};

/* ------------------------------------------------------------ 工作记录 */

export interface EntryInput {
  date?: string;
  title?: string;
  projectId?: string | null;
  minutes?: number;
  status?: string;
  priority?: number;
  tags?: string[];
  note?: string;
  subtasks?: { id?: string; text: string; done?: boolean }[];
  attachmentIds?: string[];
}

export const work = {
  entries: {
    list: (query: { from?: string; to?: string; date?: string; projectId?: string; q?: string; includeDeleted?: number; limit?: number } = {}) =>
      http.get<Ok<{ entries: Entry[]; total: number }>>(`/api/work/entries${qs(query)}`),
    create: (body: EntryInput) => http.post<Ok<{ entry: Entry }>>('/api/work/entries', body),
    update: (id: string, body: EntryInput) => http.patch<Ok<{ entry: Entry }>>(`/api/work/entries/${id}`, body),
    remove: (id: string) => http.del<Ok<{ id: string; deletedAt: number }>>(`/api/work/entries/${id}`),
    restore: (id: string) => http.post<Ok<{ entry: Entry }>>(`/api/work/entries/${id}/restore`),
    purge: (id: string) => http.del<Ok<{ id: string }>>(`/api/work/entries/${id}/purge`),
    copy: (from: string, to: string) => http.post<Ok<{ copied: number }>>('/api/work/entries/copy', { from, to }),
    move: (id: string, date: string) => http.post<Ok<{ entry: Entry }>>('/api/work/entries/move', { id, date }),
    attach: (id: string, ids: string[]) => http.post<Ok<{ entry: Entry }>>(`/api/work/entries/${id}/attachments`, { ids }),
  },
  days: {
    list: (from: string, to: string) => http.get<Ok<{ days: DayLog[] }>>(`/api/work/days${qs({ from, to })}`),
    summary: (date: string, summary: string) => http.put<Ok<{ day: DayLog | null }>>(`/api/work/days/${date}`, { summary }),
  },
  projects: {
    list: (includeArchived = false) => http.get<Ok<{ projects: Project[] }>>(`/api/work/projects${qs({ includeArchived: includeArchived ? 1 : undefined })}`),
    create: (body: Partial<Project>) => http.post<Ok<{ project: Project }>>('/api/work/projects', body),
    update: (id: string, body: Partial<Project>) => http.patch<Ok<{ project: Project }>>(`/api/work/projects/${id}`, body),
    remove: (id: string, transferTo?: string | null) =>
      http.del<Ok<{ id: string; movedEntries: number; movedNotes: number }>>(`/api/work/projects/${id}${qs({ transferTo: transferTo === undefined ? undefined : (transferTo || 'none') })}`),
    merge: (id: string, targetId: string) => http.post<Ok<{}>>(`/api/work/projects/${id}/merge`, { targetId }),
    reorder: (ids: string[]) => http.post<Ok<{}>>('/api/work/projects/reorder', { ids }),
  },
  templates: {
    list: () => http.get<Ok<{ templates: Template[] }>>('/api/work/templates'),
    create: (body: Partial<Template>) => http.post<Ok<{ template: Template }>>('/api/work/templates', body),
    update: (id: string, body: Partial<Template>) => http.patch<Ok<{ template: Template }>>(`/api/work/templates/${id}`, body),
    remove: (id: string) => http.del<Ok<{}>>(`/api/work/templates/${id}`),
    use: (id: string, date: string) => http.post<Ok<{ entry: Entry; template: Template }>>(`/api/work/templates/${id}/use`, { date }),
  },
  trash: {
    list: () => http.get<Ok<{ entries: Entry[]; expiresInDays: number }>>('/api/work/trash'),
    empty: () => http.post<Ok<{}>>('/api/work/trash/empty'),
  },
  stats: (from?: string, to?: string) => http.get<Ok<WorkStats>>(`/api/stats/work${qs({ from, to })}`),
};

/* ------------------------------------------------------------ 附件 */

export const media = {
  /** 笔记正文图片：只落文件，不建附件行 */
  upload: (body: { data: string; w?: number; h?: number }) =>
    http.post<Ok<{ image: ImageRef }>>('/api/media', body, { timeout: 60000 }),
};

export const attachments = {
  upload: (body: { name: string; entryId?: string | null; date: string; data: string; thumb?: string | null; w?: number; h?: number }) =>
    http.post<Ok<{ attachment: Attachment }>>('/api/attachments', body, { timeout: 60000 }),
  remove: (id: string) => http.del<Ok<{}>>(`/api/attachments/${id}`),
  purge: (id: string) => http.del<Ok<{}>>(`/api/attachments/${id}/purge`),
  url: (id: string, download = false) => `/api/attachments/${id}${download ? '?download=1' : ''}`,
};

/* ------------------------------------------------------------ 洞察 / 导出 / 导入 / 维护 */

export const insights = {
  all: (query: { from?: string; to?: string; zone?: string } = {}) =>
    http.get<Ok<{ work: WorkStats; notes: NoteStats; ruler: RulerData }>>(`/api/insights${qs(query)}`),
};

export function exportUrl(format: string, params: Record<string, any> = {}): string {
  return `/api/export${qs({ format, ...params })}`;
}

export const transfer = {
  exportUrl,
  import: (files: { name: string; data: string }[], mode: 'merge' | 'replace', dryRun: boolean, confirmReplace = false) =>
    http.post<Ok<ImportSummary>>('/api/import', { files, mode, dryRun, confirmReplace }, { timeout: 120000 }),
};

export const system = {
  snapshots: {
    list: () => http.get<Ok<{ snapshots: Snapshot[]; keep: number }>>('/api/snapshots'),
    create: (reason?: string) => http.post<Ok<{ snapshot: Snapshot }>>('/api/snapshots', { reason }),
    restore: (name: string) => http.post<Ok<{ restored: string }>>(`/api/snapshots/${encodeURIComponent(name)}/restore`),
    remove: (name: string) => http.del<Ok<{}>>(`/api/snapshots/${encodeURIComponent(name)}`),
  },
  storage: () => http.get<Ok<StorageInfo>>('/api/storage'),
  cleanup: () => http.post<Ok<{ purgedEntries: number; removedFiles: number; snapshots: number }>>('/api/cleanup'),
  inspectMigration: () => http.get<Ok<MigrateInspect>>('/api/migrate/inspect'),
  migrateInspiration: (dryRun: boolean) => http.post<Ok<{ notes: number; imported: number; images: number; duplicates: number; totalAfter: number }>>('/api/migrate/inspiration', { dryRun }),
  clearDemo: () => http.post<Ok<{ cleared: boolean }>>('/api/demo/clear'),
};

/** 一个对象上同时挂着基础接口与各模块，视图里统一用 api.xxx */
export const api = Object.assign(base, {
  notes, work, review, media, attachments, insights, transfer, system,
});

export default api;