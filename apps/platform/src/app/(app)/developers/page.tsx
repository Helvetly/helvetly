import type { Metadata } from 'next'

import { DocsRedirect } from '@/components/developers/docs-redirect'

export const metadata: Metadata = { title: 'API reference' }

/** The API reference lives on the docs site now; this keeps old links working. */
export default function DevelopersPage() {
  return <DocsRedirect />
}
