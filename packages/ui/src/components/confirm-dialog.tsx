'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { translate } from '@helvetly/ui/lib/i18n'
import { cn } from '@helvetly/ui/lib/utils'
import { CircleQuestionMark, Trash2, TriangleAlert } from 'lucide-react'
import { useRef, type ReactNode } from 'react'

/**
 * Asks before something changes (Heidi's writes, deletes, discarding a form). Every way out (button, Escape, outside click, close) ends
 * in exactly one `onDecide`: closing after approving does not also decline. Key it by the
 * confirmation's id so each one starts undecided.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  tone,
  confirmIcon,
  onDecide,
  alternative,
  children,
}: {
  title: string
  body: string
  confirmLabel: string
  /** Defaults to "Keep it" for destructive questions and "Not now" otherwise. */
  cancelLabel?: string
  tone: 'default' | 'destructive'
  /** The destructive confirm's icon; a bin unless the action is not a deletion (void, leave). */
  confirmIcon?: ReactNode
  onDecide: (approved: boolean) => void
  /** A second way to approve, shown full width under the two buttons. */
  alternative?: { label: string; onChoose: () => void }
  /** Extra input under the body, such as an optional reason. */
  children?: ReactNode
}) {
  const decided = useRef(false)
  const decide = (approved: boolean) => {
    if (decided.current) return
    decided.current = true
    onDecide(approved)
  }

  const destructive = tone === 'destructive'
  const Icon = destructive ? TriangleAlert : CircleQuestionMark

  return (
    <Dialog open onOpenChange={(open) => !open && decide(false)}>
      <DialogContent
        showCloseButton={false}
        className="w-[min(380px,calc(100vw-2rem))] max-w-none! gap-0 rounded-2xl p-6 text-center shadow-[0_24px_64px_-12px_rgb(0_0_0/0.25),0_4px_12px_rgb(0_0_0/0.06)]"
      >
        <span
          aria-hidden
          className={cn(
            'mx-auto flex size-12 items-center justify-center rounded-full ring-8',
            destructive
              ? 'bg-destructive/10 text-destructive ring-destructive/5'
              : 'bg-heidi-soft text-heidi-ink ring-heidi-soft/40 dark:bg-heidi/20 dark:text-heidi-soft dark:ring-heidi/5',
          )}
        >
          <Icon className="size-5 stroke-[1.75]" />
        </span>
        <DialogTitle className="mt-5 text-[17px] font-medium tracking-[-0.01em]">
          {title}
        </DialogTitle>
        <DialogDescription className="mt-1.5 text-[14px] leading-relaxed text-pretty">
          {body}
        </DialogDescription>
        {children}
        <div className="mt-6 grid grid-cols-2 gap-2">
          <Button variant="outline" size="xl" onClick={() => decide(false)}>
            {cancelLabel ?? (destructive ? translate('keepIt') : translate('notNow'))}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            size="xl"
            onClick={() => decide(true)}
          >
            {destructive && (confirmIcon ?? <Trash2 />)}
            {confirmLabel}
          </Button>
          {alternative && (
            <Button
              variant="outline"
              size="xl"
              className="col-span-2"
              onClick={() => {
                if (decided.current) return
                decided.current = true
                alternative.onChoose()
              }}
            >
              {alternative.label}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
