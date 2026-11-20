'use client'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { Sheet, SheetContent, SheetTitle } from '@helvetly/ui/components/sheet'
import { cn } from '@helvetly/ui/lib/utils'
import { ArrowLeft, Check, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { translate } from '@/lib/i18n'

/**
 * A step-by-step editor in a sheet that takes nearly the whole screen: steps in the header, Back,
 * a status line and the step's action in the footer. Closing with unsaved work asks first.
 */
export function WizardSheet({
  icon,
  title,
  steps,
  step,
  onStep,
  dirty,
  busy = false,
  discardTitle,
  onClose,
  status,
  error,
  action,
  children,
}: {
  icon: ReactNode
  title: string
  steps: readonly string[]
  step: number
  onStep: (step: number) => void
  dirty: boolean
  busy?: boolean
  discardTitle: string
  onClose: () => void
  /** The footer's quiet summary. */
  status: ReactNode
  /** Replaces the summary, in red. */
  error?: string | null
  /** Next, or the last step's own button. */
  action: ReactNode
  children: ReactNode
}) {
  const [discarding, setDiscarding] = useState(false)
  const requestClose = () => {
    if (busy) return
    if (dirty) setDiscarding(true)
    else onClose()
  }

  return (
    <Sheet open onOpenChange={(open) => !open && requestClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-full! max-w-none! gap-0 overflow-hidden bg-card p-0 sm:w-[min(1760px,calc(100vw-6rem))]!"
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3 md:px-4">
          <span className="flex size-7 items-center justify-center rounded-md bg-section-icon-surface text-section-icon [&_svg]:size-4 [&_svg]:stroke-[1.75]">
            {icon}
          </span>
          <SheetTitle className="min-w-0 truncate text-[15px] font-medium">{title}</SheetTitle>
          <ol className="mx-auto hidden items-center gap-1 lg:flex" aria-label={translate('steps')}>
            {steps.map((label, index) => (
              <li key={label} className="flex items-center gap-1">
                {index > 0 && <span className="h-px w-5 bg-border" />}
                <button
                  type="button"
                  disabled={busy || index > step}
                  aria-current={index === step ? 'step' : undefined}
                  onClick={() => onStep(index)}
                  className="flex h-8 cursor-pointer items-center gap-2 rounded-full px-2.5 text-[13px] text-muted-foreground transition-colors enabled:hover:text-foreground disabled:cursor-default aria-[current=step]:bg-foreground/[0.06] aria-[current=step]:font-medium aria-[current=step]:text-foreground"
                >
                  <span
                    className={cn(
                      'flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums ring-1 ring-border',
                      index < step && 'bg-success-solid text-white ring-0',
                      index === step && 'ring-brand-solid',
                    )}
                  >
                    {index < step ? <Check className="size-3" /> : index + 1}
                  </span>
                  {label}
                </button>
              </li>
            ))}
          </ol>
          <span className="text-[12px] text-muted-foreground lg:hidden">
            {translate('step')}
            {step + 1}
            {translate('of5')}
            {steps.length}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={translate('close')}
            disabled={busy}
            className="ml-auto cursor-pointer lg:ml-0"
            onClick={requestClose}
          >
            <X />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">{children}</div>

        <footer className="grid min-h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-t px-5 py-2.5 md:px-7">
          <div>
            {step > 0 && (
              <Button
                variant="outline"
                disabled={busy}
                className="cursor-pointer"
                onClick={() => onStep(step - 1)}
              >
                <ArrowLeft className="size-4" />
                {translate('back2')}
              </Button>
            )}
          </div>
          <p
            role={error ? 'alert' : undefined}
            className={cn(
              'max-w-[56ch] truncate text-center text-[13px]',
              error ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {error || status}
          </p>
          <div className="justify-self-end">{action}</div>
        </footer>
        {discarding && (
          <ConfirmDialog
            tone="destructive"
            title={discardTitle}
            body={translate('whatYouVeSetUpSoFarIsLost')}
            confirmLabel={translate('discard')}
            cancelLabel={translate('keepEditing')}
            onDecide={(discard) => {
              setDiscarding(false)
              if (discard) onClose()
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

/** A step's form on the left, the document it is about on the right (form only on phones). */
export function Split({ children, preview }: { children: ReactNode; preview: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-full shrink-0 overflow-y-auto md:w-[min(560px,42%)] md:border-r">
        <div className="mx-auto grid max-w-[560px] gap-6 px-5 py-6 md:px-7">{children}</div>
      </div>
      <div className="relative hidden min-w-0 flex-1 bg-muted/50 md:block dark:bg-background">
        {preview}
      </div>
    </div>
  )
}

export function StepTitle({ title, text }: { title: string; text: string }) {
  return (
    <div className="grid gap-1">
      <h2 className="text-lg font-medium tracking-tight">{title}</h2>
      <p className="text-sm text-pretty text-muted-foreground">{text}</p>
    </div>
  )
}
