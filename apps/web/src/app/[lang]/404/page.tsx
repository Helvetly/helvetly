import type { Metadata } from 'next'

import { NotFoundView } from '@/components/not-found-view'

// Exported as /<lang>/404.html: the static host serves the nearest 404.html, so a missing German page gets this one.
export const metadata: Metadata = { robots: { index: false } }

export default function LanguageNotFound() {
  return <NotFoundView />
}
