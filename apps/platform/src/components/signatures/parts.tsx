import { Badge } from '@helvetly/ui/components/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'
import { cn } from '@helvetly/ui/lib/utils'
import { CalendarCheck, Info, Signature, TextCursorInput, UserRound } from 'lucide-react'
import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react'

import { LEADING, printedSize } from '@/lib/fit-text'
import { translate } from '@/lib/i18n'
import {
  FIELD_LABELS,
  type Box,
  type FieldKind,
  type RequestStatus,
  type SignerStatus,
} from '@/lib/signatures'
import { FONT_SIZES, type PrintSettings } from '@/lib/templates'

import type { Palette } from './placement'

export const FIELD_ICONS = {
  signature: Signature,
  date: CalendarCheck,
  name: UserRound,
  text: TextCursorInput,
} satisfies Record<FieldKind, unknown>

export const SIGNING_KINDS: readonly FieldKind[] = ['signature', 'date', 'name', 'text']

/** What a signer's lane offers on the placement screen. */
export const signingPalette = {
  kinds: () => SIGNING_KINDS,
  label: (kind: FieldKind) => FIELD_LABELS[kind],
  icon: (kind: FieldKind) => FIELD_ICONS[kind],
  prompt: (kind: FieldKind) => (kind === 'text' ? translate('whatToEnter') : null),
  hint: translate('orClickOneThenClickWhereItGoesDate'),
} satisfies Omit<Palette<FieldKind>, 'lanes'>

const REQUEST_LABELS: Record<RequestStatus, string> = {
  pending: translate('outForSignature'),
  completed: translate('completed'),
  declined: translate('declined'),
  revoked: translate('revoked'),
  expired: translate('expired'),
}

const SIGNER_LABELS: Record<SignerStatus, string> = {
  waiting: translate('waiting'),
  sent: translate('sent3'),
  viewed: translate('viewed'),
  signed: translate('signed'),
  declined: translate('declined'),
}

export function RequestBadge({ status }: { status: RequestStatus }) {
  return <Badge tone={STATUS_TONES.signatureRequest[status]}>{REQUEST_LABELS[status]}</Badge>
}

export function SignerBadge({ status }: { status: SignerStatus }) {
  return <Badge tone={STATUS_TONES.signer[status]}>{SIGNER_LABELS[status]}</Badge>
}

const SES_DETAIL = translate('underSwissZertESAndEUEIDASThisIsA')

/** The legal line in one row: what kind of signature this is, the details behind "Learn more". */
export function SesLine({ className }: { className?: string }) {
  return (
    <p className={cn('flex items-center gap-1.5 text-[12.5px] text-muted-foreground', className)}>
      <Info className="size-3.5 shrink-0 stroke-[1.75]" />
      <span className="truncate">{translate('simpleElectronicSignatureSESNotAQualifiedOne')}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="shrink-0 cursor-help font-medium text-foreground/80 underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            {translate('learnMore')}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-72 text-pretty">{SES_DETAIL}</TooltipContent>
      </Tooltip>
    </p>
  )
}

/** The plain legal line: what kind of signature this is, and where it is not enough. */
export function SesNote({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        'flex gap-2.5 rounded-xl bg-brand-surface/70 px-3 py-2.5 text-[12.5px] leading-snug text-brand',
        className,
      )}
    >
      <Info className="mt-px size-3.5 shrink-0 stroke-[1.75]" />
      <span>{translate('aSimpleElectronicSignatureSESUnderSwissZertESAnd')}</span>
    </p>
  )
}

/**
 * A field's box on a page overlay, positioned by its page fractions. `edit` (placing, signing) shows the coloured
 * box; `output` (a filled template's preview) shows only its value, printed like the generated PDF.
 */
export function FieldBox({
  box,
  color,
  kind,
  print,
  mode = 'edit',
  selected,
  muted,
  className,
  style,
  children,
  ...rest
}: {
  box: Box
  color: string
  kind: string
  /** How an `output` value is printed (a template's data field); none: 10 pt, left. */
  print?: PrintSettings
  mode?: 'edit' | 'output'
  selected?: boolean
  muted?: boolean
  className?: string
  style?: CSSProperties
  children?: ReactNode
} & Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'className' | 'children'>) {
  const position = {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`,
  }
  if (mode === 'output')
    return (
      <div {...rest} data-kind={kind} data-mode="output" className="absolute" style={position}>
        <PrintedText print={print}>{children}</PrintedText>
      </div>
    )
  return (
    <div
      {...rest}
      data-kind={kind}
      data-mode="edit"
      className={cn(
        'absolute flex items-center overflow-hidden rounded-[4px] border text-[clamp(8px,1.4cqw,12px)] leading-none',
        className,
      )}
      style={{
        ...position,
        borderColor: muted ? `${color}55` : color,
        backgroundColor: `${color}${muted ? '0d' : '1f'}`,
        color,
        outline: selected ? `2px solid ${color}` : undefined,
        outlineOffset: 1,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/**
 * Text in its box like print: black, vertically centred, at its size in points on this page (10 by default),
 * shrunk by fitFontSize with auto-fit, aligned as set: the same rule as the API's signpdf.drawLines.
 */
function PrintedText({ children, print }: { children?: ReactNode; print?: PrintSettings }) {
  const points = print?.font_size ?? FONT_SIZES.default
  const autoFit = !!print?.auto_fit
  const boxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const box = boxRef.current
    const text = textRef.current
    if (!box || !text) return
    const fit = () => {
      text.style.fontSize = '100px' // measured large, then scaled: width grows linearly with the size
      const widest = text.offsetWidth / 100
      const lines = Math.max(1, Math.round(text.offsetHeight / (100 * LEADING)))
      text.style.fontSize = `${printedSize(box, points, autoFit, lines, widest)}px`
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    // the text's own size changes with its value, the box's with the page
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    observer.observe(text)
    return () => observer.disconnect()
  }, [points, autoFit])
  const align = print?.align ?? 'left'
  return (
    <div
      ref={boxRef}
      className={cn(
        'flex size-full items-center overflow-hidden',
        align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start',
      )}
    >
      <span
        ref={textRef}
        className={cn(
          'inline-block whitespace-pre text-black',
          align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left',
        )}
        style={{
          fontFamily: 'Helvetica, Arial, "Liberation Sans", sans-serif',
          lineHeight: LEADING,
        }}
      >
        {children}
      </span>
    </div>
  )
}
