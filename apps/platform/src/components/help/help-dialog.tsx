'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import { useMutation } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { toast } from 'sonner'

import { useHeidi } from '@/components/heidi/heidi-provider'
import { feedbackApi } from '@/lib/feedback'

import { FeedbackForm } from './feedback-form'

/** Help & feedback: a way to Heidi's panel for questions, and a form to the Helvetly team. */
export function HelpDialog({
  open,
  onOpenChange,
  description,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A problem report to start from, such as a crashed page's details. */
  description?: string
}) {
  const heidi = useHeidi()
  const send = useMutation({ mutationFn: feedbackApi.send })

  return (
    <Dialog open={open} onOpenChange={(next) => (next || !send.isPending) && onOpenChange(next)}>
      <DialogContent
        showCloseButton={!send.isPending}
        // Start in the description: the Heidi card is a way out, not the first thing to do.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          document.getElementById('feedback-description')?.focus()
        }}
        className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[calc(100dvh-4rem)] sm:max-w-[520px] sm:rounded-2xl [&>[data-slot=dialog-close]]:top-3.5 [&>[data-slot=dialog-close]]:right-3.5"
      >
        <header className="shrink-0 px-6 pt-6 pb-1">
          <DialogTitle className="text-[17px] font-medium tracking-[-0.01em]">
            Help & feedback
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13.5px] text-muted-foreground">
            Tell the Helvetly team what went wrong or what would make your work easier.
          </DialogDescription>
        </header>

        {heidi && (
          <div className="shrink-0 px-6 pt-4">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false)
                heidi.setOpen(true)
              }}
              className="group flex w-full items-center gap-3 rounded-xl bg-heidi-soft/45 px-3.5 py-3 text-left transition-colors duration-150 outline-none hover:bg-heidi-soft/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-heidi/10 dark:hover:bg-heidi/15"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card">
                <HeidiSparkle className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium">Have a question?</span>
                <span className="block text-[12.5px] text-muted-foreground">
                  Ask Heidi how to do anything in Helvetly.
                </span>
              </span>
              <span className="flex items-center gap-1 text-[13px] font-medium text-heidi-ink">
                Ask Heidi
                <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
              </span>
            </button>
          </div>
        )}

        <FeedbackForm
          send={send}
          initialDescription={description}
          onCancel={() => onOpenChange(false)}
          onSent={() => {
            onOpenChange(false)
            toast.success('Thanks! Your feedback was sent.')
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
