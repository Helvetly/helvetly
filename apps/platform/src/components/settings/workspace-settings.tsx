'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { Building2, FolderArchive, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { PlanTag, useFeatureLock } from '@/components/billing/feature-lock'
import { toastError } from '@/components/billing/upgrade-prompt'
import { Combobox, type Option } from '@/components/clients/fields'
import { MAX_WORKSPACE_NAME } from '@/components/onboarding/onboarding-model'
import { apiFieldErrors, useSectionForm } from '@/components/section-form'
import { setCsrfToken } from '@/lib/api'
import { useBilling } from '@/lib/billing'
import { translate } from '@/lib/i18n'
import { canManage, useDeleteWorkspace } from '@/lib/members'
import { useCan } from '@/lib/permissions'
import { useSession } from '@/lib/queries'
import { useUpdateWorkspace, type WorkspaceUpdate } from '@/lib/workspaces'

import { DangerRow, DangerZone } from './danger-zone'
import { EmailTemplatesSections } from './email-templates-settings'
import { ActionRow, FieldGrid, SettingsPage, SettingsSection } from './layout'
import { SettingsHeader } from './settings-tabs'
import { WorkspaceLogoSection } from './workspace-logo'

export function WorkspaceSettings() {
  const session = useSession().data
  // The email wording is read through the invoice settings' scope: without it the section stays out.
  const showEmails = useCan('read:invoice-settings')
  return (
    <>
      <SettingsHeader />
      <SettingsPage
        title={translate('workspace')}
        description={translate('theWorkspaceSNameAndTimeZoneAIAnswers')}
      >
        {session ? (
          <>
            <GeneralCard
              name={session.workspace.name}
              timezone={session.workspace.timezone ?? 'UTC'}
              membershipRole={session.role}
            />
            <WorkspaceLogoSection
              name={session.workspace.name}
              logoUrl={session.workspace.logo_url}
              canEdit={canManage(session.role)}
            />
            {showEmails && <EmailTemplatesSections />}
            {session.role === 'owner' && <ExportCard />}
            {session.role === 'owner' && <DeleteCard name={session.workspace.name} />}
          </>
        ) : (
          <Loader className="min-h-36" />
        )}
      </SettingsPage>
    </>
  )
}

const COMMON_ZONES = [
  'Europe/Zurich',
  'Europe/Berlin',
  'Europe/Vienna',
  'Europe/Paris',
  'Europe/Rome',
  'Europe/London',
  'Europe/Warsaw',
]

/** "Europe/Argentina/Buenos_Aires" → "Buenos Aires (Argentina)"; "Europe/Zurich" → "Zurich". */
export function zoneCity(zone: string): string {
  const parts = zone.split('/').map((part) => part.replaceAll('_', ' '))
  const city = parts.at(-1) ?? zone
  return parts.length > 2 ? `${city} (${parts.slice(1, -1).join(', ')})` : city
}

/** "12:07 · GMT+1": the zone's clock now and its offset, for the right side of a row. */
export function zoneClock(zone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'shortOffset',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ''
  return `${part('hour')}:${part('minute')} · ${part('timeZoneName')}`
}

/**
 * Every IANA time zone as its city, with its clock and offset as the hint, grouped by region; the
 * current one, the browser's and the usual DACH/EU ones first. `current` is always there.
 */
export function timeZoneOptions(current: string, now = new Date()): Option[] {
  const all = Intl.supportedValuesOf('timeZone')
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone
  const common = [...new Set([current, browser, ...COMMON_ZONES])]
  const option = (zone: string, group: string): Option => ({
    value: zone,
    label: zoneCity(zone),
    hint: zoneClock(zone, now),
    group,
  })
  return [
    ...common.map((zone) => option(zone, translate('suggested'))),
    ...all
      .filter((zone) => !common.includes(zone))
      .map((zone) =>
        option(zone, zone.includes('/') ? zone.slice(0, zone.indexOf('/')) : translate('other')),
      ),
  ]
}

