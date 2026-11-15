import type { Metadata } from 'next'

import { RedirectToAccount } from '@/components/account/redirect'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('accountSettings') }

/** Security moved into Account settings; old links and bookmarks land there. */
export default function SecurityPage() {
  return <RedirectToAccount />
}
