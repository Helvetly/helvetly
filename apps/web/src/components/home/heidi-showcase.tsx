'use client'

import { HeidiMark } from '@helvetly/ui/components/heidi-mark'
import { ArrowUp, Check, Mail } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/cn'

// Heidi's console: an example question types itself, she thinks, and her answer appears as the UI she
// really returns. Each example is something the real Heidi does (docs/heidi-contract.md). The figures
// are sample data. Auto-plays while on screen and not hovered; the pills pick one by hand.

const HOLD_MS = 7000

function Row({ children, d }: { children: ReactNode; d: number }) {
  return (
    <div className="pop" style={{ ['--d' as string]: `${d}ms` }}>
      {children}
    </div>
  )
}

function Overdue() {
  const rows = [
    ['RC', 'Rhein Consulting AG', '2026-0416', '9’720.00', 12, 'from-peach-solid to-rose-solid'],
    ['KB', 'Kessler Bau GmbH', '2026-0402', '3’180.00', 26, 'from-sky-solid to-lilac-solid'],
    ['AN', 'Atelier Nord', '2026-0391', '1’000.00', 41, 'from-mint-solid to-sky-solid'],
  ] as const
  return (
    <div className="flex flex-col gap-2">
      <Row d={0}>
        <p className="text-white/80">
          Three invoices are overdue, <b className="text-white">CHF 13’900.00</b> in total.
        </p>
      </Row>
      {rows.map(([initials, client, no, amount, days, tone], i) => (
        <Row key={no} d={120 + i * 110}>
          <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.04] px-3 py-2.5">
            <span
              className={cn(
                'inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br text-caption font-semibold text-white',
                tone,
              )}
            >
              {initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-white">{client}</span>
              <span className="block text-caption whitespace-nowrap text-white/50">
                {no}
                <span className="text-peach-ink sm:hidden"> · {days} days</span>
              </span>
            </span>
            <span className="text-white tabular-nums">{amount}</span>
            <span className="bg-peach-solid/15 text-peach-ink hidden rounded-full px-2 py-0.5 text-caption whitespace-nowrap sm:inline">
              {days} days
            </span>
          </div>
        </Row>
      ))}
      <Row d={480}>
        <span className="mt-1 inline-flex rounded-full border border-white/15 px-3 py-1 text-caption font-medium text-white">
          Open overdue invoices
        </span>
      </Row>
    </div>
  )
}

function Ring({ used, total }: { used: number; total: number }) {
  const r = 42
  const len = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 100 100" className="size-28 -rotate-90">
      <circle cx="50" cy="50" r={r} className="fill-none stroke-white/10" strokeWidth="9" />
      <circle
        cx="50"
        cy="50"
        r={r}
        stroke="url(#heidi-ring)"
        className="draw fill-none"
        strokeWidth="9"
        strokeLinecap="round"
        style={{
          ['--len' as string]: len,
          strokeDasharray: `${(used / total) * len} ${len}`,
          ['--d' as string]: '150ms',
        }}
      />
      <defs>
        <linearGradient id="heidi-ring">
          <stop offset="0" style={{ stopColor: 'var(--mint-solid)' }} />
          <stop offset="1" style={{ stopColor: 'var(--lilac-solid)' }} />
        </linearGradient>
      </defs>
    </svg>
  )
}

function Hours() {
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <Row d={0}>
        <div className="relative">
          <Ring used={32} total={40} />
          <span className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-title font-semibold text-white">8 h</span>
            <span className="text-caption text-white/50">left</span>
          </span>
        </div>
      </Row>
      <div className="flex w-full min-w-0 flex-1 flex-col gap-2">
        <Row d={100}>
          <p className="text-white/80">
            <b className="text-white">Monthly retainer · Studio Lumen</b>: 32 of 40 hours used.
          </p>
        </Row>
        {[
          ['Used', '32 h'],
          ['Left', '8 h'],
          ['Period ends', '30.11.2026'],
        ].map(([k, v], i) => (
          <Row key={k} d={200 + i * 100}>
            <div className="flex justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-white/70">
              <span>{k}</span>
              <span className="font-medium text-white tabular-nums">{v}</span>
            </div>
          </Row>
        ))}
      </div>
    </div>
  )
}

