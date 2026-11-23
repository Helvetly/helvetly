'use client'
import { Button } from '@helvetly/ui/components/button'
import { Combobox } from '@helvetly/ui/components/combobox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Textarea } from '@helvetly/ui/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { CalendarCheck, MapPin, Pencil, Plus, Trash2, Video } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { apiFieldErrors, type FieldErrors } from '@/components/section-form'
import { SettingsEmpty, SettingsRow, SettingsSection } from '@/components/settings/layout'
import { translate } from '@/lib/i18n'
import { useMembers } from '@/lib/members'
import {
  durationText,
  useCreateEventType,
  useDeleteEventType,
  useEventTypes,
  useUpdateEventType,
  type EventType,
  type EventTypeInput,
} from '@/lib/scheduling-settings'

const blank = (): EventTypeInput => ({
  name: '',
  description: null,
  duration_minutes: 30,
  mode: 'online',
  meeting_provider: 'manual',
  location: null,
  product_id: null,
  unit_price: null,
  currency: null,
  host_ids: [],
  buffer_before: 0,
  buffer_after: 0,
  min_notice_minutes: 720,
  max_horizon_days: 60,
  slot_step_minutes: null,
  bookable: true,
  color: null,
})

const inRange = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max

/** What the form can tell before asking the server. */
export function eventTypeProblems(input: EventTypeInput): FieldErrors {
  const problems: FieldErrors = {}
  if (!input.name.trim()) problems.name = translate('schedulingSettingsEnterAName')
  if (!inRange(input.duration_minutes, 5, 720))
    problems.duration_minutes = translate('schedulingSettingsDurationRange')
  if (!inRange(input.buffer_before, 0, 240))
    problems.buffer_before = translate('schedulingSettingsBufferRange')
  if (!inRange(input.buffer_after, 0, 240))
    problems.buffer_after = translate('schedulingSettingsBufferRange')
  if (!inRange(input.max_horizon_days, 1, 365))
    problems.max_horizon_days = translate('schedulingSettingsHorizonRange')
  if (!inRange(input.min_notice_minutes, 0, 525600))
    problems.min_notice_minutes = translate('schedulingSettingsNoticeRange')
  return problems
}

