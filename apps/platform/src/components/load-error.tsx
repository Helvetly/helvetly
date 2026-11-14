import { Button } from '@helvetly/ui/components/button'
import { CloudOff, RotateCw } from 'lucide-react'

import { ApiError, errorMessage } from '@/lib/api'

/** A part of a page that could not be loaded: what failed, in words, and a way to try again. */
export function LoadError({
  what,
  error,
  onRetry,
}: {
  what: string
  error: unknown
  onRetry: () => void
}) {
  // A 404 here means the server does not offer this yet, not that something broke.
  const missing = error instanceof ApiError && error.status === 404
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-3.5 text-[13px]"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">
        <CloudOff aria-hidden />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="font-medium">Couldn’t load {what}</span>
        <span className="text-muted-foreground">
          {missing ? 'This isn’t available on this server yet.' : errorMessage(error)}
        </span>
      </span>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={onRetry}>
        <RotateCw className="size-3.5" aria-hidden /> Try again
      </Button>
    </div>
  )
}
