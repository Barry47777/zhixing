/** 知行 · 路由（hash，刷新后仍停在原页） */

import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/today' },
  {
    path: '/today',
    name: 'today',
    component: () => import('./views/TodayView.vue'),
    meta: { title: '今日', subtitle: '把今天摊开看', icon: 'today', skin: 'studio' },
  },
  {
    path: '/calendar',
    name: 'calendar',
    component: () => import('./views/CalendarView.vue'),
    meta: { title: '日历', subtitle: '记录每一天', icon: 'calendar', skin: 'studio' },
  },
  {
    path: '/notes',
    name: 'notes',
    component: () => import('./views/NotesView.vue'),
    meta: { title: '灵感', subtitle: '随手记下，等它长出来', icon: 'spark', skin: 'edge', zone: 'inspiration' },
  },
  {
    path: '/review',
    name: 'review',
    component: () => import('./views/ReviewView.vue'),
    meta: { title: '复盘', subtitle: '当时怎么想，后来对不对', icon: 'review', skin: 'edge', zone: 'review' },
  },
  {
    path: '/projects',
    name: 'projects',
    component: () => import('./views/ProjectsView.vue'),
    meta: { title: '项目', subtitle: '用颜色区分手上的事', icon: 'folder', skin: 'studio' },
  },
  {
    path: '/insights',
    name: 'insights',
    component: () => import('./views/StatsView.vue'),
    meta: { title: '统计', subtitle: '时间去了哪里，判断准不准', icon: 'chart', skin: 'studio' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('./views/SettingsView.vue'),
    meta: { title: '设置', subtitle: '外观、偏好与数据安全', icon: 'settings', skin: 'studio' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/today' },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

export default router;
