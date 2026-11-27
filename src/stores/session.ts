import { reactive } from 'vue'
import { todayKey } from '../utils/date'
import { startOfMonth } from 'date-fns'

export const session = reactive({
  /** 当前浏览的月份（取每月 1 号） */
  cursor: startOfMonth(new Date()),
  selected: todayKey() as string | null,
  drawerDate: null as string | null,
  filterProject: null as string | null,
  search: '',
  /** 抽屉里的编辑态 */
  editingEntryId: null as string | null,
})

export function openDrawer(date: string): void {
  session.drawerDate = date
  session.selected = date
  session.editingEntryId = null
}

export function closeDrawer(): void {
  session.drawerDate = null
  session.editingEntryId = null
}

export function setCursor(d: Date): void {
  session.cursor = startOfMonth(d)
}

export function selectDate(date: string): void {
  session.selected = date
}