export function GeneralCard({
  name,
  timezone,
  membershipRole,
}: {
  name: string
  timezone: string
  membershipRole: string
}) {
  const update = useUpdateWorkspace()
  const owner = membershipRole === 'owner'
  const canZone = owner || membershipRole === 'admin'
  const zones = useMemo(() => timeZoneOptions(timezone), [timezone])
  const form = useSectionForm({
    initial: { name, timezone },
    sections: [{ id: 'general', fields: ['name', 'timezone'] }],
    validate: (values) => (values.name.trim() ? {} : { name: translate('giveTheWorkspaceAName') }),
    save: (values, _, before) => {
      const changes: WorkspaceUpdate = {
        ...(values.name.trim() !== before.name.trim() && { name: values.name.trim() }),
        ...(values.timezone !== before.timezone && { timezone: values.timezone }),
      }
      return update.mutateAsync(changes)
    },
    fieldErrors: (error) => {
      const fields = apiFieldErrors(error)
      return fields?.timezone
        ? { ...fields, timezone: translate('chooseATimeZoneFromTheList') }
        : fields
    },
    savedMessage: () => translate('workspaceSaved'),
  })
  const section = form.section('general')

  return (
    <SettingsSection
      id="workspace-general"
      icon={Building2}
      title={translate('nameAndTimeZone')}
      description={translate('theNameIsShownInTheWorkspaceMenuAnd')}
      section={canZone ? section : undefined}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          section.save()
        }}
        noValidate
      >
        <FieldGrid>
          <FormField
            id="workspace-name"
            required
            label={translate('workspaceName')}
            width="md"
            error={form.errors.name}
            hint={owner ? undefined : translate('onlyAnOwnerCanRenameTheWorkspace')}
          >
            <Input
              {...describedBy('workspace-name', form.errors.name)}
              maxLength={MAX_WORKSPACE_NAME}
              disabled={!owner}
              value={form.values.name}
              onChange={(event) => form.set('name', event.target.value)}
            />
          </FormField>

          <FormField
            id="workspace-timezone"
            required
            label={translate('timeZone')}
            width="md"
            error={form.errors.timezone}
            tip={translate('usedForTodaySDateDueDatesEngagementPeriods')}
            hint={canZone ? undefined : translate('onlyAnOwnerOrAdminCanChangeTheTime')}
          >
            {canZone ? (
              <Combobox
                id="workspace-timezone"
                value={form.values.timezone}
                options={zones}
                renderValue={(option) => (
                  <span className="flex items-baseline gap-2">
                    {option.label}
                    <span className="text-muted-foreground tabular-nums">{option.hint}</span>
                  </span>
                )}
                contentClassName="w-96"
                invalid={Boolean(form.errors.timezone)}
                placeholder={translate('chooseATimeZone')}
                onChange={(next) => form.set('timezone', next)}
              />
            ) : (
              <Input id="workspace-timezone" disabled value={timezone} />
            )}
          </FormField>
        </FieldGrid>
      </form>
    </SettingsSection>
  )
}

function ExportCard() {
  const lock = useFeatureLock('data_export')
  return (
    <SettingsSection id="export-workspace" icon={FolderArchive} title={translate('yourData')}>
      <ActionRow
        title={translate('exportAllData')}
        description={translate('aZIPWithEveryRecordOfThisWorkspaceAs')}
      >
        {lock ? (
          <span className="flex items-center gap-2">
            <PlanTag lock={lock} />
            <Button size="sm" variant="outline" disabled>
              {translate('downloadExport')}
            </Button>
          </span>
        ) : (
          <Button asChild size="sm" variant="outline">
            <a href="/api/v1/workspace/export" download>
              {translate('downloadExport')}
            </a>
          </Button>
        )}
      </ActionRow>
    </SettingsSection>
  )
}

function DeleteCard({ name }: { name: string }) {
  const [open, setOpen] = useState(false)
  return (
    <DangerZone id="delete-workspace">
      <DangerRow
        title={translate('deleteWorkspace')}
        description={translate('everyoneLosesAccessToInvoicesAndReceiptsStayArchived', {
          name: name,
        })}
        action="Delete workspace"
        onAction={() => setOpen(true)}
      />
      {open && <DeleteDialog name={name} onClose={() => setOpen(false)} />}
    </DangerZone>
  )
}

/** Deletes the session's workspace once its name is typed; the plan picker opens it too. */
export function DeleteDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const router = useRouter()
  const remove = useDeleteWorkspace()
  const plan = useBilling().data
  const paid = plan?.enabled && plan.plan !== ''
  const [typed, setTyped] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    remove.mutate(typed.trim(), {
      onSuccess: ({ moved }) => {
        toast.success(translate('wasDeleted', { name: name }))
        if (moved) return router.replace('/')
        setCsrfToken('')
        router.replace('/login')
      },
      onError: toastError,
    })
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !remove.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate('delete7')}
            {name}”?
          </DialogTitle>
          <DialogDescription>
            {translate('membersInvitationsAndSessionsEndNowAndNobodyCan')}
            {paid && translate('itsSubscriptionIsCancelledImmediatelyWithoutARefundFor')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5">
          <FormField id="delete-confirm" label={translate('typeToConfirm2', { name: name })}>
            <Input
              id="delete-confirm"
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={remove.isPending}>
              {translate('keepIt')}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={typed.trim() !== name || remove.isPending}
            >
              <Trash2 /> {remove.isPending ? translate('deleting') : translate('deleteWorkspace')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