function Vat() {
  const tiles = [
    ['Expenses recorded', 'CHF 12’480.40', 'from-sky-solid/30'],
    ['Input VAT booked', 'CHF 846.15', 'from-mint-solid/30'],
    ['Receipts', '18', 'from-lilac-solid/30'],
  ]
  return (
    <div className="flex flex-col gap-3">
      <Row d={0}>
        <p className="text-white/80">Here is November so far, from your booked expenses:</p>
      </Row>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {tiles.map(([label, value, tone], i) => (
          <Row key={label} d={120 + i * 110}>
            <div
              className={cn(
                'rounded-xl border border-white/8 bg-linear-to-br to-transparent p-3',
                tone,
              )}
            >
              <p className="text-caption text-white/60">{label}</p>
              <p className="mt-1 text-title-sm font-semibold text-white tabular-nums">{value}</p>
            </div>
          </Row>
        ))}
      </div>
    </div>
  )
}

function Log({ done }: { done: boolean }) {
  return (
    <Row d={0}>
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
        <p className="text-caption font-medium tracking-wide text-heidi-ink uppercase">
          Please confirm
        </p>
        <p className="mt-1.5 text-white/85">
          Log <b className="text-white">2.5 h</b> on{' '}
          <b className="text-white">Monthly retainer · Studio Lumen</b> for 11.11.2026, “Homepage
          review”?
        </p>
        <div className="mt-3 flex items-center gap-2 text-caption font-medium">
          {done ? (
            <span className="pop bg-mint-solid/20 text-mint-ink inline-flex items-center gap-1.5 rounded-full px-3 py-1">
              <Check aria-hidden className="size-3.5" /> Logged · 34.5 of 40 h used
            </span>
          ) : (
            <>
              <span className="rounded-full bg-linear-to-r from-heidi-from to-heidi-via px-3 py-1 text-white">
                Log hours
              </span>
              <span className="rounded-full border border-white/15 px-3 py-1 text-white/80">
                Cancel
              </span>
            </>
          )}
        </div>
      </div>
    </Row>
  )
}

function Draft() {
  return (
    <Row d={0}>
      <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
        <div className="flex items-center gap-2 border-b border-white/8 px-4 py-2.5 text-caption text-white/60">
          <Mail aria-hidden className="size-3.5" />
          Reminder: invoice 2026-0416
        </div>
        <div className="grid gap-2 px-4 py-3 text-white/80">
          <p>Dear Mr. Weber,</p>
          <p>
            our invoice 2026-0416 of CHF 9’720.00 was due on 30 October. Could you let us know when
            we can expect the payment? The QR bill is attached again for convenience.
          </p>
          <p>Kind regards, Anna Keller</p>
        </div>
      </div>
    </Row>
  )
}

type Example = { id: string; label: string; ask: string; answer: (done: boolean) => ReactNode }

const EXAMPLES: Example[] = [
  {
    id: 'overdue',
    label: 'Overdue',
    ask: 'Which invoices are overdue?',
    answer: () => <Overdue />,
  },
  {
    id: 'hours',
    label: 'Hours left',
    ask: 'How many hours are left for Studio Lumen?',
    answer: () => <Hours />,
  },
  {
    id: 'vat',
    label: 'Input VAT',
    ask: 'How much input VAT did we book this month?',
    answer: () => <Vat />,
  },
  {
    id: 'log',
    label: 'Log work',
    ask: 'Log 2.5 h for Studio Lumen: homepage review',
    answer: (done) => <Log done={done} />,
  },
  {
    id: 'draft',
    label: 'Draft a reminder',
    ask: 'Draft a friendly reminder for Rhein Consulting',
    answer: () => <Draft />,
  },
]

type Phase = 'typing' | 'thinking' | 'answer'

