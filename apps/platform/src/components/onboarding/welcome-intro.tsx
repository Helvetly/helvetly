'use client'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import { Kbd } from '@helvetly/ui/components/kbd'
import { cn } from '@helvetly/ui/lib/utils'
import { FileUp, FolderOpen, ReceiptText } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { translate } from '@/lib/i18n'

const BRAND = 'Helvetly'
const START_MS = 350
const STEP_MS = 38

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const graphemes = (text: string) =>
  Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
    (s) => s.segment,
  )

/** The title in the pieces it is typed in: the brand word keeps the marketing italic, found in the translated text itself. */
function pieces(title: string) {
  const at = title.indexOf(BRAND)
  const parts =
    at < 0
      ? [{ text: title, accent: false }]
      : [
          { text: title.slice(0, at), accent: false },
          { text: BRAND, accent: true },
          { text: title.slice(at + BRAND.length), accent: false },
        ]
  return parts
    .filter((part) => part.text)
    .map(({ text, accent }) => ({ text, accent, letters: graphemes(text) }))
}

/** How many letters are typed: one more every few milliseconds, once per mount; all of them at once for reduced motion. */
function useTyped(total: number) {
  const [typed, setTyped] = useState(() => (prefersReducedMotion() ? total : 0))
  useEffect(() => {
    if (typed >= total) return
    const timer = setTimeout(() => setTyped((n) => n + 1), typed === 0 ? START_MS : STEP_MS)
    return () => clearTimeout(timer)
  }, [typed, total])
  return Math.min(typed, total)
}

/**
 * The welcome's heading, typed once as it appears. Screen readers get the whole title from the first
 * frame; the sighted layer lays out the whole title from the start (the untyped rest is only hidden),
 * so nothing moves while it types.
 */
export function TypedWelcomeTitle({ title }: { title: string }) {
  const parts = pieces(title)
  const total = parts.reduce((sum, part) => sum + part.letters.length, 0)
  const typed = useTyped(total)
  const done = typed >= total
  // Where each piece starts in the whole title, and the one piece the caret follows.
  const starts = parts.map((_, i) =>
    parts.slice(0, i).reduce((sum, part) => sum + part.letters.length, 0),
  )
  const caretIn = parts.findIndex((part, i) => typed <= (starts[i] ?? 0) + part.letters.length)
  return (
    <>
      <span className="sr-only">{title}</span>
      <span aria-hidden>
        {parts.map((part, i) => {
          const start = starts[i] ?? 0
          const shown = Math.max(0, Math.min(part.letters.length, typed - start))
          return (
            <span key={`${start}:${part.text}`} className={part.accent ? 'accent' : undefined}>
              {part.letters.slice(0, shown).join('')}
              {i === caretIn && !prefersReducedMotion() && (
                <span data-caret className="relative">
                  <span
                    className={cn(
                      'absolute bottom-[0.08em] left-px h-[0.85em] w-0.5 rounded-full bg-primary/70 transition-opacity duration-500',
                      done && 'opacity-0 delay-500',
                    )}
                  />
                </span>
              )}
              <span className="invisible">{part.letters.slice(shown).join('')}</span>
            </span>
          )
        })}
      </span>
    </>
  )
}

function Benefit({
  icon,
  title,
  heidi,
  children,
}: {
  icon: ReactNode
  title: string
  heidi?: boolean
  children: ReactNode
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
          heidi ? 'bg-heidi-soft/60' : 'bg-muted text-muted-foreground',
        )}
      >
        {icon}
      </span>
      <span className="grid gap-0.5">
        <span className="text-sm font-semibold tracking-tight">{title}</span>
        <span className="text-sm text-pretty text-muted-foreground">{children}</span>
      </span>
    </li>
  )
}

/** What the product does, as one quiet panel under the first action rather than four cards. */
export function WelcomeBenefits() {
  return (
    <ul className="grid divide-y overflow-hidden rounded-xl border bg-muted/30">
      <Benefit icon={<ReceiptText className="size-4 stroke-[1.75]" />} title={translate('getPaid')}>
        {translate('invoicesWithTheSwissQRBillOrAsE')}
      </Benefit>
      <Benefit
        icon={<FolderOpen className="size-4 stroke-[1.75]" />}
        title={translate('clientsDocuments')}
      >
        {translate('contractsFromTemplatesESignaturesAndAPortalWhere')}
      </Benefit>
      <Benefit
        icon={<FileUp className="size-4 stroke-[1.75]" />}
        title={translate('bringYourData')}
      >
        {translate('dropInSpreadsheetsPDFsOrReceiptsAITurnsThem')}
      </Benefit>
      <Benefit
        heidi
        icon={<HeidiSparkle className="size-4" />}
        title={translate('heidiYourAssistant')}
      >
        {translate('askAboutYourNumbersOrLetHerDraftFor')}
        <Kbd>{translate('j')}</Kbd>.
      </Benefit>
    </ul>
  )
}
