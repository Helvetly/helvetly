'use client'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@helvetly/ui/components/tooltip'
import { translate } from '@helvetly/ui/lib/i18n'
import { cn } from '@helvetly/ui/lib/utils'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useSyncExternalStore } from 'react'

const THEMES = [
  { value: 'light', label: translate('light'), icon: Sun },
  { value: 'dark', label: translate('dark'), icon: Moon },
  { value: 'system', label: translate('system'), icon: Monitor },
] as const

// The stored theme is only known in the browser; render no selection on the server.
const subscribeNever = () => () => {}

/** Light / Dark / System as three icon buttons, the current one raised. */
export function ThemeToggle({
  className,
  inMenu = false,
}: {
  className?: string
  /** Inside a menu, which may hold only menu items, the buttons are its radio items. */
  inMenu?: boolean
}) {
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )
  const current = mounted ? (theme ?? 'system') : undefined

  return (
    // Its own provider: the website has none, and a nested one is harmless in the apps.
    <TooltipProvider>
      <fieldset
        role={inMenu ? undefined : 'radiogroup'}
        aria-label={translate('theme')}
        className={cn('flex w-fit items-center gap-0.5 rounded-lg bg-muted p-0.5', className)}
      >
        {THEMES.map(({ value, label, icon: Icon }) => (
          <Tooltip key={value}>
            <TooltipTrigger asChild>
              <button
                type="button"
                role={inMenu ? 'menuitemradio' : 'radio'}
                aria-checked={current === value}
                aria-label={label}
                onClick={() => setTheme(value)}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 aria-checked:bg-card aria-checked:text-foreground aria-checked:shadow-elevation-1 [&_svg]:size-4 [&_svg]:stroke-[1.6]"
              >
                <Icon aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </fieldset>
    </TooltipProvider>
  )
}
