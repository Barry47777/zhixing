/** 颜色工具：项目色板、强调色、对比度计算 */

export const PROJECT_COLORS = [
  '#5B7CFA', '#8B5CF6', '#EC4899', '#EF6461',
  '#F59E0B', '#10B981', '#14B8A6', '#0EA5E9',
  '#6366F1', '#84CC16', '#F97316', '#64748B',
]

/** 设置里可选强调色（沿用后端 accent id，色值按 Studio Log 的调子） */
export interface AccentDef {
  id: string
  name: string
  light: string
  dark: string
}

export const ACCENT_DEFS: AccentDef[] = [
  { id: 'teal', name: '靛蓝', light: '#4F6BED', dark: '#6D86FF' },
  { id: 'ice', name: '冰蓝', light: '#0EA5E9', dark: '#38BDF8' },
  { id: 'lime', name: '松绿', light: '#15803D', dark: '#4EC98A' },
  { id: 'amber', name: '琥珀', light: '#C2740A', dark: '#DFA443' },
  { id: 'coral', name: '玫瑰', light: '#D9405C', dark: '#F0726C' },
  { id: 'steel', name: '石墨', light: '#3F4756', dark: '#B9C0CA' },
  { id: 'magenta', name: '紫罗兰', light: '#7C5CF0', dark: '#A78BFA' },
]

/** 兼容旧代码：ACCENTS 里 value/hex 是浅色主题下的色值 */
export const ACCENTS = ACCENT_DEFS.map((a) => ({ id: a.id, name: a.name, value: a.light, hex: a.light }))

export function accentFor(id: string): AccentDef {
  return ACCENT_DEFS.find((a) => a.id === id) || ACCENT_DEFS[0]
}

export function accentHex(id: string, theme: 'light' | 'dark' = 'light'): string {
  const def = accentFor(id)
  return theme === 'dark' ? def.dark : def.light
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 相对亮度，用于决定叠在上面的文字用黑还是白 */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function readableInk(hex: string): string {
  return luminance(hex) > 0.62 ? '#1A1C20' : '#FFFFFF'
}

/** 旧接口：强调色上的文字颜色 */
export function accentInk(hex: string): string {
  return readableInk(hex)
}

/** 依据项目色生成一组同色系渐变色，用于图表/热力 */
export function tint(hex: string, amount: number): string {
  return `color-mix(in srgb, ${hex} ${Math.round(amount * 100)}%, transparent)`
}

export function projectColorOf(color: string | undefined, index = 0): string {
  return color || PROJECT_COLORS[index % PROJECT_COLORS.length]
}
