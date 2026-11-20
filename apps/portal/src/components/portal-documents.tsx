'use client'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { formatSize } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { FolderOpen, Search, SearchX } from 'lucide-react'
import { useState } from 'react'

import { civilToday, sharedText } from '@/lib/dates'
import { translate } from '@/lib/i18n'
import { listPortalDocuments, portalDocumentUrl, portalKeys } from '@/lib/portal'

import {
  cardClass,
  DownloadLink,
  EmptyState,
  FileTile,
  PageHeader,
  RetryAlert,
  rowClass,
} from './portal-bits'

/** Above this many documents a search box helps. */
const SEARCH_FROM = 7

export function PortalDocuments() {
  const query = useQuery({ queryKey: portalKeys.documents, queryFn: listPortalDocuments })
  const [search, setSearch] = useState('')
  const today = civilToday()

  const body = () => {
    if (query.isPending) return <Loader className={cn(cardClass, 'min-h-28')} />
    if (query.error)
      return (
        <div className={cn(cardClass, 'p-4 sm:p-6')}>
          <RetryAlert what={translate('yourDocuments')} onRetry={() => void query.refetch()} />
        </div>
      )
    if (query.data.length === 0)
      return (
        <div className={cardClass}>
          <EmptyState icon={FolderOpen} title={translate('nothingHasBeenSharedWithYouYet')}>
            {translate('contractsReportsAndOtherFilesAppearHereWhenThey')}
          </EmptyState>
        </div>
      )
    const needle = search.trim().toLowerCase()
    const shown = query.data.filter((doc) => doc.name.toLowerCase().includes(needle))
    return (
      <>
        {query.data.length >= SEARCH_FROM && (
          <div className="relative sm:max-w-xs">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-label={translate('searchDocuments')}
              placeholder={translate('searchDocuments')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-8"
            />
          </div>
        )}
        {shown.length === 0 ? (
          <div className={cardClass}>
            <EmptyState icon={SearchX} title={translate('noMatchingDocuments')}>
              {translate('tryAnotherName')}
            </EmptyState>
          </div>
        ) : (
          <ul className={cn(cardClass, 'grid divide-y overflow-hidden')}>
            {shown.map((doc) => (
              <li key={doc.id} className={rowClass}>
                <FileTile contentType={doc.content_type} />
                <span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
                  <span className="truncate text-body font-medium">{doc.name}</span>
                  <span className="truncate text-body-sm text-muted-foreground">
                    <span className="max-sm:hidden">{formatSize(doc.size)} · </span>
                    {sharedText(doc.shared_at, today)}
                  </span>
                </span>
                <DownloadLink
                  href={portalDocumentUrl(doc.id)}
                  label={translate('download2', { name: doc.name })}
                  text={translate('download')}
                />
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }

  return (
    <div className="grid gap-6 sm:gap-8">
      <PageHeader title={translate('documents')}>
        {translate('filesSharedWithYouDownloadAnyOfThemAt')}
      </PageHeader>
      {body()}
    </div>
  )
}
