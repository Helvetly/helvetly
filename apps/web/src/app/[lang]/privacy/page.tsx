import type { Metadata } from 'next'

import { LegalView, legalMetadata } from '@/components/legal-page'
import { languageOf } from '@/lib/i18n'

type Props = { params: Promise<{ lang?: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return legalMetadata('privacy', await languageOf(params))
}

export default async function PrivacyPage({ params }: Props) {
  return <LegalView lang={await languageOf(params)} slug="privacy" />
}
