'use client'

// Small pieces every portal screen shares: page header, card, section states, file and invoice bits.
import { Avatar, AvatarFallback, AvatarImage } from '@helvetly/ui/components/avatar'
import { Button } from '@helvetly/ui/components/button'
import { StatusBadge, TONES, type Tone } from '@helvetly/ui/components/status-badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Download,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  RotateCw,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { portalInvoicePdfUrl, type PortalInvoice } from '@/lib/portal'

export const cardClass = 'rounded-xl bg-card shadow-elevation-1'

export const initialsOf = (name: string) =>
  name
    .split(/[\s._@-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')

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
    <header className="grid gap-1">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
      {children && <p className="text-sm text-pretty text-muted-foreground">{children}</p>}
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

/** "{What} couldn’t be loaded" with an inline retry, inside the section that failed. */
export function RetryAlert({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <p className="text-muted-foreground">{what} couldn’t be loaded. Try again in a moment.</p>
      <Button variant="outline" onClick={onRetry}>
        <RotateCw /> Try again
      </Button>
    </div>
  )
}

/** A calm centred message with an icon tile, for a list with nothing in it. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  tone = 'gray',
}: {
  icon: LucideIcon
  title: string
  children?: ReactNode
  tone?: Tone
}) {
  return (
    <div className="grid justify-items-center gap-2 px-4 py-10 text-center">
      <span className={cn('mb-1 flex size-10 items-center justify-center rounded-xl', TONES[tone])}>
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-sm text-sm text-pretty text-muted-foreground">{children}</p>}
    </div>
  )
}

const FILE_KINDS: { test: RegExp; icon: LucideIcon; tone: Tone; label: string }[] = [
  { test: /pdf/, icon: FileText, tone: 'red', label: 'PDF' },
  { test: /^image\//, icon: FileImage, tone: 'blue', label: 'Image' },
  { test: /sheet|excel|csv/, icon: FileSpreadsheet, tone: 'green', label: 'Spreadsheet' },
]

/** A tinted tile with the file type's icon: PDF, image, spreadsheet or any other file. */
export function FileTile({ contentType, className }: { contentType: string; className?: string }) {
  const kind = FILE_KINDS.find(({ test }) => test.test(contentType))
  const Icon = kind?.icon ?? File
  return (
    <span
      title={kind?.label ?? 'File'}
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg',
        TONES[kind?.tone ?? 'gray'],
        className,
      )}
    >
      <Icon className="size-[18px]" aria-hidden />
    </span>
  )
}

const STATUS: Record<string, [Tone, string]> = {
  open: ['blue', 'Open'],
  paid: ['green', 'Paid'],
  void: ['gray', 'Void'],
  replaced: ['gray', 'Replaced'],
}

export function InvoiceStatus({ invoice }: { invoice: PortalInvoice }) {
  if (invoice.is_overdue) return <StatusBadge tone="red">Overdue</StatusBadge>
  const [tone, label] = STATUS[invoice.status] ?? ['gray', invoice.status.replaceAll('_', ' ')]
  return <StatusBadge tone={tone}>{label}</StatusBadge>
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
          variant="ghost"
          className={cn('shrink-0', text ? 'max-sm:w-8 max-sm:px-0' : 'w-8 px-0')}
        >
          <a href={href} aria-label={label}>
            <Download /> {text && <span className="max-sm:hidden">{text}</span>}
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent className={text ? 'sm:hidden' : undefined}>Download</TooltipContent>
    </Tooltip>
  )
}

export const PdfLink = ({ invoice }: { invoice: PortalInvoice }) => (
  <DownloadLink
    href={portalInvoicePdfUrl(invoice.id)}
    label={`Download PDF of invoice ${invoice.number}`}
    text="PDF"
  />
)
