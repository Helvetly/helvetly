'use client'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { Segmented } from '@helvetly/ui/components/segmented'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { cn } from '@helvetly/ui/lib/utils'
import { Bell, CalendarDays, CalendarX2, MapPin } from 'lucide-react'
import { useState } from 'react'

import { apiFieldErrors, useSectionForm } from '@/components/section-form'
import {
  FieldGrid,
  SettingsEmpty,
  SettingsPage,
  SettingsPreview,
  SettingsSection,
} from '@/components/settings/layout'
import { isManager, SettingsHeader } from '@/components/settings/settings-tabs'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { useCan } from '@/lib/permissions'
import { useSession } from '@/lib/queries'
import {
  isClock,
  MAX_NOTICE_MINUTES,
  policySentence,
  presetText,
  useSaveSchedulingSettings,
  useSchedulingSettings,
  weekdayName,
  type SchedulingSettings,
} from '@/lib/scheduling-settings'

import { DurationSelect } from './duration-select'
import { EventTypesSection } from './event-types'
import { HolidaysSection } from './holidays'
import { LeadTimeChips } from './lead-time-chips'

type SectionId = 'booking' | 'policy' | 'reminders' | 'calendar'

const SECTIONS: { id: SectionId; fields: (keyof SchedulingSettings & string)[] }[] = [
  { id: 'booking', fields: ['booking_mode', 'confirmation'] },
  {
    id: 'policy',
    fields: [
      'notice_minutes',
      'cutoff_time',
      'cutoff_days',
      'cutoff_skips_holidays',
      'auto_approve_on_time',
      'late_cancel_counts',
      'no_show_counts',
      'late_reschedule_counts',
    ],
  },
  { id: 'reminders', fields: ['client_reminders', 'host_reminders', 'auto_attended_after_hours'] },
  { id: 'calendar', fields: ['feed_details', 'default_location'] },
]

const NOTICE_PRESETS = [0, 60, 120, 240, 720, 1440, 2880, 4320, 10080]
const AUTO_ATTEND_PRESETS = [60, 120, 240, 720, 1440, 2880, 4320, 10080]

/** The free-cancellation notice in one sentence, under its field. */
function noticeExplained(minutes: number) {
  if (!Number.isFinite(minutes)) return undefined
  if (minutes <= 0) return translate('schedulingSettingsPolicyAnytime')
  return `${translate('schedulingSettingsPolicyFree', { notice: presetText(minutes) })} ${translate('schedulingSettingsNoticeLate')}`
}

export function settingsProblems(values: SchedulingSettings) {
  const problems: Record<string, string> = {}
  if (
    !Number.isInteger(values.notice_minutes) ||
    values.notice_minutes < 0 ||
    values.notice_minutes > MAX_NOTICE_MINUTES
  )
    problems.notice_minutes = translate('schedulingSettingsNoticeRange')
  if (values.cutoff_time !== null && !isClock(values.cutoff_time))
    problems.cutoff_time = translate('schedulingSettingsCutoffInvalid')
  if (values.cutoff_time !== null && values.cutoff_days.length === 0)
    problems.cutoff_days = translate('schedulingSettingsCutoffDaysNeeded')
  const after = values.auto_attended_after_hours
  if (after !== null && (!Number.isInteger(after) || after < 1 || after > 720))
    problems.auto_attended_after_hours = translate('schedulingSettingsAutoAttendRange')
  return problems
}

/** Settings → Scheduling: how clients book and cancel, reminders, event types and holidays. Owners and admins edit. */
export function SchedulingSettingsPage() {
  const canRead = useCan('read:scheduling')
  const manager = isManager(useSession().data?.role)
  return (
    <>
      <SettingsHeader />
      <SettingsPage
        title={translate('schedulingSettingsTitle')}
        description={translate('schedulingSettingsPageDescription')}
      >
        {canRead ? (
          <Settings canEdit={manager} />
        ) : (
          <SettingsEmpty icon={<CalendarDays />} title={translate('schedulingSettingsNoAccess')}>
            {translate('schedulingSettingsNoAccessBody')}
          </SettingsEmpty>
        )}
      </SettingsPage>
    </>
  )
}

function Settings({ canEdit }: { canEdit: boolean }) {
  const settings = useSchedulingSettings()
  if (settings.error && !settings.data)
    return <p className="text-body text-muted-foreground">{errorMessage(settings.error)}</p>
  if (!settings.data) return <Loader className="min-h-64" />
  return (
    <>
      {!canEdit && (
        <output className="block text-body-sm text-muted-foreground">
          {translate('schedulingSettingsReadOnly')}
        </output>
      )}
      {/* Keyed by what was saved last, so a refetch starts the form from it. */}
      <SettingsForm key={JSON.stringify(settings.data)} saved={settings.data} canEdit={canEdit} />
      <EventTypesSection canEdit={canEdit} />
      <HolidaysSection canEdit={canEdit} />
    </>
  )
}

