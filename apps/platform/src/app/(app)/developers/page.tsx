import type { Metadata } from 'next'

import { DocsRedirect } from '@/components/developers/docs-redirect'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('apiReference') }

/** The API reference lives on the docs site now; this keeps old links working. */
export default function DevelopersPage() {
  return <DocsRedirect />
}
