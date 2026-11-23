'use client'
import { localizedHref } from '@helvetly/i18n'
// Small pieces every portal screen shares: page header, card, section states, file and invoice bits.
import { Avatar, AvatarFallback, AvatarImage } from '@helvetly/ui/components/avatar'
import { Badge, TONES, type Tone } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { EmptyState as SharedEmptyState } from '@helvetly/ui/components/empty-state'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'
import { cn } from '@helvetly/ui/lib/utils'
import {
  ArrowRight,
  Download,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  RotateCw,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { translate } from '@/lib/i18n'
import { portalInvoicePdfUrl, type PortalInvoice } from '@/lib/portal'
import { scoped } from '@/lib/scope'

/** Every portal card: the soft shadow the Overview's amount-due hero introduced, so all pages match. */
export const cardClass = 'rounded-xl bg-card shadow-elevation-soft'
/** A list row inside a card: the same side padding as a card's `p-4 sm:p-6`. */
export const rowClass = 'flex items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-6'

export const initialsOf = (name: string) =>
  name
    .split(/[\s._@-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')

/** The supplier's mark: its logo when it has one (and it loads), else its initials on the brand tile. */
export function WorkspaceMark({
  name,
  logoUrl,
  large = false,
}: {
  name: string
  logoUrl?: string
  large?: boolean
}) {
  const radius = large ? 'rounded-xl' : 'rounded-lg'
  return (
    // A tile, not a face: square corners on every layer and no avatar ring.
    <Avatar aria-hidden className={cn('after:hidden', radius, large ? 'size-12' : 'size-9')}>
      {logoUrl && (
        <AvatarImage src={logoUrl} alt="" className={cn('bg-card object-contain', radius)} />
      )}
      <AvatarFallback
        // Not cn(): tailwind-merge would drop the type-scale size for the colour.
        className={`${radius} ${large ? 'text-title' : 'text-body-sm'} bg-brand-surface font-semibold text-brand`}
      >
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  )
}

/** The signed-in login: its photo, else the client's initials. Decorative: the name is always next to it. */
export function LoginAvatar({
  name,
  src,
  large = false,
}: {
  name: string
  src: string
  large?: boolean
}) {
  return (
    <Avatar aria-hidden className={large ? 'size-16' : 'size-8'}>
      {src && <AvatarImage src={src} alt="" />}
      <AvatarFallback
        className={`${large ? 'text-title-sm' : 'text-caption'} bg-card font-medium text-foreground/80 shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1 ring-black/[0.06] ring-inset dark:bg-muted dark:ring-white/10`}
      >
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  )
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="grid gap-1.5">
      <h1 className="text-page font-semibold tracking-tight text-balance sm:text-display">
        {title}
      </h1>
      {children && (
        <p className="max-w-2xl text-body text-pretty text-muted-foreground sm:text-title-sm">
          {children}
        </p>
      )}
    </header>
  )
}

/** A card's title row; `action` sits on the right (usually an underlined "View all" link). */
export function SectionTitle({
  id,
  children,
  action,
}: {
  id: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className="text-title-sm font-medium">
        {children}
      </h2>
      {action}
    </div>
  )
}

/** A card's "All invoices →" link to the page with everything. */
export function ViewAll({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={scoped(href)}
      className="inline-flex shrink-0 items-center gap-1 text-body-sm text-link underline underline-offset-2 hover:no-underline"
    >
      {label}
      <ArrowRight aria-hidden className="size-3.5" />
    </Link>
  )
}

/** "{What} couldn’t be loaded" with an inline retry, inside the section that failed. */
export function RetryAlert({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <p className="text-muted-foreground">
        {what}
        {translate('couldnTBeLoadedTryAgainInAMoment')}
      </p>
      <Button variant="outline" onClick={onRetry}>
        <RotateCw />
        {translate('tryAgain')}
      </Button>
    </div>
  )
}

/** A calm centred message with the brand tile, for a list with nothing in it. */
export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children?: ReactNode
}) {
  return <SharedEmptyState icon={icon} title={title} description={children} className="py-14" />
}

const FILE_KINDS: { test: RegExp; icon: LucideIcon; tone: Tone; label: string }[] = [
  { test: /pdf/, icon: FileText, tone: 'red', label: 'PDF' },
  { test: /^image\//, icon: FileImage, tone: 'blue', label: translate('image') },
  {
    test: /sheet|excel|csv/,
    icon: FileSpreadsheet,
    tone: 'green',
    label: translate('spreadsheet'),
  },
]

/** A tinted tile with the file type's icon: PDF, image, spreadsheet or any other file. */
export function FileTile({ contentType, className }: { contentType: string; className?: string }) {
  const kind = FILE_KINDS.find(({ test }) => test.test(contentType))
  const Icon = kind?.icon ?? File
  return (
    <span
      title={kind?.label ?? translate('file')}
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg',
        TONES[kind?.tone ?? 'neutral'],
        className,
      )}
    >
      <Icon className="size-[18px]" aria-hidden />
    </span>
  )
}

const STATUS: Record<string, string> = {
  open: translate('open'),
  paid: translate('paid'),
  void: translate('void'),
  replaced: translate('replaced'),
  overdue: translate('overdue'),
  credited: translate('credited'),
}
const TONE: Record<string, Tone> = STATUS_TONES.invoice

function invoiceStatus(invoice: PortalInvoice): string {
  if (invoice.is_overdue) return 'overdue'
  // The server marks a fully credited invoice void; one paid before it was credited (and refunded) was not cancelled.
  if (invoice.status === 'void' && Number(invoice.amount_paid) > 0) return 'credited'
  return invoice.status
}

export function invoiceStatusLabel(invoice: PortalInvoice) {
  const status = invoiceStatus(invoice)
  return STATUS[status] ?? status.replaceAll('_', ' ')
}

export function InvoiceStatus({ invoice }: { invoice: PortalInvoice }) {
  return (
    <Badge tone={TONE[invoiceStatus(invoice)] ?? 'neutral'}>{invoiceStatusLabel(invoice)}</Badge>
  )
}

/** A download: icon and `text` from `sm` up; the icon alone (with a tooltip) below, or always without `text`. */
export function DownloadLink({
  href,
  label,
  text,
}: {
  href: string
  label: string
  text?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          variant="outline"
          className={cn('shrink-0', text ? 'max-sm:w-8 max-sm:px-0' : 'w-8 px-0')}
        >
          <a
            href={localizedHref(href)}
            aria-label={label}
            // A download never leaves the page, so a clicked link would keep its focus and tooltip.
            onPointerUp={(event) => event.currentTarget.blur()}
          >
            <Download /> {text && <span className="max-sm:hidden">{text}</span>}
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent className={text ? 'sm:hidden' : undefined}>
        {translate('download')}
      </TooltipContent>
    </Tooltip>
  )
}

export const PdfLink = ({ invoice }: { invoice: PortalInvoice }) => (
  <DownloadLink
    href={portalInvoicePdfUrl(invoice.id)}
    label={translate('downloadPDFOfInvoice', { number: invoice.number })}
    text="PDF"
  />
)
