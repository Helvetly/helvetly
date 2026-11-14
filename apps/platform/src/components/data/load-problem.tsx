'use client'

import { Button } from '@helvetly/ui/components/button'
import { CloudOff, RotateCw } from 'lucide-react'

import { ApiError } from '@/lib/api'

import { State } from './table-page'

/** What a failed load means for the person: never a bare "Not found." from the server. */
export function loadProblemText(error: unknown, what: string) {
  if (error instanceof ApiError) {
    if (error.status === 0) return 'Helvetly can’t be reached. Check your connection and try again.'
    if (error.status === 404 || error.status >= 500)
      return `${what} can’t be loaded right now. Try again in a moment.`
    return error.message
  }
  return `${what} couldn’t be loaded. Try again in a moment.`
}

/** A failed list load, laid out like the empty states (centred, same icon tile), with a retry. */
export function LoadProblem({
  error,
  what,
  onRetry,
}: {
  error: unknown
  /** Capitalised, e.g. "The catalogue". */
  what: string
  onRetry: () => void
}) {
  return (
    <div role="alert" className="flex flex-1">
      <State
        icon={<CloudOff />}
        title="Couldn’t load this list"
        text={loadProblemText(error, what)}
        action={
          <Button variant="outline" size="sm" className="cursor-pointer gap-1.5" onClick={onRetry}>
            <RotateCw className="size-3.5" /> Try again
          </Button>
        }
      />
    </div>
  )
}
