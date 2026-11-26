'use client'
import { useEffect, useId, useRef, useState } from 'react'

import { useClaimEscape } from '@/components/inline-add'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'

import { TagsInput, type KnownTag } from './fields'

const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((tag, index) => tag === b[index])

/**
 * Tags edited in place (a client's, or a file's with `known` suggestions): chips with suggestions from the workspace, saved when focus leaves the
 * field or on Enter with nothing typed; Escape closes it without saving. A failed save keeps the chips and
 * shows why.
 */
export function InlineTagsEditor({
  initial,
  save,
  onDone,
  known,
  displayTag,
  validateTag,
}: {
  initial: string[]
  save: (tags: string[]) => Promise<unknown>
  onDone: () => void
  validateTag?: (tag: string) => string | undefined
  displayTag?: (tag: string) => string
  known?: KnownTag[]
}) {
  const id = useId()
  const [tags, setTags] = useState(initial)
  // The input adds its typed text on blur just before the field sees focus leave, so commit reads this.
  const latest = useRef(initial)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const wrapper = useRef<HTMLDivElement>(null)
  const closing = useRef(false)
  useClaimEscape(wrapper)
  useEffect(() => wrapper.current?.querySelector('input')?.focus(), [])

  const change = (next: string[]) => {
    latest.current = next
    setTags(next)
  }
  const close = () => {
    closing.current = true
    onDone()
  }
  const commit = async () => {
    if (closing.current || pending) return
    const next = latest.current
    if (same(next, initial)) return close()
    setPending(true)
    setError('')
    try {
      await save(next)
      close()
    } catch (failure) {
      setError(errorMessage(failure))
      wrapper.current?.querySelector('input')?.focus()
    } finally {
      setPending(false)
    }
  }

  return (
    <div ref={wrapper} aria-busy={pending || undefined} className="grid flex-1 gap-1 py-1">
      <TagsInput
        id={id}
        label={translate('tags')}
        value={tags}
        known={known}
        displayTag={displayTag}
        validateTag={validateTag}
        invalid={Boolean(error)}
        onChange={change}
        onLeave={() => void commit()}
        onInputKeyDown={(event) => {
          // An Enter that added typed text is handled; an Enter with nothing typed finishes.
          if (event.key === 'Enter' && !event.defaultPrevented) {
            event.preventDefault()
            void commit()
          }
          if (event.key === 'Escape') close()
        }}
      />
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
