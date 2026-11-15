'use client'
import { Loader } from '@helvetly/ui/components/loader'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'

import { translate } from '@/lib/i18n'

/**
 * Loaded, or failed at least once: a form then starts from its own defaults instead of waiting forever.
 * Not `!isPending`: `isPending` turns true again when the form's own observer refetches a failed query.
 */
export const settled = (query: { data: unknown; errorUpdateCount: number }) =>
  query.data !== undefined || query.errorUpdateCount > 0

/**
 * Stands in for a new-record form while the settings its first values come from still load, so the form
 * never starts from built-in fallbacks (CHF, VAT-registered) that the workspace does not use.
 */
export function FormSheetLoading({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(900px,calc(100vw-6rem))]! dark:bg-card"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{translate('loading2')}</SheetDescription>
        <Loader className="flex-1" />
      </SheetContent>
    </Sheet>
  )
}
