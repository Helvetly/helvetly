'use client'

import { Button } from '@helvetly/ui/components/button'
import { ArrowLeft, RotateCcw, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

export type PageError = Error & { digest?: string }

/**
 * What a page shows when it crashed, for Next's `error.tsx`: a red tile, a reassurance, "Try
 * again" (Next's `reset`, no reload) and "Go back". `home` is the app's own way out.
 */
function ErrorState({ reset, home }: { reset: () => void; home?: ReactNode }) {
  return (
    <div className="flex min-h-[60vh] w-full flex-1 items-center justify-center px-4 py-12">
      <div role="alert" className="flex w-full max-w-[560px] flex-col items-center text-center">
        <span className="relative flex size-14 items-center justify-center">
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-destructive-surface/80 blur-md"
          />
          <span className="relative flex size-12 items-center justify-center rounded-2xl border border-destructive/15 bg-destructive-surface text-destructive">
            <TriangleAlert aria-hidden className="size-[22px] stroke-[1.75]" />
          </span>
        </span>
        <h1 className="mt-5 text-title font-semibold tracking-[-0.015em] text-balance">
          Something went wrong on this page
        </h1>
        <p className="mt-2 text-body text-muted-foreground sm:whitespace-nowrap">
          Your data is safe. Try again, or go back to where you were.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={reset}>
            <RotateCcw /> Try again
          </Button>
          {home}
        </div>
        <button
          type="button"
          onClick={() => window.history.back()}
          className="mt-4 inline-flex items-center gap-1 text-body-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <ArrowLeft aria-hidden className="size-3.5" /> Go back
        </button>
      </div>
    </div>
  )
}

export { ErrorState }
