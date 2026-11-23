'use client'

import { FileUp } from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'

import { PlanTag, useFeatureLock } from '@/components/billing/feature-lock'
import type { MenuKit } from '@/components/data/menus'
import { useAI } from '@/lib/ai'
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

/** A menu's AI import, or, on a plan without it, a disabled item naming the plan that has it. */
export function ImportItem({
  Item,
  onSelect,
  children,
}: {
  Item: MenuKit['Item']
  onSelect: () => void
  children: ReactNode
}) {
  const lock = useFeatureLock('ai_import')
  const ai = useAI()
  // AI import needs the installation's model: without one there is no item.
  if (!ai.available) return null
  return (
    <Item disabled={Boolean(lock)} onSelect={onSelect}>
      <FileUp />
      {children}
      {lock && <PlanTag lock={lock} />}
    </Item>
  )
}
