'use client'
import { Kbd, KbdGroup } from '@helvetly/ui/components/kbd'
import { keyLabels, type Keys } from '@helvetly/ui/lib/shortcuts'
import { cn } from '@helvetly/ui/lib/utils'
import { Fragment } from 'react'

import { translate } from '@/lib/i18n'
import { SHORTCUTS, useApple, type ShortcutId } from '@/lib/shortcuts'

const Word = ({ children }: { children: string }) => (
  <span className="text-caption text-muted-foreground in-data-[slot=tooltip-content]:text-background/70">
    {children}
  </span>
)

/** One way to press a shortcut: keycaps per step, "then" between the steps of a sequence. */
function KeyCaps({ keys, apple }: { keys: Keys; apple: boolean }) {
  const combos = keys.split(' ')
  return keyLabels(keys, apple).map((step, index) => (
    <Fragment key={combos[index]}>
      {index > 0 && <Word>{translate('then2')}</Word>}
      <KbdGroup>
        {step.map((label) => (
          <Kbd key={label}>{label}</Kbd>
        ))}
      </KbdGroup>
    </Fragment>
  ))
}

/**
 * A shortcut's keys as keycaps (⌘ on Apple devices, Ctrl elsewhere): the first way to press it, or all of
 * them with `all`.
 */
export function ShortcutKeys({
  id,
  all = false,
  decorative = true,
  className,
}: {
  id: ShortcutId
  all?: boolean
  /** Hidden from screen readers, beside a control that names the shortcut itself. */
  decorative?: boolean
  className?: string
}) {
  const apple = useApple()
  const alternatives = all ? SHORTCUTS[id].keys : SHORTCUTS[id].keys.slice(0, 1)
  return (
    <span
      aria-hidden={decorative || undefined}
      className={cn('inline-flex shrink-0 items-center gap-1', className)}
    >
      {alternatives.map((keys, index) => (
        <Fragment key={keys}>
          {index > 0 && <Word>{translate('or2')}</Word>}
          <KeyCaps keys={keys} apple={apple} />
        </Fragment>
      ))}
    </span>
  )
}

/** A tooltip's text with the shortcut beside it. */
export function WithShortcut({ label, id }: { label: string; id: ShortcutId }) {
  return (
    <span className="inline-flex items-center gap-2">
      {label}
      <ShortcutKeys id={id} />
    </span>
  )
}
