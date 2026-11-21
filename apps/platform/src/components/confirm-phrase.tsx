import { InlineCode } from '@helvetly/ui/components/inline-code'
import type { ReactNode } from 'react'

const MARK = ''

/** A "Type {value} to confirm" message with the value in code style; `plain` is the same text as a string. */
export function confirmPhrase(message: (value: string) => string, value: string) {
  const [before = '', after = ''] = message(MARK).split(MARK)
  const node: ReactNode = (
    <>
      {before}
      <InlineCode>{value}</InlineCode>
      {after}
    </>
  )
  return { plain: message(value), node }
}
