/** 知行 · 共享类型 */

export type Zone = 'inspiration' | 'review';
export type NoteType = 'review' | 'strategy' | 'insight' | 'idea';
export type Stage = 'idea' | 'judgment' | 'trade';
export type Did = 'acted' | 'skipped' | 'none';
export type Outcome = 'right' | 'wrong' | 'unclear';
export type Growth = 'up' | 'equal' | 'down';
export type Side = 'long' | 'short' | 'flat';
export type Horizon = 'intraday' | '3d' | '1w' | '1m' | '3m';
export type Triage = 'inbox' | 'filed';
export type EntryStatus = 'done' | 'doing' | 'blocked';
export type ProjectStatus = 'active' | 'paused' | 'archived';

export interface ImageRef { url: string; w?: number; h?: number }

export interface Comment { id: string; text: string; at: number }

export interface Revisions { at: number; field: string; before: string; reason: string }

export interface Trade {
  symbol?: string;
  side?: Side;
  pnl?: number | null;
  rating?: number | null;
  qty?: number | null;
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
  risk?: number | null;
  rMultiple?: number | null;
  mistake?: string | null;
}

export interface Bet {
  conf?: number | null;
  horizon?: Horizon | null;
  invalid?: string;
}

export interface Result { outcome: Outcome; note: string; at: number }
export interface After { text: string; at: number }

export interface Note {
  id: string;
  seq: number;
  zone: Zone;
  type: NoteType;
  stage: Stage | null;
  content: string;
  seen: string;
  think: string;
  bet: Bet | null;
  did: Did;
  skipReason: string;
  trade: Trade | null;
  result: Result | null;
  callRight: Outcome | null;
  after: After | null;
  growth: Growth | null;
  growthAt: number | null;
  triage: Triage;
  derivedFrom: string | null;
  projectId: string | null;
  entryId: string | null;
  frozen: boolean;
  revisions: Revisions[];
  review: { at: number; verdict: string; newThink?: string; newConf?: number | null } | null;
  legacy: boolean;
  images: ImageRef[];
  comments: Comment[];
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  /** 列表视图补充 */
  refs?: { id: string; seq: number; title: string; zone: Zone }[];
  backrefs?: { id: string; seq: number; title: string; zone: Zone }[];
  incomplete?: string[];
  derivedOrphan?: boolean;
}

export interface SubTask { id: string; text: string; done: boolean }

export interface Attachment {
  id: string;
  entryId: string | null;
  date: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  url: string;
  thumbUrl: string | null;
  w?: number | null;
  h?: number | null;
}

export interface Entry {
  id: string;
  date: string;
  title: string;
  projectId: string | null;
  minutes: number;
  hours: number;
  status: EntryStatus;
  priority: 0 | 1 | 2;
  tags: string[];
  note: string;
  subtasks: SubTask[];
  attachmentIds: string[];
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
  projectName?: string;
  projectColor?: string;
  project?: { id: string; name: string; color: string } | null;
  attachments?: Attachment[];
}

export interface DayLog { date: string; summary: string; updatedAt: number }

export interface Project {
  id: string;
  name: string;
  color: string;
  status: ProjectStatus;
  note: string;
  weeklyGoalHours: number;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  order: number;
  createdAt: number;
  updatedAt: number;
  entryCount?: number;
  minutes?: number;
  noteCount?: number;
}

export interface Template {
  id: string;
  name: string;
  title: string;
  projectId: string | null;
  minutes: number;
  tags: string[];
  subtasks: string[];
  useCount: number;
  createdAt: number;
  projectName?: string;
}

export interface Settings {
  theme: 'light' | 'dark' | 'system';
  accent: string;
  density: 'cozy' | 'compact';
  fontScale: number;
  weekStart: 0 | 1;
  dailyGoalHours: number;
  defaultProjectId: string | null;
  defaultMinutes: number;
  reduceMotion: boolean;
  showWeekNumbers: boolean;
  snapshotHours: number;
  attachmentLimitMB: number;
  startView: 'today' | 'calendar' | 'notes' | 'review';
  welcomeDone: boolean;
}

export interface AccentDef { id: string; name: string; hex: string }

