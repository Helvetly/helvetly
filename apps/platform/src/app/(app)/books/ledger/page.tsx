import { PageTitle } from '@/components/page-title'
import { LedgerPage } from '@/components/settings/ledger'

export default function Page() {
  return (
    <>
      <PageTitle message="ledger" />
      <LedgerPage />
    </>
  )
}
