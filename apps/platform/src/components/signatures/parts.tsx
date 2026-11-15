import { StatusBadge, type Tone } from '@helvetly/ui/components/status-badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { CalendarCheck, Info, Signature, TextCursorInput, UserRound } from 'lucide-react'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

import { translate } from '@/lib/i18n'
import {
  FIELD_LABELS,
  type Box,
  type FieldKind,
  type RequestStatus,
  type SignerStatus,
} from '@/lib/signatures'

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

const REQUEST_TONES: Record<RequestStatus, [Tone, string]> = {
  pending: ['blue', translate('outForSignature')],
  completed: ['green', translate('completed')],
  declined: ['red', translate('declined')],
  revoked: ['gray', translate('revoked')],
  expired: ['amber', translate('expired')],
}

const SIGNER_TONES: Record<SignerStatus, [Tone, string]> = {
  waiting: ['gray', translate('waiting')],
  sent: ['blue', translate('sent3')],
  viewed: ['amber', translate('viewed')],
  signed: ['green', translate('signed')],
  declined: ['red', translate('declined')],
}

export function RequestBadge({ status }: { status: RequestStatus }) {
  const [tone, label] = REQUEST_TONES[status]
  return <StatusBadge tone={tone}>{label}</StatusBadge>
}

export function SignerBadge({ status }: { status: SignerStatus }) {
  const [tone, label] = SIGNER_TONES[status]
  return <StatusBadge tone={tone}>{label}</StatusBadge>
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

/** A field's box on a page overlay, positioned by its page fractions. */
export function FieldBox({
  box,
  color,
  kind,
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
  selected?: boolean
  muted?: boolean
  className?: string
  style?: CSSProperties
  children?: ReactNode
} & Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'className' | 'children'>) {
  return (
    <div
      {...rest}
      data-kind={kind}
      className={cn(
        'absolute flex items-center overflow-hidden rounded-[4px] border text-[clamp(8px,1.4cqw,12px)] leading-none',
        className,
      )}
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
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
