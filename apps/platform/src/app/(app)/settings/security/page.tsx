import { RedirectToAccount } from '@/components/account/redirect'
import { PageTitle } from '@/components/page-title'

/** Security moved into Account settings; old links and bookmarks land there. */
export default function SecurityPage() {
  return (
    <>
      <PageTitle message="accountSettings" />
      <RedirectToAccount />
    </>
  )
}
