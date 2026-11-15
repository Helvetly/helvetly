'use client'

import { ThemeToggle } from '@helvetly/ui/components/theme-toggle'
import { cn } from '@helvetly/ui/lib/utils'

import { ShortcutKeys } from '@/components/shortcuts/shortcut-keys'

/** The account menu's Theme row: its label and shortcut, then the Light / Dark / System switch. */
export function ThemeSwitcher({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-2 py-1.5', className)}>
      <span aria-hidden className="flex items-center gap-2 text-sm">
        Theme
        <ShortcutKeys id="theme" />
      </span>
      <ThemeToggle inMenu />
    </div>
  )
}
