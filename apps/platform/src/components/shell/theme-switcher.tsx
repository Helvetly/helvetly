'use client'

import { cn } from '@helvetly/ui/lib/utils'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useSyncExternalStore } from 'react'

import { ShortcutKeys } from '@/components/shortcuts/shortcut-keys'

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

// The stored theme is only known in the browser; render no selection on the server.
const subscribeNever = () => () => {}

/** A three-way Light / Dark / System segmented switch, e.g. inside the account menu. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )
  const current = mounted ? (theme ?? 'system') : undefined

  return (
    <div className={cn('flex items-center justify-between gap-3 px-2 py-1.5', className)}>
      <span aria-hidden className="flex items-center gap-2 text-sm">
        Theme
        <ShortcutKeys id="theme" />
      </span>
      <fieldset className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
        <legend className="sr-only">Theme</legend>
        {THEMES.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            // Inside the account menu: a menu may hold only menu items, so these are its radio items.
            role="menuitemradio"
            aria-checked={current === value}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 aria-checked:bg-card aria-checked:text-foreground aria-checked:shadow-elevation-1 [&_svg]:size-4 [&_svg]:stroke-[1.6]"
          >
            <Icon />
          </button>
        ))}
      </fieldset>
    </div>
  )
}
