import { Button } from '@helvetly/ui/components/button'
import { TriangleAlert, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { translate } from '@/lib/i18n'

import { SettingsSection } from './layout'

/**
 * What can't be undone, as a settings page's last section: "Danger zone" in red on the left, its
 * rows in one red-edged box on the right (GitHub-style), each with a red outline button.
 */
export function DangerZone({ id, children }: { id: string; children: ReactNode }) {
  return (
    <SettingsSection
      id={id}
      icon={TriangleAlert}
      tone="danger"
      title={translate('dangerZone')}
      description={translate('theseActionsCanTBeUndone')}
    >
      <div
        data-slot="danger-zone"
        className="divide-y divide-destructive/15 rounded-xl border border-destructive/35 dark:divide-destructive/25 dark:border-destructive/40"
      >
        {children}
      </div>
    </SettingsSection>
  )
}

/** One irreversible action in a DangerZone: what it does on the left, its button on the right. */
export function DangerRow({
  title,
  description,
  action,
  onAction,
}: {
  title: string
  description: ReactNode
  action: string
  onAction: () => void
}) {
  return (
    <div
      data-slot="danger-row"
      className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 px-4 py-4 sm:px-5"
    >
      <div className="grid min-w-0 flex-1 basis-64 gap-0.5">
        <p className="text-body font-medium">{title}</p>
        <p className="text-body-sm leading-relaxed text-pretty text-muted-foreground">
          {description}
        </p>
      </div>
      <Button variant="destructive-outline" size="sm" onClick={onAction} className="shrink-0">
        <Trash2 aria-hidden /> {action}
      </Button>
    </div>
  )
}
