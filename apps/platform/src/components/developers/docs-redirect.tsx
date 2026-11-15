'use client'
import { localizedHref } from '@helvetly/i18n'
import { Loader } from '@helvetly/ui/components/loader'
import { useEffect } from 'react'

import { docsUrl } from '@/lib/docs'
import { translate } from '@/lib/i18n'

export const API_REFERENCE_URL = docsUrl('/api/reference')

const leave = (url: string) => window.location.replace(url)

/**
 * The API reference moved to the docs site (apps/docs); old links and bookmarks to /developers go there. The link
 * stays visible in case the browser does not follow the redirect.
 */
export function DocsRedirect({ navigate = leave }: { navigate?: (url: string) => void }) {
  useEffect(() => navigate(API_REFERENCE_URL), [navigate])
  return (
    <div className="grid flex-1 place-content-center justify-items-center gap-3 p-6 text-center">
      <Loader label={translate('openingTheAPIReference')} className="min-h-0" />
      <p className="text-body-sm text-muted-foreground">
        {translate('theAPIReferenceIsNowOn')}{' '}
        <a
          href={localizedHref(API_REFERENCE_URL)}
          className="text-foreground underline underline-offset-2"
        >
          {translate('theHelvetlyDocs')}
        </a>
        .
      </p>
    </div>
  )
}
