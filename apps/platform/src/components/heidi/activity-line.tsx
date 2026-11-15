'use client'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, ChevronRight, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { translate } from '@/lib/i18n'

import type { ChatMessage } from './use-heidi'

/** "<1s", "4s", "1m 5s": how long Heidi worked on a turn. */
export function formatDuration(ms: number) {
  if (ms < 1000) return '<1s'
  const seconds = Math.round(ms / 1000)
  return seconds < 60
    ? `${seconds}s`
    : translate('mS', { value1: Math.floor(seconds / 60), value2: seconds % 60 })
}

/** The time, every second while `running`. */
function useNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  return now
}

/**
 * While Heidi works: the step it is on, shimmering, how long it has been at it and a small spinner.
 * The text starts where "Worked for" will, so the line does not jump when the turn ends.
 */
function Working({ label, elapsed }: { label: string; elapsed: number }) {
  return (
    <div className="flex h-6 items-center gap-2 text-body-sm">
      {/* Only the step is announced, not every tick of the timer. */}
      <output
        aria-live="polite"
        aria-label={translate('heidiIsThinking')}
        className="animate-shimmer bg-[linear-gradient(90deg,var(--muted-foreground)_35%,var(--heidi)_50%,var(--muted-foreground)_65%)] bg-[length:200%_100%] bg-clip-text text-transparent motion-reduce:animate-none motion-reduce:bg-none motion-reduce:text-muted-foreground"
      >
        {label}…
      </output>
      {elapsed >= 1000 && (
        <span aria-hidden className="text-muted-foreground tabular-nums">
          {formatDuration(elapsed)}
        </span>
      )}
      <LoaderCircle
        aria-hidden
        className="size-3.5 animate-spin text-muted-foreground/70 motion-reduce:animate-none"
      />
    </div>
  )
}

/** After a turn: a muted "Worked for 4s" that opens the steps Heidi took. */
function Worked({ ms, steps }: { ms: number; steps: string[] }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const label = translate('workedFor', { value1: formatDuration(ms) })
  if (steps.length === 0)
    return <p className="flex h-6 items-center text-body-sm text-muted-foreground">{label}</p>
  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="-mx-1 flex h-6 w-fit items-center gap-0.5 rounded-sm px-1 text-body-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {label}
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3.5 transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
      </button>
      {open && (
        <ol id={listId} aria-label={translate('steps')} className="grid gap-1">
          {steps.map((step, index) => (
            <li
              // A step's text and how often it came before: stable as steps are only appended.
              key={`${step}#${steps.slice(0, index).filter((before) => before === step).length}`}
              className="flex items-center gap-1.5 text-caption text-muted-foreground"
            >
              <Check aria-hidden className="size-3 shrink-0 text-heidi/70" />
              {step}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * The muted line above an answer: what Heidi is doing and for how long while it works, then how
 * long it worked. Turns loaded from history have no timing and show nothing.
 */
export function ActivityLine({ message }: { message: ChatMessage }) {
  const streaming = message.state === 'streaming'
  const now = useNow(streaming)
  if (streaming) {
    const elapsed = (message.workedMs ?? 0) + (message.startedAt ? now - message.startedAt : 0)
    const label =
      message.status ?? (message.text ? translate('writingTheAnswer') : translate('thinking'))
    return (
      // A muted line above the answer's text: the answer has no bubble to divide.
      <div className={cn(message.text && 'mb-1.5')}>
        <Working label={label} elapsed={Math.max(0, elapsed)} />
      </div>
    )
  }
  if (message.workedMs === undefined) return null
  return (
    <div className="mb-1.5">
      <Worked ms={message.workedMs} steps={message.steps ?? []} />
    </div>
  )
}