/** Event types: what clients can book, with its length, buffers and who hosts it. Owners and admins edit. */
export function EventTypesSection({ canEdit }: { canEdit: boolean }) {
  const types = useEventTypes()
  const [editing, setEditing] = useState<EventType | 'new' | null>(null)
  const [deleting, setDeleting] = useState<EventType | null>(null)
  const remove = useDeleteEventType()
  const add = canEdit && (
    <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
      <Plus />
      {translate('schedulingSettingsNewEventType')}
    </Button>
  )
  const list = types.data?.filter((type) => !type.archived_at) ?? []
  return (
    <SettingsSection
      id="scheduling-event-types"
      icon={CalendarCheck}
      title={translate('schedulingSettingsEventTypes')}
      description={translate('schedulingSettingsEventTypesDescription')}
      action={list.length > 0 && add}
    >
      {types.error && !types.data ? (
        <p className="text-body text-muted-foreground">
          {translate('schedulingSettingsLoadFailed')}
        </p>
      ) : list.length === 0 ? (
        <SettingsEmpty
          icon={<CalendarCheck />}
          title={translate('schedulingSettingsNoEventTypes')}
          action={add || undefined}
        >
          {translate('schedulingSettingsNoEventTypesBody')}
        </SettingsEmpty>
      ) : (
        <ul className="grid max-w-[var(--settings-form,44rem)] divide-y">
          {list.map((type) => (
            <SettingsRow
              key={type.id}
              icon={type.mode === 'online' ? <Video /> : <MapPin />}
              title={type.name}
              meta={[
                durationText(type.duration_minutes),
                type.mode === 'online'
                  ? translate('schedulingSettingsOnline')
                  : translate('schedulingSettingsLive'),
                type.bookable ? translate('schedulingSettingsBookable') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              {canEdit ? (
                <>
                  <IconAction
                    label={translate('schedulingSettingsEditEventType', { name: type.name })}
                    tip={translate('schedulingSettingsEdit')}
                    onClick={() => setEditing(type)}
                  >
                    <Pencil />
                  </IconAction>
                  <IconAction
                    label={translate('schedulingSettingsDeleteEventType', { name: type.name })}
                    tip={translate('schedulingSettingsDelete')}
                    onClick={() => setDeleting(type)}
                  >
                    <Trash2 />
                  </IconAction>
                </>
              ) : null}
            </SettingsRow>
          ))}
        </ul>
      )}
      {editing && (
        <EventTypeDrawer
          type={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          tone="destructive"
          title={translate('schedulingSettingsDeleteTitle', { name: deleting.name })}
          body={translate('schedulingSettingsDeleteBody')}
          confirmLabel={translate('schedulingSettingsDelete')}
          onDecide={(approved) => {
            const type = deleting
            setDeleting(null)
            if (approved)
              remove.mutate(type.id, {
                onSuccess: () => toast.success(translate('schedulingSettingsEventTypeDeleted')),
                onError: toastError,
              })
          }}
        />
      )}
    </SettingsSection>
  )
}

function IconAction({
  label,
  tip,
  onClick,
  children,
}: {
  label: string
  tip: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          className="text-muted-foreground"
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

const numberField = (value: number) => (Number.isFinite(value) ? value : '')

/** One drawer to add or change an event type. */
function EventTypeDrawer({ type, onClose }: { type: EventType | null; onClose: () => void }) {
  const [draft, setDraft] = useState<EventTypeInput>(() => {
    if (!type) return blank()
    const { id: _id, archived_at: _archived, ...input } = type
    return input
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const members = useMembers()
  const create = useCreateEventType()
  const update = useUpdateEventType()
  const pending = create.isPending || update.isPending
  const set = (change: Partial<EventTypeInput>) => {
    setDraft((current) => ({ ...current, ...change }))
    setErrors({})
  }
  const number = (field: keyof EventTypeInput) => (event: { target: { value: string } }) =>
    set({ [field]: event.target.value === '' ? NaN : Number(event.target.value) })
  const submit = () => {
    const problems = eventTypeProblems(draft)
    if (Object.keys(problems).length > 0) return setErrors(problems)
    const input: EventTypeInput = {
      ...draft,
      name: draft.name.trim(),
      meeting_provider: draft.mode === 'online' ? (draft.meeting_provider ?? 'manual') : null,
      location: draft.mode === 'live' ? draft.location?.trim() || null : null,
    }
    const done = {
      onSuccess: () => {
        toast.success(translate('schedulingSettingsEventTypeSaved'))
        onClose()
      },
      onError: (error: unknown) => {
        const fields = apiFieldErrors(error)
        if (fields && Object.keys(fields).length > 0) setErrors(fields)
        else toastError(error)
      },
    }
    if (type) update.mutate({ ...input, id: type.id }, done)
    else create.mutate(input, done)
  }
  return (
    <Sheet open onOpenChange={(open) => !open && !pending && onClose()}>
      <SheetContent
        side="right"
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(560px,calc(100vw-6rem))]! dark:bg-card"
      >
        <div className="grid shrink-0 gap-0.5 border-b px-5 py-4 pr-12 md:px-8">
          <SheetTitle className="text-lg font-semibold">
            {type
              ? translate('schedulingSettingsEditEventTypeTitle')
              : translate('schedulingSettingsNewEventTypeTitle')}
          </SheetTitle>
          <SheetDescription className="text-body-sm">
            {translate('schedulingSettingsEventTypeDrawerDescription')}
          </SheetDescription>
        </div>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="grid flex-1 content-start gap-5 overflow-y-auto px-5 py-6 md:px-8">
            <FormField id="event-type-name" label={translate('name')} required error={errors.name}>
              <Input
                {...describedBy('event-type-name', errors.name)}
                maxLength={120}
                value={draft.name}
                placeholder={translate('schedulingSettingsEventTypeNamePlaceholder')}
                onChange={(event) => set({ name: event.target.value })}
              />
            </FormField>
            <FormField
              id="event-type-description"
              label={translate('schedulingSettingsDescription')}
            >
              <Textarea
                rows={2}
                maxLength={1000}
                value={draft.description ?? ''}
                onChange={(event) => set({ description: event.target.value || null })}
              />
            </FormField>
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                id="event-type-duration"
                label={translate('schedulingSettingsDuration')}
                error={errors.duration_minutes}
              >
                <Input
                  {...describedBy('event-type-duration', errors.duration_minutes)}
                  type="number"
                  inputMode="numeric"
                  value={numberField(draft.duration_minutes)}
                  onChange={number('duration_minutes')}
                  className="text-right tabular-nums"
                />
              </FormField>
              <FormField id="event-type-mode" label={translate('schedulingSettingsMode')} group>
                <Segmented
                  label={translate('schedulingSettingsMode')}
                  value={draft.mode}
                  onChange={(mode) => set({ mode })}
                  options={[
                    { value: 'online', label: translate('schedulingSettingsOnline') },
                    { value: 'live', label: translate('schedulingSettingsLive') },
                  ]}
                />
              </FormField>
            </div>
            {draft.mode === 'online' ? (
              <FormField id="event-type-meeting" label={translate('schedulingSettingsMeeting')}>
                <Combobox
                  id="event-type-meeting"
                  value={draft.meeting_provider ?? 'manual'}
                  placeholder={translate('schedulingSettingsMeeting')}
                  onChange={(value) =>
                    set({
                      meeting_provider:
                        value === 'google_meet' || value === 'teams' ? value : 'manual',
                    })
                  }
                  options={[
                    { value: 'manual', label: translate('schedulingSettingsMeetingManual') },
                    { value: 'google_meet', label: translate('schedulingSettingsMeetingGoogle') },
                    { value: 'teams', label: translate('schedulingSettingsMeetingTeams') },
                  ]}
                />
              </FormField>
            ) : (
              <FormField id="event-type-location" label={translate('schedulingSettingsLocation')}>
                <Input
                  maxLength={200}
                  value={draft.location ?? ''}
                  placeholder={translate('schedulingSettingsLocationPlaceholder')}
                  onChange={(event) => set({ location: event.target.value || null })}
                />
              </FormField>
            )}
            <FormField
              id="event-type-hosts"
              label={translate('schedulingSettingsHosts')}
              tip={translate('schedulingSettingsHostsTip')}
            >
              <Combobox
                id="event-type-hosts"
                value=""
                values={draft.host_ids}
                disabled={!members.data || members.data.length === 0}
                placeholder={translate('schedulingSettingsAnyHost')}
                options={(members.data ?? []).map((member) => ({
                  value: member.user_id,
                  label: member.name,
                }))}
                onChange={(id) =>
                  set({
                    host_ids: draft.host_ids.includes(id)
                      ? draft.host_ids.filter((one) => one !== id)
                      : [...draft.host_ids, id],
                  })
                }
                onClear={() => set({ host_ids: [] })}
                clearLabel={translate('schedulingSettingsAnyHost')}
              />
            </FormField>
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                id="event-type-buffer-before"
                label={translate('schedulingSettingsBufferBefore')}
                error={errors.buffer_before}
              >
                <Input
                  {...describedBy('event-type-buffer-before', errors.buffer_before)}
                  type="number"
                  inputMode="numeric"
                  value={numberField(draft.buffer_before)}
                  onChange={number('buffer_before')}
                  className="text-right tabular-nums"
                />
              </FormField>
              <FormField
                id="event-type-buffer-after"
                label={translate('schedulingSettingsBufferAfter')}
                error={errors.buffer_after}
              >
                <Input
                  {...describedBy('event-type-buffer-after', errors.buffer_after)}
                  type="number"
                  inputMode="numeric"
                  value={numberField(draft.buffer_after)}
                  onChange={number('buffer_after')}
                  className="text-right tabular-nums"
                />
              </FormField>
              <FormField
                id="event-type-min-notice"
                label={translate('schedulingSettingsMinNotice')}
                error={errors.min_notice_minutes}
                tip={translate('schedulingSettingsMinNoticeTip')}
              >
                <Input
                  {...describedBy('event-type-min-notice', errors.min_notice_minutes)}
                  type="number"
                  inputMode="numeric"
                  value={numberField(draft.min_notice_minutes)}
                  onChange={number('min_notice_minutes')}
                  className="text-right tabular-nums"
                />
              </FormField>
              <FormField
                id="event-type-horizon"
                label={translate('schedulingSettingsHorizon')}
                error={errors.max_horizon_days}
              >
                <Input
                  {...describedBy('event-type-horizon', errors.max_horizon_days)}
                  type="number"
                  inputMode="numeric"
                  value={numberField(draft.max_horizon_days)}
                  onChange={number('max_horizon_days')}
                  className="text-right tabular-nums"
                />
              </FormField>
            </div>
            <SwitchRow
              label={translate('schedulingSettingsBookableSwitch')}
              description={translate('schedulingSettingsBookableSwitchDescription')}
              checked={draft.bookable}
              onCheckedChange={(bookable) => set({ bookable })}
            />
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t px-5 py-3 md:px-7">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {translate('cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? translate('saving') : translate('schedulingSettingsSaveEventType')}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
