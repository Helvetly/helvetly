import { Callout } from '@helvetly/ui/components/callout'
import type { ReactNode } from 'react'

import { ApiError, errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'

export type ReadFailure = { tone: 'warning' | 'danger'; title: string; body: string }

// Answers about the file itself are warnings with the next step; anything else is a real failure.
const FILE_ANSWERS: Record<string, () => Omit<ReadFailure, 'tone'>> = {
  no_receipt: () => ({
    title: translate('readNothingFoundTitle'),
    body: translate('readNothingFoundBody'),
  }),
  multiple_receipts: () => ({
    title: translate('readSeveralTitle'),
    body: translate('readSeveralBody'),
  }),
  no_readable_file: () => ({
    title: translate('readNoFileTitle'),
    body: translate('readNoFileBody'),
  }),
}

/** Why an AI reading of an expense's files gave nothing, as a short title and one sentence on what to do next. */
export function readFailure(error: unknown): ReadFailure {
  const answer = error instanceof ApiError ? FILE_ANSWERS[error.code] : undefined
  if (answer) return { tone: 'warning', ...answer() }
  return { tone: 'danger', title: translate('readFailedTitle'), body: errorMessage(error) }
}

export function ReadFailureAlert({
  failure,
  children,
}: {
  failure: ReadFailure
  children?: ReactNode
}) {
  return (
    <Callout role="alert" tone={failure.tone} title={failure.title}>
      <p className="text-muted-foreground">{failure.body}</p>
      {children}
    </Callout>
  )
}
