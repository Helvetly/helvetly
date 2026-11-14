'use client'

import { useTheme } from 'next-themes'
import { toast } from 'sonner'

import { useShortcut } from '@/lib/shortcuts'

const ORDER = ['light', 'dark', 'system'] as const
const NAMES = { light: 'Light', dark: 'Dark', system: 'System' }

/** The theme after `theme` in light → dark → system → light. */
export function nextTheme(theme: string | undefined) {
  const index = ORDER.findIndex((value) => value === theme)
  return ORDER[(index + 1) % ORDER.length] ?? 'light'
}

/** D cycles the theme; a toast names it, since System may look the same as before. */
export function ThemeShortcut() {
  const { theme, setTheme } = useTheme()
  useShortcut('theme', () => {
    const next = nextTheme(theme ?? 'system')
    setTheme(next)
    toast(`Theme: ${NAMES[next]}`, { id: 'theme-shortcut' })
  })
  return null
}
