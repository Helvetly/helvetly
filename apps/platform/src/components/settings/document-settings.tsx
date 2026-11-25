'use client'
import { Loader } from '@helvetly/ui/components/loader'
import { FileSignature } from 'lucide-react'

import { ContractSignatureEditor } from '@/components/quotes/contract-signature'
import { SettingsPage, SettingsSection } from '@/components/settings/layout'
import { SettingsHeader } from '@/components/settings/settings-tabs'
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'

/** Settings → Documents: your own signature for contracts made from quotes in this workspace. */
export function DocumentSettingsPage() {
  const user = useSession().data?.user
  return (
    <>
      <SettingsHeader />
      <SettingsPage
        title={translate('documents')}
        description={translate('documentSettingsDescription')}
      >
        {user ? (
          <SettingsSection
            id="contract-signature"
            icon={FileSignature}
            title={translate('yourSignatureForContracts')}
            description={translate('yourSignatureForContractsText')}
          >
            <ContractSignatureEditor name={user.name || user.email} />
          </SettingsSection>
        ) : (
          <Loader className="min-h-40" />
        )}
      </SettingsPage>
    </>
  )
}
