'use client'
import { Button } from '@helvetly/ui/components/button'
import { Lock } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect } from 'react'

import { useEmployeesHidden } from '@/components/billing/feature-lock'
import { State } from '@/components/data/table-page'
import { translate } from '@/lib/i18n'
import { canReadPath, labelOf, resourceForPath, useScopes } from '@/lib/permissions'

import { NAV } from './nav'
import { PageHeader } from './page-header'

// The page's sidebar icon, so the tab looks the same as when access is granted.
const iconOf = (resource: string) =>
  NAV.flatMap((group) => group.items).find(
    (item) => item.href && resourceForPath(item.href) === resource,
  )?.icon ?? Lock

/** A page opened by its URL without `read:<resource>` shows this instead of a failing list. */
export function AccessGate({ children }: { children: ReactNode }) {
  const scopes = useScopes()
  const pathname = usePathname() ?? ''
  const router = useRouter()
  // Not on the plan and nothing kept to read: the module does not exist here, so its URLs lead home.
  const hidden = useEmployeesHidden() && /^\/(employees|settings\/employment)(\/|$)/.test(pathname)
  useEffect(() => {
    if (hidden) router.replace('/')
  }, [hidden, router])
  if (hidden) return null
  const resource = resourceForPath(pathname)
  if (!resource || canReadPath(scopes, pathname)) return children
  const what = labelOf(resource).toLowerCase()
  return (
    <>
      <PageHeader tabs={[labelOf(resource)]} tabIcons={[iconOf(resource)]} savedViews={false} />
      <State
        icon={<Lock />}
        title={translate('youDonTHaveAccessTo', { what: what })}
        text={translate('askAnOwnerOrAdminOfThisWorkspaceTo')}
        action={
          <Button asChild variant="outline">
            <Link href="/">{translate('backToTheDashboard')}</Link>
          </Button>
        }
      />
    </>
  )
}
