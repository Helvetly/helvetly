import type { ReactNode } from 'react'

import { PortalShell } from '@/components/portal-shell'

/** Everything but the sign-in page needs a portal session. */
export default function SignedInLayout({ children }: { children: ReactNode }) {
  return <PortalShell>{children}</PortalShell>
}
