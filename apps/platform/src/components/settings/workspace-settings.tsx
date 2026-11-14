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

import { toastError } from '@/components/billing/upgrade-prompt'
import { Combobox, type Option } from '@/components/clients/fields'
import { AIConsentCard } from '@/components/heidi/ai-consent'
import { apiFieldErrors, useSectionForm } from '@/components/section-form'
import { setCsrfToken } from '@/lib/api'
import { useBilling } from '@/lib/billing'
import { useDeleteWorkspace } from '@/lib/members'
import { useSession } from '@/lib/queries'
import { useUpdateWorkspace, type WorkspaceUpdate } from '@/lib/workspaces'

import { DangerRow, DangerZone } from './danger-zone'
import { ActionRow, FieldGrid, SettingsPage, SettingsSection } from './layout'
import { SettingsHeader } from './settings-tabs'

export function WorkspaceSettings() {
  const session = useSession().data
  return (
    <>
      <SettingsHeader />
      <SettingsPage
        title="Workspace"
        description="The workspace’s name and time zone, AI answers, exporting and deleting it. Each workspace has its own members, data and plan."
      >
        {session ? (
          <>
            <GeneralCard
              name={session.workspace.name}
              timezone={session.workspace.timezone ?? 'UTC'}
              membershipRole={session.role}
            />
            <AIConsentCard />
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
    ...common.map((zone) => option(zone, 'Suggested')),
    ...all
      .filter((zone) => !common.includes(zone))
      .map((zone) => option(zone, zone.includes('/') ? zone.slice(0, zone.indexOf('/')) : 'Other')),
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
    validate: (values) => (values.name.trim() ? {} : { name: 'Give the workspace a name.' }),
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
        ? { ...fields, timezone: 'Choose a time zone from the list.' }
        : fields
    },
    savedMessage: () => 'Workspace saved.',
  })
  const section = form.section('general')

  return (
    <SettingsSection
      id="workspace-general"
      icon={Building2}
      title="Name and time zone"
      description="The name is shown in the workspace menu and to the people you invite."
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
            label="Workspace name"
            width="md"
            error={form.errors.name}
            hint={owner ? undefined : 'Only an owner can rename the workspace.'}
          >
            <Input
              {...describedBy('workspace-name', form.errors.name)}
              maxLength={100}
              disabled={!owner}
              value={form.values.name}
              onChange={(event) => form.set('name', event.target.value)}
            />
          </FormField>

          <FormField
            id="workspace-timezone"
            label="Time zone"
            width="md"
            error={form.errors.timezone}
            tip="Used for today’s date, due dates, engagement periods and the daily digest. Issued invoices keep their dates."
            hint={canZone ? undefined : 'Only an owner or admin can change the time zone.'}
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
                placeholder="Choose a time zone"
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
  return (
    <SettingsSection id="export-workspace" icon={FolderArchive} title="Your data">
      <ActionRow
        title="Export all data"
        description="A ZIP with every record of this workspace as JSON, deleted and voided ones included, and its stored files: documents, receipts, issued invoices and e-invoices. Large workspaces take a while."
      >
        <Button asChild size="sm" variant="outline">
          <a href="/api/v1/workspace/export" download>
            Download export
          </a>
        </Button>
      </ActionRow>
    </SettingsSection>
  )
}

function DeleteCard({ name }: { name: string }) {
  const [open, setOpen] = useState(false)
  return (
    <DangerZone id="delete-workspace">
      <DangerRow
        title="Delete workspace"
        description={`Everyone loses access to ${name}. Invoices and receipts stay archived for the ten years Swiss law requires; a paid plan ends at once. This can’t be undone.`}
        action="Delete workspace"
        onAction={() => setOpen(true)}
      />
      {open && <DeleteDialog name={name} onClose={() => setOpen(false)} />}
    </DangerZone>
  )
}

function DeleteDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const router = useRouter()
  const remove = useDeleteWorkspace()
  const plan = useBilling().data
  const paid = plan?.enabled && plan.plan !== ''
  const [typed, setTyped] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    remove.mutate(typed.trim(), {
      onSuccess: ({ moved }) => {
        toast.success(`${name} was deleted.`)
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
          <DialogTitle>Delete “{name}”?</DialogTitle>
          <DialogDescription>
            Members, invitations and sessions end now and nobody can open it again.
            {paid &&
              ' Its subscription is cancelled immediately, without a refund for the rest of the period.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5">
          <FormField id="delete-confirm" label={`Type ${name} to confirm`}>
            <Input
              id="delete-confirm"
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={remove.isPending}>
              Keep it
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={typed.trim() !== name || remove.isPending}
            >
              <Trash2 /> {remove.isPending ? 'Deleting…' : 'Delete workspace'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
