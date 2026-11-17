'use client'
import { Button } from '@helvetly/ui/components/button'
import { ArchiveRestore, Building2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { SettingsRow, SettingsSection } from '@/components/settings/layout'
import { translate } from '@/lib/i18n'
import { useDeletedWorkspaces, useRestoreWorkspace } from '@/lib/members'

const date = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso))

/** Workspaces this person deleted and can still bring back; the section stays out when there are none. */
export function DeletedWorkspaces() {
  const router = useRouter()
  const deleted = useDeletedWorkspaces().data
  const restore = useRestoreWorkspace()
  if (!deleted?.length) return null
  return (
    <SettingsSection
      id="deleted-workspaces"
      icon={ArchiveRestore}
      title={translate('deletedWorkspaces')}
      description={translate('restoreAWorkspaceYouDeletedWithinThirtyDays')}
    >
      <ul className="grid">
        {deleted.map((item) => {
          const pending = restore.isPending && restore.variables === item.id
          return (
            <SettingsRow
              key={item.id}
              icon={<Building2 />}
              title={item.name}
              meta={translate('deletedOnCanBeRestoredUntil', {
                deleted: date(item.deleted_at),
                until: date(item.restore_until),
              })}
            >
              <Button
                size="sm"
                variant="outline"
                disabled={restore.isPending}
                onClick={() =>
                  restore.mutate(item.id, {
                    onSuccess: () => {
                      toast.success(translate('wasRestored', { name: item.name }))
                      router.replace('/')
                    },
                    onError: toastError,
                  })
                }
              >
                {pending ? translate('restoring') : translate('restore')}
              </Button>
            </SettingsRow>
          )
        })}
      </ul>
    </SettingsSection>
  )
}