export interface Enums {
  zones: Zone[];
  types: NoteType[];
  stages: Stage[];
  dids: Did[];
  outcomes: Outcome[];
  growths: Growth[];
  sides: Side[];
  horizons: Horizon[];
  mistakes: string[];
  stateTags: string[];
  baseTag: string;
  tagsMax: number;
  accents: AccentDef[];
  themes: string[];
  densities: string[];
  entryStatuses: EntryStatus[];
  priorities: { value: number; label: string }[];
  startViews: string[];
  snapshotHours: number[];
  projectColors: string[];
}

export interface Overview {
  date: string;
  today: { minutes: number; hours: number; entryCount: number; doneCount: number; goalHours: number; entries: Entry[] };
  week: { start: string; minutes: number; hours: number; activeDays: number; entries: number; labels: string[]; daily: number[] };
  streakDays: number;
  notes: { today: number; week: number; inbox: number; recent: Note[] };
  review: { pending: number; dueProject: Project[]; blindCard: BlindCard | null };
  projects: Project[];
  tags: { tag: string; count: number }[];
  nextDue: Project[];
}

export interface BlindCard {
  id: string;
  seq: number;
  ageDays: number;
  stage: Stage;
  seen: string;
  think: string;
  symbol: string;
  cooldown: number;
  incomplete: string[];
  createdAt: number;
}

export interface WorkStats {
  from: string;
  to: string;
  totalHours: number;
  entryCount: number;
  dayCount: number;
  avgPerActiveDay: number;
  avgPerDay: number;
  doneCount: number;
  doingCount: number;
  blockedCount: number;
  hoursByDay: Record<string, number>;
  byProject: { id: string | null; name: string; color: string; minutes: number; count: number; share: number }[];
  heatmap: { key: string; hours: number; level: number }[];
  weekly: { start: string; label: string; hours: number; days: number[] }[];
  streakDays: number;
  topEntries: Entry[];
  tags: { tag: string; count: number; minutes: number }[];
  monthCompare: {
    hours: number; prevHours: number; deltaPct: number | null;
    activeDays: number; prevActiveDays: number; entries: number; prevEntries: number;
    done: number; prevDone: number; avg: number; prevAvg: number;
  };
}

export interface NoteStats {
  zone: Zone;
  total: number;
  week: number;
  inbox: number;
  filed?: number;
  pinned: number;
  settled?: number;
  open?: number;
  byType: Record<NoteType, number>;
  tags: { name: string; count: number }[];
  stateTags: string[];
  review?: { count: number; settled: number; wins: number; winRate: number | null; pnl: number };
}

export interface SearchResults {
  q: string;
  notes: Note[];
  entries: Entry[];
  projects: Project[];
  templates: Template[];
  total: number;
}

export interface StorageInfo {
  dataDir: string;
  bytes: number;
  files: number;
  mediaBytes: number;
  mediaFiles: number;
  notes: number;
  entries: number;
  attachments: number;
  diskFree: number | null;
  quotaHint: string;
  lastSavedAt: number;
  settings: { snapshotHours: number; attachmentLimitMB: number };
}

export interface Snapshot { name: string; size: number; createdAt: number; kind: string; reason: string }

export interface MigrateInspect {
  inspiration: { found: boolean; path: string; notes: number; mediaFiles: number; lastModified: number };
  studioLog: { found: boolean; hint: string };
  target: { notes: number; media: number };
}

export interface ImportSummary {
  ok: boolean;
  mode: string;
  kind: string;
  parsed: number;
  addable: number;
  duplicates: number;
  empty: number;
  images: number;
  errors: string[];
  notes?: Record<string, unknown>;
  work?: Record<string, unknown>;
  preview: { kind: string; title: string; sub: string; meta: string }[];
}

export interface RulerData {
  verdicts: Record<string, unknown>;
  calibration: Record<string, unknown> | unknown[];
  skipped: Record<string, unknown> | unknown[];
  funnel: Record<string, unknown> | unknown[];
  mistakes: { mistake: string; count: number }[] | Record<string, unknown>;
  callHit: Record<string, unknown>;
  growth: Record<string, unknown>;
  execution: Record<string, unknown>;
}