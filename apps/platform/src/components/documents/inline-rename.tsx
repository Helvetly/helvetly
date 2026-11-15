'use client'
import { cn } from '@helvetly/ui/lib/utils'
import { useEffect, useRef, useState } from 'react'

import { translate } from '@/lib/i18n'

/**
 * A name edited in place: the base name is selected (not the extension), Enter or leaving the
 * field saves, Escape keeps the old name.
 */
export function InlineRename({
  name,
  isFile,
  onDone,
  className,
}: {
  name: string
  isFile: boolean
  /** The new name, or null when nothing changed or it was cancelled. */
  onDone: (name: string | null) => void
  className?: string
}) {
  const [value, setValue] = useState(name)
  const input = useRef<HTMLInputElement>(null)
  const finished = useRef(false)

  useEffect(() => {
    const element = input.current
    if (!element) return
    element.focus()
    const dot = isFile ? name.lastIndexOf('.') : -1
    element.setSelectionRange(0, dot > 0 ? dot : name.length)
  }, [name, isFile])

  const finish = (save: boolean) => {
    if (finished.current) return
    finished.current = true
    const trimmed = value.trim()
    onDone(save && trimmed && trimmed !== name ? trimmed : null)
  }

  return (
    <input
      ref={input}
      aria-label={translate('name')}
      value={value}
      maxLength={255}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') finish(true)
        if (event.key === 'Escape') finish(false)
      }}
      onBlur={() => finish(true)}
      className={cn(
        'h-7 w-full min-w-0 rounded-md bg-card px-1.5 text-[13.5px] text-foreground ring-2 ring-ring/60 outline-none',
        className,
      )}
    />
  )
}
