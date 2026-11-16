'use client'
import { Check } from 'lucide-react'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/cn'
import { translate } from '@/lib/i18n'
import { type Tone, TONES } from '@/lib/tones'

export type Feature = {
  id: string
  tone: Tone
  icon: ReactNode
  label: string
  title: string
  body: string
  /** Two short facts that float beside the picture. */
  facts: [string, string]
  art: ReactNode
}

const HOLD_MS = 6000

/**
 * The product areas as a list beside one large preview. The open entry shows its text and fills a
 * progress line; it moves on by itself while on screen and not hovered. One tone shows at a time.
 * On wide screens the list is a vertical carousel as tall as the preview, sliding the open entry to
 * its middle. On small screens the preview sits inside the open entry.
 */
export function FeatureExplorer({ features }: { features: Feature[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const [visible, setVisible] = useState(false)
  const [hovered, setHovered] = useState(false)
  const playing = visible && !hovered
  const feature = features[active]!

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), {
      threshold: 0.4,
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => setActive((active + 1) % features.length), HOLD_MS)
    return () => clearTimeout(timer)
  }, [active, playing, features.length])

  // Slides the list so the open entry sits mid-window, never past either end. Written to the DOM, not to
  // state, as it follows layout.
  useLayoutEffect(() => {
    const place = () => {
      const view = viewport.current
      const items = list.current
      const item = items?.children[active]
      if (!view || !items || !(item instanceof HTMLElement)) return
      const room = Math.min(0, view.clientHeight - items.scrollHeight)
      const middle = view.clientHeight / 2 - (item.offsetTop + item.offsetHeight / 2)
      const shift = Math.min(0, Math.max(room, middle))
      items.style.setProperty('--shift', `${shift}px`)
      // Fade only an edge with entries hidden past it.
      view.toggleAttribute('data-more-up', shift < 0)
      view.toggleAttribute('data-more-down', shift > room)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [active])

  const preview = (f: Feature) => (
    <div
      key={f.id}
      className={cn(
        'relative flex h-full flex-col overflow-hidden rounded-[1.75rem] border p-6 sm:p-8',
        TONES[f.tone].tile,
        TONES[f.tone].border,
      )}
    >
      <div aria-hidden className="dot-field absolute inset-0 opacity-60" />
      {/* Two soft lights in the tone, so the tile glows instead of sitting flat. */}
      <div
        aria-hidden
        className={cn(
          'absolute -top-24 -right-24 size-80 rounded-full opacity-35 blur-3xl',
          TONES[f.tone].solid,
        )}
      />
      <div
        aria-hidden
        className={cn(
          'absolute -bottom-32 -left-20 size-72 rounded-full opacity-20 blur-3xl',
          TONES[f.tone].solid,
        )}
      />
      <p
        className={cn(
          'relative inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-caption font-medium',
          TONES[f.tone].surface,
          TONES[f.tone].ink,
        )}
      >
        <span aria-hidden className={cn('size-1.5 rounded-full', TONES[f.tone].solid)} />
        {f.label}
      </p>
      {/* Remounted per feature, so its small animations play again each time it shows. */}
      <div className="relative flex flex-1 items-center justify-center py-8">
        <div className="pop relative w-full max-w-md lg:origin-center lg:scale-115">{f.art}</div>
        {f.facts.map((fact, i) => (
          <span
            key={fact}
            style={{ animationDelay: `${-i * 3}s` }}
            className={cn(
              'animate-float absolute hidden items-center gap-2 rounded-full border border-white bg-white px-3.5 py-2 text-body-sm font-medium text-foreground backdrop-blur-md sm:inline-flex dark:border-white/10 dark:bg-card/80',
              i === 0 ? 'top-[14%] left-1 -rotate-2' : 'right-1 bottom-[14%] rotate-2',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'inline-flex size-5 items-center justify-center rounded-full text-white',
                TONES[f.tone].solid,
              )}
            >
              <Check className="size-3" strokeWidth={3} />
            </span>
            {fact}
          </span>
        ))}
      </div>
    </div>
  )

  return (
    <div
      ref={ref}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-10"
    >
      <div
        ref={viewport}
        className="lg:h-[34rem] lg:overflow-hidden lg:data-more-down:mask-b-from-85% lg:data-more-up:mask-t-from-85%"
      >
        <div
          ref={list}
          role="tablist"
          aria-label={translate('features')}
          aria-orientation="vertical"
          className="relative flex flex-col gap-1 transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none lg:translate-y-(--shift)"
        >
          {features.map((f, i) => {
            const open = i === active
            return (
              <div
                key={f.id}
                className={cn(
                  'rounded-2xl transition-colors',
                  open ? 'bg-site-tint' : 'hover:bg-site-tint/60',
                )}
              >
                <button
                  type="button"
                  role="tab"
                  id={`feature-${f.id}`}
                  aria-selected={open}
                  aria-controls="feature-preview"
                  onClick={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  className="flex w-full items-center gap-3.5 rounded-2xl px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span
                    className={cn(
                      'inline-flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors [&_svg]:size-[18px]',
                      open
                        ? cn(TONES[f.tone].solid, 'text-white')
                        : cn(TONES[f.tone].surface, TONES[f.tone].ink),
                    )}
                  >
                    {f.icon}
                  </span>
                  <span
                    className={cn(
                      'text-title-sm font-semibold',
                      open ? 'text-foreground' : 'text-foreground/80',
                    )}
                  >
                    {f.title}
                  </span>
                </button>
                {open && (
                  <div className="px-4 pb-4 pl-[3.875rem]">
                    <p className="text-body text-pretty text-muted-foreground">{f.body}</p>
                    <div className="mt-3 h-0.5 overflow-hidden rounded-full bg-foreground/8">
                      {playing && (
                        <div
                          key={f.id}
                          className={cn('fill-progress h-full origin-left', TONES[f.tone].solid)}
                          style={{ ['--dur' as string]: `${HOLD_MS}ms` }}
                        />
                      )}
                    </div>
                    <div className="mt-4 lg:hidden">{preview(f)}</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div
        id="feature-preview"
        role="tabpanel"
        aria-labelledby={`feature-${feature.id}`}
        className="sticky top-24 hidden h-[34rem] lg:block"
      >
        {preview(feature)}
      </div>
    </div>
  )
}