export function HeidiShowcase() {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const [typed, setTyped] = useState(EXAMPLES[0]!.ask.length)
  const [phase, setPhase] = useState<Phase>('answer')
  const [done, setDone] = useState(true)
  const [visible, setVisible] = useState(false)
  const [hovered, setHovered] = useState(false)
  const playing = visible && !hovered
  const example = EXAMPLES[active]!

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), {
      threshold: 0.35,
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // One example's run: type the question, think, answer, hold, then move on.
  useEffect(() => {
    const timers: number[] = []
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms))
    const ask = EXAMPLES[active]!.ask
    if (!playing) {
      at(0, () => {
        setTyped(ask.length)
        setPhase('answer')
        setDone(true)
      })
      return () => timers.forEach(clearTimeout)
    }
    at(0, () => {
      setTyped(0)
      setPhase('typing')
      setDone(false)
    })
    for (let i = 1; i <= ask.length; i++) at(200 + i * 28, () => setTyped(i))
    const asked = 200 + ask.length * 28
    at(asked + 150, () => setPhase('thinking'))
    at(asked + 1000, () => setPhase('answer'))
    at(asked + 2400, () => setDone(true))
    at(HOLD_MS, () => setActive((i) => (i + 1) % EXAMPLES.length))
    return () => timers.forEach(clearTimeout)
  }, [active, playing])

  return (
    <div
      ref={ref}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="ring-gradient relative overflow-hidden rounded-[1.75rem] bg-white/[0.05] p-3 backdrop-blur-xl sm:p-4"
    >
      {/* The ask bar, as the panel's input. */}
      <div
        aria-hidden
        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 py-2.5 pr-2.5 pl-4"
      >
        <HeidiMark className="size-6" animated={phase !== 'answer'} />
        <span className="sm:text-lead min-w-0 flex-1 truncate text-left text-body text-white">
          {example.ask.slice(0, typed)}
          {phase === 'typing' && (
            <span className="caret ml-px inline-block h-5 w-0.5 translate-y-1 bg-heidi-to" />
          )}
        </span>
        <kbd className="hidden rounded-md border border-white/15 px-1.5 py-0.5 font-sans text-caption text-white/60 sm:inline">
          ⌘ J
        </kbd>
        <span className="inline-flex size-9 items-center justify-center rounded-xl bg-linear-to-br from-heidi-from to-heidi-to text-white">
          <ArrowUp className="size-4" />
        </span>
      </div>

      {/* The answer. */}
      <div
        aria-live="polite"
        className="relative min-h-[17rem] px-2 pt-5 pb-3 text-left text-body sm:px-3"
      >
        {phase === 'answer' ? (
          <div key={example.id} className="flex gap-3">
            <span className="hidden shrink-0 sm:block">
              <HeidiMark className="mt-0.5 size-6" />
            </span>
            <div className="min-w-0 flex-1">{example.answer(done)}</div>
          </div>
        ) : (
          phase === 'thinking' && (
            <div className="flex items-center gap-3">
              <HeidiMark className="size-6" animated />
              <span className="bg-[linear-gradient(90deg,rgb(255_255_255/0.4),white,rgb(255_255_255/0.4))] bg-[length:200%_100%] bg-clip-text text-transparent motion-safe:animate-shimmer">
                Reading your books…
              </span>
            </div>
          )
        )}
      </div>

      {/* The examples, each with its own progress line while it plays. */}
      <div
        role="tablist"
        aria-label="Examples"
        className="flex [scrollbar-width:none] gap-1.5 overflow-x-auto border-t border-white/8 px-1 pt-3"
      >
        {EXAMPLES.map((ex, i) => (
          <button
            key={ex.id}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={cn(
              'relative shrink-0 overflow-hidden rounded-full px-3.5 py-1.5 text-body-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-heidi/50',
              i === active
                ? 'bg-white/12 text-white'
                : 'text-white/55 hover:bg-white/6 hover:text-white',
            )}
          >
            {ex.label}
            {i === active && playing && (
              <span
                key={`${active}`}
                aria-hidden
                className="fill-progress absolute inset-x-3 bottom-0.5 h-px origin-left bg-linear-to-r from-heidi-from to-heidi-to"
                style={{ ['--dur' as string]: `${HOLD_MS}ms` }}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
