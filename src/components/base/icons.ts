/** 知行 · 图标集（24×24，1.6 描边，线性） */

export type IconNode =
  | { t: 'path'; d: string }
  | { t: 'circle'; cx: number; cy: number; r: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { t: 'rect'; x: number; y: number; w: number; h: number; rx?: number };

export const ICONS: Record<string, IconNode[]> = {
  today: [
    { t: 'circle', cx: 12, cy: 12, r: 3.2 },
    { t: 'path', d: 'M12 3.2v2.2M12 18.6v2.2M3.2 12h2.2M18.6 12h2.2' },
    { t: 'path', d: 'M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6' },
  ],
  calendar: [
    { t: 'rect', x: 3.4, y: 5, w: 17.2, h: 15.2, rx: 3 },
    { t: 'path', d: 'M3.4 9.6h17.2M8.2 3.4v3.4M15.8 3.4v3.4' },
    { t: 'circle', cx: 8.4, cy: 14, r: 1 },
    { t: 'circle', cx: 12.4, cy: 14, r: 1 },
    { t: 'circle', cx: 16.4, cy: 14, r: 1 },
  ],
  spark: [
    { t: 'path', d: 'M12 3.4l1.7 5.2 5.2 1.7-5.2 1.7L12 17.2l-1.7-5.2L5.1 10.3l5.2-1.7z' },
    { t: 'path', d: 'M18.6 16.4l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z' },
  ],
  review: [
    { t: 'path', d: 'M4 5.2h9.2M4 12h5.4M4 18.8h7.6' },
    { t: 'circle', cx: 16.4, cy: 6, r: 2.6 },
    { t: 'circle', cx: 14.2, cy: 17.4, r: 2.6 },
    { t: 'path', d: 'M18.8 8.5l-2.4 6.4' },
  ],
  folder: [
    { t: 'path', d: 'M3.4 7.6a2 2 0 012-2h4l2 2.2h7.2a2 2 0 012 2v7.6a2 2 0 01-2 2H5.4a2 2 0 01-2-2z' },
  ],
  chart: [
    { t: 'path', d: 'M4 20V4' },
    { t: 'path', d: 'M4 20h16' },
    { t: 'path', d: 'M8 16.4v-4.2M12.4 16.4V8.4M16.8 16.4v-6.6' },
    { t: 'path', d: 'M7.2 9.6l4.2-3.4 4 2.2 4.4-4' },
  ],
  settings: [
    { t: 'circle', cx: 12, cy: 12, r: 3 },
    { t: 'path', d: 'M19.2 12a7.2 7.2 0 00-.1-1.1l2-1.5-2-3.4-2.4 1a7.4 7.4 0 00-1.9-1.1L14.4 3h-4l-.4 2.9a7.4 7.4 0 00-1.9 1.1l-2.4-1-2 3.4 2 1.5a7.2 7.2 0 000 2.2l-2 1.5 2 3.4 2.4-1a7.4 7.4 0 001.9 1.1l.4 2.9h4l.4-2.9a7.4 7.4 0 001.9-1.1l2.4 1 2-3.4-2-1.5c.07-.36.1-.73.1-1.1z' },
  ],
  search: [
    { t: 'circle', cx: 10.6, cy: 10.6, r: 6.4 },
    { t: 'path', d: 'M15.4 15.4l4.4 4.4' },
  ],
  plus: [{ t: 'path', d: 'M12 5v14M5 12h14' }],
  close: [{ t: 'path', d: 'M6.2 6.2l11.6 11.6M17.8 6.2L6.2 17.8' }],
  chevronLeft: [{ t: 'path', d: 'M14.6 5.8L8.4 12l6.2 6.2' }],
  chevronRight: [{ t: 'path', d: 'M9.4 5.8L15.6 12l-6.2 6.2' }],
  chevronDown: [{ t: 'path', d: 'M6 9.4l6 6 6-6' }],
  chevronUp: [{ t: 'path', d: 'M6 14.6l6-6 6 6' }],
  check: [{ t: 'path', d: 'M5.4 12.4l4.2 4.2L18.8 7.4' }],
  edit: [
    { t: 'path', d: 'M4 20h4.2L19.4 8.8a2.1 2.1 0 00-3-3L5.2 17z' },
    { t: 'path', d: 'M13.8 6.2l4 4' },
  ],
  trash: [
    { t: 'path', d: 'M4.4 6.8h15.2M9.4 6.8V4.6h5.2v2.2' },
    { t: 'path', d: 'M6.4 6.8l.9 12.2a2 2 0 002 1.9h5.4a2 2 0 002-1.9l.9-12.2' },
    { t: 'path', d: 'M10.2 10.6v6.4M13.8 10.6v6.4' },
  ],
  pin: [
    { t: 'path', d: 'M9 3.6h6l-.8 5 3.4 3.2H6.4L9.8 8.6z' },
    { t: 'path', d: 'M12 11.8v8.6' },
  ],
  comment: [
    { t: 'path', d: 'M20 12.2a7.6 7.6 0 01-8 7.6 8.4 8.4 0 01-3.4-.8L4 20l1.2-4a7.4 7.4 0 01-1.2-4 7.6 7.6 0 018-7.6 7.6 7.6 0 018 7.8z' },
  ],
  link: [
    { t: 'path', d: 'M10.2 13.8a3.4 3.4 0 004.8 0l3-3a3.4 3.4 0 00-4.8-4.8l-1.6 1.6' },
    { t: 'path', d: 'M13.8 10.2a3.4 3.4 0 00-4.8 0l-3 3a3.4 3.4 0 004.8 4.8l1.6-1.6' },
  ],
  image: [
    { t: 'rect', x: 3.6, y: 4.6, w: 16.8, h: 14.8, rx: 2.6 },
    { t: 'circle', cx: 8.8, cy: 9.4, r: 1.6 },
    { t: 'path', d: 'M4.4 17.6l4.8-4.4 3.4 3 3-2.6 3.6 3.4' },
  ],
  paperclip: [
    { t: 'path', d: 'M19 11.4l-7 7a5 5 0 01-7-7l7.4-7.4a3.4 3.4 0 014.8 4.8l-7.4 7.4a1.8 1.8 0 01-2.6-2.6l6.6-6.6' },
  ],
  clock: [
    { t: 'circle', cx: 12, cy: 12, r: 8.6 },
    { t: 'path', d: 'M12 7.4V12l3.2 2' },
  ],
  target: [
    { t: 'circle', cx: 12, cy: 12, r: 8.4 },
    { t: 'circle', cx: 12, cy: 12, r: 4.6 },
    { t: 'circle', cx: 12, cy: 12, r: 1.1 },
  ],
  flame: [
    { t: 'path', d: 'M12 3.4c3.4 3.6 5.4 6.2 5.4 9.2a5.4 5.4 0 11-10.8 0c0-1.6.6-3 1.8-4.6.6 1 1.4 1.6 2.2 1.8.2-2.4.6-4.4 1.4-6.4z' },
  ],
  arrowUpRight: [{ t: 'path', d: 'M7.4 16.6L16.6 7.4M8.6 7.4h8v8' }],
  menu: [{ t: 'path', d: 'M4 7h16M4 12h16M4 17h16' }],
  more: [
    { t: 'circle', cx: 5.6, cy: 12, r: 1.1 },
    { t: 'circle', cx: 12, cy: 12, r: 1.1 },
    { t: 'circle', cx: 18.4, cy: 12, r: 1.1 },
  ],
  download: [
    { t: 'path', d: 'M12 3.8v10.8M7.6 10.4L12 14.8l4.4-4.4' },
    { t: 'path', d: 'M4.6 17.6v1.4a1.8 1.8 0 001.8 1.8h11.2a1.8 1.8 0 001.8-1.8v-1.4' },
  ],
  upload: [
    { t: 'path', d: 'M12 20.2V9.4M7.6 13.6L12 9.2l4.4 4.4' },
    { t: 'path', d: 'M4.6 6.4V5a1.8 1.8 0 011.8-1.8h11.2A1.8 1.8 0 0119.4 5v1.4' },
  ],
  refresh: [
    { t: 'path', d: 'M19.4 12a7.4 7.4 0 01-12.4 5.4L4 14.6' },
    { t: 'path', d: 'M4.6 19.4v-4.8h4.8' },
    { t: 'path', d: 'M4.6 12a7.4 7.4 0 0112.4-5.4L20 9.4' },
    { t: 'path', d: 'M19.4 4.6v4.8h-4.8' },
  ],
  moon: [{ t: 'path', d: 'M20 14.4A8.2 8.2 0 019.6 4 8.4 8.4 0 1020 14.4z' }],
  sun: [
    { t: 'circle', cx: 12, cy: 12, r: 4 },
    { t: 'path', d: 'M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6' },
  ],
  alert: [
    { t: 'path', d: 'M12 4.2l8.4 14.2a1.4 1.4 0 01-1.2 2.1H4.8a1.4 1.4 0 01-1.2-2.1z' },
    { t: 'path', d: 'M12 9.4v4.2M12 17.2v.2' },
  ],
  inbox: [
    { t: 'path', d: 'M4 6.8A2.2 2.2 0 016.2 4.6h11.6A2.2 2.2 0 0120 6.8v10.4a2.2 2.2 0 01-2.2 2.2H6.2A2.2 2.2 0 014 17.2z' },
    { t: 'path', d: 'M4 13.4h4.4l1.2 2h4.8l1.2-2H20' },
  ],
  archive: [
    { t: 'rect', x: 3.6, y: 4.2, w: 16.8, h: 4.2, rx: 1.4 },
    { t: 'path', d: 'M5.4 8.4v10a1.8 1.8 0 001.8 1.8h9.6a1.8 1.8 0 001.8-1.8v-10' },
    { t: 'path', d: 'M9.6 12.4h4.8' },
  ],
  filter: [{ t: 'path', d: 'M4 5.4h16l-6.2 7.2v5.4l-3.6 2v-7.4z' }],
  grid: [
    { t: 'rect', x: 4, y: 4, w: 6.4, h: 6.4, rx: 1.6 },
    { t: 'rect', x: 13.6, y: 4, w: 6.4, h: 6.4, rx: 1.6 },
    { t: 'rect', x: 4, y: 13.6, w: 6.4, h: 6.4, rx: 1.6 },
    { t: 'rect', x: 13.6, y: 13.6, w: 6.4, h: 6.4, rx: 1.6 },
  ],
  list: [
    { t: 'path', d: 'M8.6 6.4h11.4M8.6 12h11.4M8.6 17.6h11.4' },
    { t: 'circle', cx: 4.6, cy: 6.4, r: 1 },
    { t: 'circle', cx: 4.6, cy: 12, r: 1 },
    { t: 'circle', cx: 4.6, cy: 17.6, r: 1 },
  ],
  masonry: [
    { t: 'rect', x: 4, y: 4, w: 6.4, h: 9.4, rx: 1.6 },
    { t: 'rect', x: 4, y: 15.4, w: 6.4, h: 4.6, rx: 1.6 },
    { t: 'rect', x: 13.6, y: 4, w: 6.4, h: 4.6, rx: 1.6 },
    { t: 'rect', x: 13.6, y: 10.6, w: 6.4, h: 9.4, rx: 1.6 },
  ],
  drag: [
    { t: 'circle', cx: 9, cy: 6, r: 1.2 },
    { t: 'circle', cx: 15, cy: 6, r: 1.2 },
    { t: 'circle', cx: 9, cy: 12, r: 1.2 },
    { t: 'circle', cx: 15, cy: 12, r: 1.2 },
    { t: 'circle', cx: 9, cy: 18, r: 1.2 },
    { t: 'circle', cx: 15, cy: 18, r: 1.2 },
  ],
  play: [{ t: 'path', d: 'M8 5.4l10 6.6-10 6.6z' }],
  eye: [
    { t: 'path', d: 'M2.8 12S6.4 5.8 12 5.8 21.2 12 21.2 12 17.6 18.2 12 18.2 2.8 12 2.8 12z' },
    { t: 'circle', cx: 12, cy: 12, r: 2.8 },
  ],
  lock: [
    { t: 'rect', x: 4.8, y: 10.4, w: 14.4, h: 9.6, rx: 2.4 },
    { t: 'path', d: 'M8.4 10.4V7.8a3.6 3.6 0 017.2 0v2.6' },
  ],
  external: [
    { t: 'path', d: 'M14.4 4.6h5v5M19.4 4.6l-7.8 7.8' },
    { t: 'path', d: 'M18.6 13.4v4.8a2 2 0 01-2 2H6.2a2 2 0 01-2-2V7.8a2 2 0 012-2h4.6' },
  ],
  command: [
    { t: 'path', d: 'M9 6.4a2.2 2.2 0 10-2.2 2.2H17a2.2 2.2 0 102.2-2.2 2.2 2.2 0 00-2.2 2.2v11a2.2 2.2 0 102.2 2.2 2.2 2.2 0 00-2.2-2.2H7a2.2 2.2 0 10-2.2 2.2A2.2 2.2 0 007 17.6z' },
  ],
  star: [{ t: 'path', d: 'M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z' }],
  users: [
    { t: 'circle', cx: 9, cy: 8.4, r: 3.4 },
    { t: 'path', d: 'M3 20a6 6 0 0112 0' },
    { t: 'path', d: 'M15.4 5.4a3.4 3.4 0 010 6M17 14.2a5.4 5.4 0 014 5.8' },
  ],
  send: [{ t: 'path', d: 'M20.4 3.6L3.6 10.2l6 2.4 2.4 6z' }, { t: 'path', d: 'M20.4 3.6L12 12.6' }],
  code: [{ t: 'path', d: 'M9 7.4L3.6 12 9 16.6M15 7.4L20.4 12 15 16.6' }],
  book: [
    { t: 'path', d: 'M4.4 5.4a2 2 0 012-2h4.4v16.2H6.4a2 2 0 01-2-2z' },
    { t: 'path', d: 'M19.6 5.4a2 2 0 00-2-2h-4.4v16.2h4.4a2 2 0 002-2z' },
  ],
};


/* 从 Studio Log 补进来的图标（原始 SVG 片段，Icon.vue 用 v-html 渲染） */
export const RAW_ICONS: Record<string, string> = {
  minus: '<path d="M5 12h14"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  restore: '<path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.4 2.6L3 8"/><path d="M3 3v5h5"/>',
  tag: '<path d="M20.5 13.5l-7 7a2 2 0 0 1-2.8 0L3 12.7V4h8.7l8.8 8.8a1 1 0 0 1 0 1.4z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  clip: '<path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M6 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M8 20h8M12 16v4"/>',
  grip: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
  folderPlus: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17z"/><path d="M12 11v6M9 14h6"/>',
  merge: '<circle cx="7" cy="7" r="3"/><circle cx="7" cy="17" r="3"/><path d="M9.5 8.5L20 17M9.5 15.5L20 7"/>',
  palette: '<path d="M12 21a9 9 0 1 1 9-9c0 2.2-1.8 3-3.5 3H16a2 2 0 0 0-1.4 3.4c.5.6.3 1.6-.4 2A6 6 0 0 1 12 21z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="11" cy="7.5" r="1.2"/><circle cx="15.5" cy="8.5" r="1.2"/>',
  shield: '<path d="M12 3l8 3v5.5c0 5-3.4 8.5-8 9.5-4.6-1-8-4.5-8-9.5V6z"/><path d="M9 12l2 2 4-4"/>',
  database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  type: '<path d="M4 6V4h16v2M12 4v16M9 20h6"/>',
  layout: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 10h18M9 10v10"/>',
  arrowRight: '<path d="M4 12h15M14 6l6 6-6 6"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.4 2.6L3 8"/><path d="M3 3v5h5M12 8v4.5l3 1.8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.2"/>',
};

export function iconPaths(name: string): IconNode[] {
  return ICONS[name] || ICONS.spark;
}