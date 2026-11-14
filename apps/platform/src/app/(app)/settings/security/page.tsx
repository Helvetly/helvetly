import type { Metadata } from 'next'

import { RedirectToAccount } from '@/components/account/redirect'

export const metadata: Metadata = { title: 'Account settings' }

/** Security moved into Account settings; old links and bookmarks land there. */
export default function SecurityPage() {
  return <RedirectToAccount />
}
