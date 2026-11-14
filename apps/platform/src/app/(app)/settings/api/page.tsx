import type { Metadata } from 'next'

import { ApiSettings } from '@/components/api/api-settings'

export const metadata: Metadata = { title: 'API & MCP' }

export default function ApiPage() {
  return <ApiSettings />
}
