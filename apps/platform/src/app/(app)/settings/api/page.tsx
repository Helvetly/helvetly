import type { Metadata } from 'next'

import { ApiSettings } from '@/components/api/api-settings'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('apiMCP') }

export default function ApiPage() {
  return <ApiSettings />
}
