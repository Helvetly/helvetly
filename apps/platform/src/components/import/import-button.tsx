'use client'

import { usePathname, useSearchParams } from 'next/navigation'

import { setUrlQuery } from '@/lib/url-query'

/** The drawer is open while the URL has `?import=1`, so Heidi and the "…" menu can open it too. */
export function useImportDrawer() {
  const pathname = usePathname()
  const query = useSearchParams()
  const go = (open: boolean) => {
    const next = new URLSearchParams(query)
    if (open) next.set('import', '1')
    else next.delete('import')
    setUrlQuery(pathname, next)
  }
  return { isOpen: query.get('import') === '1', open: () => go(true), close: () => go(false) }
}
