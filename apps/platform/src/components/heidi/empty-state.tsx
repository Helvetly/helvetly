'use client'

import { HeidiOrb } from '@helvetly/ui/components/heidi-mark'
import { Loader } from '@helvetly/ui/components/loader'
import { cn } from '@helvetly/ui/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { ArrowUp, Building2, FileText, MessageCircle, ReceiptText, Wallet } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Fragment, useEffect, useState } from 'react'

import { heidiApi, type HeidiPage } from '@/lib/heidi'
import { useSession } from '@/lib/queries'

/** The welcome's staggered entrance; each part adds its delay and slide. */
const enter =
  'animate-in duration-700 ease-out fill-mode-backwards fade-in motion-reduce:animate-none'

/** Milliseconds per typed letter, and the pause before the first one. */
const TYPE_MS = 32
const TYPE_START_MS = 250

function greeting(hour: number) {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** How many of `length` letters are typed so far: one more every few milliseconds, all at once for reduced motion. */
export function useTyping(length: number) {
  const [typed, setTyped] = useState(() => (prefersReducedMotion() ? length : 0))
  useEffect(() => {
    if (typed >= length) return
    const timer = setTimeout(() => setTyped((n) => n + 1), typed === 0 ? TYPE_START_MS : TYPE_MS)
    return () => clearTimeout(timer)
  }, [typed, length])
  return Math.min(typed, length)
}

type Part = { text: string; className?: string }

/**
 * Lines typed letter by letter behind a caret. The untyped rest is already laid out, only hidden, so
 * nothing moves while it types; the caret fades away at the end.
 */
function Typewriter({ lines }: { lines: Part[][] }) {
  const total = lines.flat().reduce((sum, part) => sum + part.text.length, 0)
  const typed = useTyping(total)
  // Where each part starts and ends in the whole text, and the one part the caret follows: the first
  // not typed to its end.
  const spans = lines.map((parts, line) =>
    parts.map((part, i) => {
      const start = lines
        .flat()
        .slice(0, lines.slice(0, line).flat().length + i)
        .reduce((sum, before) => sum + before.text.length, 0)
      return { part, start, end: start + part.text.length }
    }),
  )
  const caretAt = spans.flat().find(({ end }) => typed <= end)
  // Keys from where each piece sits in the text: stable, and unique since no two share a start and text.
  return spans.map((parts) => (
    <span
      key={`${parts[0]?.start ?? 0}:${parts.map(({ part }) => part.text).join('')}`}
      className="block"
    >
      {parts.map(({ part, start }) => {
        const shown = Math.max(0, Math.min(part.text.length, typed - start))
        return (
          <Fragment key={`${start}:${part.text}`}>
            <span className={part.className}>{part.text.slice(0, shown)}</span>
            {caretAt?.start === start && caretAt.part === part && <Caret done={typed === total} />}
            <span className={cn(part.className, 'invisible')}>{part.text.slice(shown)}</span>
          </Fragment>
        )
      })}
    </span>
  ))
}

function Caret({ done }: { done: boolean }) {
  return (
    <span aria-hidden data-caret className="relative">
      <span
        className={cn(
          'absolute -bottom-[0.05em] left-0.5 h-[0.95em] w-0.5 rounded-full bg-heidi/70',
          done && 'animate-out delay-500 duration-500 fill-mode-forwards fade-out',
        )}
      />
    </span>
  )
}

/** Before the first question: a greeting and what to ask, the current page's topics first. */
export function EmptyState({
  page,
  wide,
  onPick,
}: {
  page: HeidiPage
  wide: boolean
  onPick: (prompt: string) => void
}) {
  const [hour] = useState(() => new Date().getHours())
  const user = useSession().data?.user
  const firstName = user?.name.split(' ')[0] || user?.email.split('@')[0]
  // A client's drawer is open on the clients list as ?id=…; its own questions come first.
  const openClient = useSearchParams()?.get('id')
  const client = page === 'clients' ? (openClient ?? undefined) : undefined
  const suggestions = useQuery({
    queryKey: ['heidi', 'suggestions', page, client],
    queryFn: () => heidiApi.suggestions(page, client),
    staleTime: 5 * 60_000,
  })
  const hello = `${greeting(hour)}${firstName ? `, ${firstName}` : ''}`

  return (
    <div className="flex flex-1 flex-col py-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        <div className={cn(enter, 'zoom-in-90')}>
          <HeidiOrb />
        </div>
        <div className="grid gap-2">
          <h2
            aria-label={`${hello}. What’s on your mind?`}
            className="text-page leading-[1.15] font-medium tracking-[-0.025em] text-balance @sm/heidi:text-display @sm/heidi:leading-[1.15]"
          >
            <span aria-hidden>
              <Typewriter
                lines={[
                  [{ text: hello }],
                  [
                    { text: 'What’s on ' },
                    {
                      text: 'your mind?',
                      className:
                        'bg-linear-to-r from-heidi-from to-heidi-to bg-clip-text text-transparent',
                    },
                  ],
                ]}
              />
            </span>
          </h2>
          <p
            className={cn(
              'mx-auto line-clamp-2 max-w-80 text-body-sm leading-relaxed text-pretty text-muted-foreground @sm/heidi:text-body @sm/heidi:leading-relaxed',
              enter,
              'delay-300 slide-in-from-bottom-1',
            )}
          >
            Ask about invoices, clients, expenses and VAT, or how Helvetly works.
          </p>
        </div>
      </div>
      <section
        aria-labelledby="heidi-suggestions"
        className={cn(enter, 'delay-400 slide-in-from-bottom-2')}
      >
        <h3 id="heidi-suggestions" className="px-2 pb-1.5 text-caption text-muted-foreground">
          Try asking
        </h3>
        <ul
          className={cn(
            'grid grid-cols-[minmax(0,1fr)] gap-0.5',
            wide && '@2xl/heidi:grid-cols-2 @2xl/heidi:gap-x-2',
          )}
        >
          {suggestions.data ? (
            suggestions.data.data.slice(0, wide ? 6 : 4).map(({ title, prompt }) => {
              const Icon = topicIcon(`${title} ${prompt}`)
              return (
                <li key={prompt}>
                  <button
                    type="button"
                    onClick={() => onPick(prompt)}
                    className="group flex h-11 w-full items-center gap-3 rounded-xl px-2 text-left transition-colors duration-150 outline-none hover:bg-heidi-soft/45 focus-visible:bg-heidi-soft/45 active:bg-heidi-soft/70 dark:hover:bg-heidi/15 dark:focus-visible:bg-heidi/15"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground shadow-elevation-1 transition-colors duration-150 group-hover:text-heidi [&_svg]:size-4 [&_svg]:stroke-[1.6]">
                      <Icon />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-body-sm @sm/heidi:text-body">
                      {prompt}
                    </span>
                    <ArrowUp className="size-4 shrink-0 rotate-45 text-heidi opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
                  </button>
                </li>
              )
            })
          ) : (
            <li>
              <Loader className="min-h-44" />
            </li>
          )}
        </ul>
      </section>
    </div>
  )
}

/** A suggestion's icon, from the topic it is about. */
function topicIcon(text: string) {
  const t = text.toLowerCase()
  if (t.includes('client')) return Building2
  if (t.includes('invoice') || t.includes('revenue')) return ReceiptText
  if (t.includes('expense')) return Wallet
  if (t.includes('document') || t.includes('pdf') || t.includes('template')) return FileText
  return MessageCircle
}
