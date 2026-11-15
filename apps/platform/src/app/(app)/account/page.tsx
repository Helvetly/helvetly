import { AccountSettings } from '@/components/account/account-settings'
import { PageTitle } from '@/components/page-title'

export default function AccountPage() {
  return (
    <>
      <PageTitle message="accountSettings" />
      <AccountSettings />
    </>
  )
}
