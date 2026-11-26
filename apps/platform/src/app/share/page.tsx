import type { Metadata } from 'next'

import { PageTitle } from '@/components/page-title'

import { PublicShare } from './public-share'

export const metadata: Metadata = {
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
}

export default function Page() {
  return (
    <>
      <PageTitle message="documentSharePublicTitle" />
      <PublicShare />
    </>
  )
}
