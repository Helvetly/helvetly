import type { Metadata } from 'next'

import { NotFoundView } from '@/components/not-found-view'
import { languageOf } from '@/lib/i18n'
import { notFoundMetadata } from '@/lib/metadata'

// Exported as /<lang>/404.html: the static host serves the nearest 404.html, so a missing German page gets this one.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>
}): Promise<Metadata> {
  return notFoundMetadata(await languageOf(params))
}

export default function LanguageNotFound() {
  return <NotFoundView />
}