function SettingsForm({ saved, canEdit }: { saved: SchedulingSettings; canEdit: boolean }) {
  const save = useSaveSchedulingSettings()
  const form = useSectionForm<SchedulingSettings, SectionId>({
    initial: saved,
    sections: SECTIONS,
    validate: settingsProblems,
    save: (values) => save.mutateAsync(values),
    fieldErrors: apiFieldErrors,
    savedMessage: () => translate('schedulingSettingsSaved'),
  })
  const v = form.values
  const e = form.errors
  const [clock, setClock] = useState(v.cutoff_time ?? '14:00')
  const footer = (id: SectionId) => (canEdit ? form.section(id) : undefined)

  return (
    <>
      <SettingsSection
        id="scheduling-booking"
        icon={CalendarDays}
        title={translate('schedulingSettingsBooking')}
        description={translate('schedulingSettingsBookingDescription')}
        section={footer('booking')}
      >
        <fieldset disabled={!canEdit} className="grid max-w-[var(--settings-form,44rem)] gap-4">
          <FormField id="booking-mode" label={translate('schedulingSettingsWhoSchedules')} group>
            <Segmented
              label={translate('schedulingSettingsWhoSchedules')}
              value={v.booking_mode}
              onChange={(mode) => form.set('booking_mode', mode)}
              options={[
                { value: 'staff', label: translate('schedulingSettingsOnlyWe') },
                { value: 'clients', label: translate('schedulingSettingsClientsToo') },
              ]}
            />
          </FormField>
          {v.booking_mode === 'clients' && (
            <FormField
              id="booking-confirmation"
              label={translate('schedulingSettingsConfirmation')}
              group
              hint={
                v.confirmation === 'auto'
                  ? translate('schedulingSettingsConfirmAutoHint')
                  : translate('schedulingSettingsConfirmManualHint')
              }
            >
              <Segmented
                label={translate('schedulingSettingsConfirmation')}
                value={v.confirmation}
                onChange={(confirmation) => form.set('confirmation', confirmation)}
                options={[
                  { value: 'auto', label: translate('schedulingSettingsConfirmAuto') },
                  { value: 'manual', label: translate('schedulingSettingsConfirmManual') },
                ]}
              />
            </FormField>
          )}
        </fieldset>
      </SettingsSection>

      <SettingsSection
        id="scheduling-policy"
        icon={CalendarX2}
        title={translate('schedulingSettingsPolicy')}
        description={translate('schedulingSettingsPolicyDescription')}
        section={footer('policy')}
      >
        <fieldset disabled={!canEdit} className="grid max-w-[var(--settings-form,44rem)] gap-4">
          <FieldGrid>
            <FormField
              id="policy-notice"
              label={translate('schedulingSettingsNotice')}
              width="md"
              error={e.notice_minutes}
              tip={translate('schedulingSettingsNoticeTip')}
              status={noticeExplained(v.notice_minutes)}
            >
              <DurationSelect
                id="policy-notice"
                value={v.notice_minutes}
                onChange={(minutes) => form.set('notice_minutes', minutes)}
                presets={NOTICE_PRESETS}
                units={['hours', 'days']}
                suffix="before"
                zero={translate('schedulingSettingsNoticeAnytime')}
                invalid={Boolean(e.notice_minutes)}
              />
            </FormField>
          </FieldGrid>
          <SwitchRow
            label={translate('schedulingSettingsCutoff')}
            description={translate('schedulingSettingsCutoffDescription')}
            checked={v.cutoff_time !== null}
            onCheckedChange={(on) => form.set('cutoff_time', on ? clock : null)}
          />
          {v.cutoff_time !== null && (
            <>
              <FieldGrid>
                <FormField
                  id="policy-cutoff-time"
                  label={translate('schedulingSettingsCutoffTime')}
                  width="xs"
                  error={e.cutoff_time}
                >
                  <Input
                    {...describedBy('policy-cutoff-time', e.cutoff_time)}
                    type="time"
                    value={v.cutoff_time}
                    onChange={(event) => {
                      setClock(event.target.value)
                      form.set('cutoff_time', event.target.value)
                    }}
                  />
                </FormField>
              </FieldGrid>
              <FormField
                id="policy-cutoff-days"
                label={translate('schedulingSettingsCutoffDays')}
                group
                error={e.cutoff_days}
              >
                <WeekdayPicker
                  label={translate('schedulingSettingsCutoffDays')}
                  value={v.cutoff_days}
                  onChange={(days) => form.set('cutoff_days', days)}
                />
              </FormField>
              <SwitchRow
                label={translate('schedulingSettingsCutoffSkipsHolidays')}
                checked={v.cutoff_skips_holidays}
                onCheckedChange={(on) => form.set('cutoff_skips_holidays', on)}
              />
            </>
          )}
          <SwitchRow
            label={translate('schedulingSettingsLateCounts')}
            description={translate('schedulingSettingsLateCountsDescription')}
            checked={v.late_cancel_counts}
            onCheckedChange={(on) => form.set('late_cancel_counts', on)}
          />
          <SwitchRow
            label={translate('schedulingSettingsNoShowCounts')}
            description={translate('schedulingSettingsNoShowCountsDescription')}
            checked={v.no_show_counts}
            onCheckedChange={(on) => form.set('no_show_counts', on)}
          />
          <SwitchRow
            label={translate('schedulingSettingsLateRescheduleCounts')}
            description={translate('schedulingSettingsLateRescheduleCountsDescription')}
            checked={v.late_reschedule_counts}
            onCheckedChange={(on) => form.set('late_reschedule_counts', on)}
          />
          <SwitchRow
            label={translate('schedulingSettingsAutoApprove')}
            description={translate('schedulingSettingsAutoApproveDescription')}
            checked={v.auto_approve_on_time}
            onCheckedChange={(on) => form.set('auto_approve_on_time', on)}
          />
          <SettingsPreview label={translate('schedulingSettingsPolicyExample')}>
            {policySentence(v)}
          </SettingsPreview>
        </fieldset>
      </SettingsSection>

      <SettingsSection
        id="scheduling-reminders"
        icon={Bell}
        title={translate('schedulingSettingsReminders')}
        description={translate('schedulingSettingsRemindersDescription')}
        section={footer('reminders')}
      >
        <fieldset disabled={!canEdit} className="grid max-w-[var(--settings-form,44rem)] gap-5">
          <FormField
            id="reminders-client"
            label={translate('schedulingSettingsClientReminders')}
            group
          >
            <LeadTimeChips
              id="reminders-client"
              label={translate('schedulingSettingsClientReminders')}
              value={v.client_reminders}
              onChange={(minutes) => form.set('client_reminders', minutes)}
            />
          </FormField>
          <FormField id="reminders-host" label={translate('schedulingSettingsHostReminders')} group>
            <LeadTimeChips
              id="reminders-host"
              label={translate('schedulingSettingsHostReminders')}
              value={v.host_reminders}
              onChange={(minutes) => form.set('host_reminders', minutes)}
            />
          </FormField>
          <SwitchRow
            label={translate('schedulingSettingsAutoAttend')}
            description={translate('schedulingSettingsAutoAttendDescription')}
            checked={v.auto_attended_after_hours !== null}
            onCheckedChange={(on) => form.set('auto_attended_after_hours', on ? 24 : null)}
          />
          {v.auto_attended_after_hours !== null && (
            <FieldGrid>
              <FormField
                id="reminders-auto-attend"
                label={translate('schedulingSettingsAutoAttendAfter')}
                width="md"
                error={e.auto_attended_after_hours}
              >
                <DurationSelect
                  id="reminders-auto-attend"
                  value={v.auto_attended_after_hours * 60}
                  onChange={(minutes) => form.set('auto_attended_after_hours', minutes / 60)}
                  presets={AUTO_ATTEND_PRESETS}
                  units={['hours', 'days']}
                  suffix="after"
                  invalid={Boolean(e.auto_attended_after_hours)}
                />
              </FormField>
            </FieldGrid>
          )}
        </fieldset>
      </SettingsSection>

      <SettingsSection
        id="scheduling-calendar"
        icon={MapPin}
        title={translate('schedulingSettingsCalendar')}
        description={translate('schedulingSettingsCalendarDescription')}
        section={footer('calendar')}
      >
        <fieldset disabled={!canEdit} className="grid max-w-[var(--settings-form,44rem)] gap-4">
          <FormField
            id="calendar-feed-details"
            group
            label={translate('schedulingSettingsFeedDetails')}
            tip={translate('schedulingSettingsFeedDetailsHelp')}
          >
            <Segmented
              label={translate('schedulingSettingsFeedDetails')}
              value={v.feed_details}
              onChange={(details) => form.set('feed_details', details)}
              options={[
                { value: 'full', label: translate('schedulingSettingsFeedFull') },
                { value: 'busy', label: translate('schedulingSettingsFeedBusy') },
              ]}
            />
          </FormField>
          <FieldGrid>
            <FormField
              id="calendar-location"
              label={translate('schedulingSettingsDefaultLocation')}
              width="lg"
              hint={translate('schedulingSettingsDefaultLocationHint')}
            >
              <Input
                maxLength={200}
                value={v.default_location ?? ''}
                placeholder={translate('schedulingSettingsDefaultLocationPlaceholder')}
                onChange={(event) => form.set('default_location', event.target.value || null)}
              />
            </FormField>
          </FieldGrid>
        </fieldset>
      </SettingsSection>
    </>
  )
}

/** Mon … Sun as toggle buttons (ISO numbers, 1 = Monday). */
export function WeekdayPicker({
  label,
  value,
  onChange,
  className,
}: {
  label: string
  value: number[]
  onChange: (days: number[]) => void
  className?: string
}) {
  return (
    <fieldset aria-label={label} className={cn('flex min-w-0 flex-wrap gap-1.5', className)}>
      {[1, 2, 3, 4, 5, 6, 7].map((day) => {
        const on = value.includes(day)
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            className={cn(
              'h-8 min-w-11 rounded-full border px-3 text-body-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
              on
                ? 'border-transparent bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() =>
              onChange(on ? value.filter((d) => d !== day) : [...value, day].toSorted())
            }
          >
            {weekdayName(day)}
          </button>
        )
      })}
    </fieldset>
  )
}
