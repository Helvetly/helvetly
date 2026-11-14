import type { Metadata } from 'next'

import { PortalQuotes } from '@/components/portal-quotes'

export const metadata: Metadata = { title: 'Quotes' }

export default function PortalQuotesPage() {
  return <PortalQuotes />
}
