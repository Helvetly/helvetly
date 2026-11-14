import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { cn } from '@helvetly/ui/lib/utils'
import { ArrowRight, Ban, CircleAlert } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

/** One row: the problems fixed in one place, and the way there when there is one. */
export type Fix = { key: string; messages: string[]; action?: ReactNode }

/** The calm underlined action at the end of a row. */
export const fixActionClass =
  'inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-destructive underline underline-offset-4 hover:no-underline'

export function FixLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={fixActionClass}>
      {children} <ArrowRight aria-hidden className="size-3.5" />
    </Link>
  )
}

/** What has to be fixed before an action goes through: a heading and one numbered row per place to fix. */
export function FixList({
  title,
  fixes,
  className,
}: {
  title: string
  fixes: Fix[]
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'overflow-hidden rounded-xl bg-destructive/[0.04] ring-1 ring-destructive/15 dark:bg-destructive/10 dark:ring-destructive/20',
        className,
      )}
    >
      <p className="flex items-center gap-2 px-4 pt-3 pb-2.5 text-[13.5px] font-medium text-destructive">
        <CircleAlert aria-hidden className="size-4" />
        {title}
      </p>
      <ol className="divide-y divide-destructive/10 border-t border-destructive/10">
        {fixes.map((fix, index) => (
          <li key={fix.key} className="flex gap-3 px-4 py-3 text-[13.5px] leading-snug">
            <span
              aria-hidden
              className="flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-[11.5px] font-medium text-destructive tabular-nums"
            >
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-1.5 pt-px">
              <div className="grid min-w-0 flex-[1_1_16rem] gap-1 text-foreground">
                {fix.messages.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </div>
              {fix.action}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** "{n} things to fix before …", or "One thing …". */
export const fixCount = (count: number, before: string) =>
  count === 1 ? `One thing to fix before ${before}` : `${count} things to fix before ${before}`

/** The fix list in a dialog: the icon inline with the title, a line of context, then the rows. */
export function FixDialog({
  title,
  description,
  children,
  footer,
  onClose,
}: {
  title: string
  description: string
  /** The FixList. */
  children: ReactNode
  footer: ReactNode
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(540px,calc(100vw-2rem))] max-w-none! gap-4 rounded-2xl p-6">
        <div className="grid gap-1 pr-6">
          <DialogTitle className="flex items-center gap-2.5 text-[17px] font-medium">
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"
            >
              <Ban className="size-4 stroke-[1.75]" />
            </span>
            {title}
          </DialogTitle>
          <DialogDescription className="pl-[38px]">{description}</DialogDescription>
        </div>
        {children}
        <div className="flex justify-end gap-2">{footer}</div>
      </DialogContent>
    </Dialog>
  )
}
