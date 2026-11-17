'use client'
import { guardDomAgainstTranslators } from '@helvetly/ui/lib/translator-safe-dom'

// Module scope: the guard is in place before React hydrates and first touches the page.
if (typeof window !== 'undefined') guardDomAgainstTranslators()

/** Renders nothing; including it loads the guard on the client (see lib/translator-safe-dom). */
export function TranslatorSafeDom() {
  return null
}
