'use client'

import type { Action } from '@helvetly/ui/components/action-menu'
import { FileUp } from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'

import { PlanTag, useFeatureLock } from '@/components/billing/feature-lock'
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

/**
 * A menu's AI import, or, on a plan without it, a disabled action naming the plan that has it;
 * null on an installation without AI.
 */
export function useImportAction(label: string, onSelect: () => void): Action | null {
  const lock = useFeatureLock('ai_import')
  const ai = useAI()
  // AI import needs the installation's model: without one there is no action.
  if (!ai.available) return null
  return {
    id: 'import',
    group: 'create',
    icon: <FileUp />,
    label,
    onSelect,
    disabledReason: lock?.hint,
    extra: lock && <PlanTag lock={lock} />,
  }
}
