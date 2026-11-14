import type { Metadata } from 'next'

import { UnsubscribePage } from '@/components/notifications/unsubscribe-page'

// The token is in the URL fragment; no-referrer keeps even the page's address out of any request it makes.
export const metadata: Metadata = {
  title: 'Unsubscribe',
  referrer: 'no-referrer',
  robots: { index: false },
}

export default function Page() {
  return <UnsubscribePage />
}
