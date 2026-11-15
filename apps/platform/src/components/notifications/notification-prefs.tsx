'use client'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@helvetly/ui/components/accordion'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { IconTile } from '@helvetly/ui/components/icon-tile'
import { Loader } from '@helvetly/ui/components/loader'
import { Switch } from '@helvetly/ui/components/switch'
import { Bell, Mail } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'

import { LoadError } from '@/components/load-error'
import { SectionFooter, useSectionForm, type SectionState } from '@/components/section-form'
import { translate } from '@/lib/i18n'
import {
  categoryOf,
  EVENT_LABELS,
  useNotificationPrefs,
  useSaveNotificationPrefs,
  type NotificationChoice,
  type NotificationPrefs,
} from '@/lib/notifications'

/**
 * The person's own notifications, per event an email and the bell, saved together: the body of the
 * preferences drawer (it scrolls) with the Save bar under it.
 */
export function NotificationPrefs() {
  const prefs = useNotificationPrefs()
  if (prefs.data) return <PrefsForm prefs={prefs.data} />
  return (
    <div className="flex-1 px-4 py-4 sm:px-5">
      {prefs.isError ? (
        <LoadError
          what={translate('notificationSettings')}
          error={prefs.error}
          onRetry={() => void prefs.refetch()}
        />
      ) : (
        <Loader className="min-h-40" />
      )}
    </div>
  )
}

function PrefsForm({ prefs }: { prefs: NotificationPrefs }) {
  const save = useSaveNotificationPrefs()
  const form = useSectionForm({
    initial: { events: prefs.events },
    sections: [{ id: 'notifications', fields: ['events'] }],
    save: ({ events }) => save.mutateAsync(events),
    savedMessage: () => translate('notificationSettingsSaved'),
  })
  const state = form.section('notifications')
  const events = form.values.events
  const grouped = groups(events)
  const set = (event: string, key: Channel, value: boolean) =>
    form.set(
      'events',
      events.map((c) => (c.event === event ? { ...c, [key]: value } : c)),
    )

  const setAll = (choices: NotificationChoice[], key: Channel, value: boolean) => {
    const names = new Set(
      choices.filter((c) => key === 'in_app' || c.email_available).map((c) => c.event),
    )
    form.set(
      'events',
      events.map((c) => (names.has(c.event) ? { ...c, [key]: value } : c)),
    )
  }

  return (
    <Body attach={state.attach}>
      <div className="grid flex-1 content-start gap-3 overflow-y-auto px-4 py-4 sm:px-5">
        <p className="text-body-sm text-muted-foreground">
          {translate('emailsGoTo')}
          <span className="text-foreground">{prefs.email}</span>
        </p>
        {!prefs.mail_ready && (
          <p className="rounded-lg bg-muted/60 px-3.5 py-2.5 text-body-sm text-muted-foreground">
            {translate('thisServerCanTSendEmailYetSoOnly')}
          </p>
        )}
        <div className="grid min-w-0">
          <ColumnLabels />
          <Accordion
            type="multiple"
            defaultValue={grouped.slice(0, 1).map(([category]) => category)}
          >
            {grouped.map(([category, choices]) => (
              <Group
                key={category}
                category={category}
                choices={choices}
                set={set}
                setAll={(key, value) => setAll(choices, key, value)}
              />
            ))}
          </Accordion>
        </div>
      </div>
      <div className="border-t px-4 py-2 sm:px-5">
        {/* In the drawer the bar sits under the list on phones too, never over it. */}
        <SectionFooter state={state} className="max-sm:static" />
      </div>
    </Body>
  )
}

/** The drawer's body; ⌘/Ctrl+Enter anywhere inside saves. */
function Body({ attach, children }: { attach: SectionState['attach']; children: ReactNode }) {
  return (
    <div ref={attach} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  )
}

/** The named events by category, in the server's order; categories without a named event are left out. */
function groups(events: NotificationChoice[]) {
  const out = new Map<string, NotificationChoice[]>()
  for (const c of events) {
    if (!EVENT_LABELS[c.event]) continue
    // An older server sends no category: those events still get one group (and a key).
    const category = c.category || 'other'
    out.set(category, [...(out.get(category) ?? []), c])
  }
  return [...out]
}

type Channel = 'email' | 'in_app'

/** One column per channel; the header, the group switches and the rows share it so they line up. */
const COLUMN = 'flex w-14 shrink-0 justify-center sm:w-20'

/** The column names, once above the groups (every switch also carries its own label). */
function ColumnLabels() {
  return (
    <div aria-hidden className="flex justify-end pr-2 text-body-sm text-muted-foreground">
      <span className={`${COLUMN} items-center gap-1 sm:gap-1.5`}>
        <Mail className="size-3.5" />
        {translate('email3')}
      </span>
      <span className={`${COLUMN} items-center gap-1 sm:gap-1.5`}>
        <Bell className="size-3.5" />
        {translate('bell2')}
      </span>
    </div>
  )
}

/** "3 of 7 by email · 7 of 7 in the bell": the group's switches at a glance, read while it is closed. */
export function groupSummary(choices: NotificationChoice[]) {
  const emailable = choices.filter((c) => c.email_available)
  const bell = translate('ofInTheBell', {
    length: choices.filter((c) => c.in_app).length,
    value2: choices.length,
  })
  if (emailable.length === 0) return translate('noEmail', { bell: bell })
  return translate('ofByEmail', {
    length: emailable.filter((c) => c.email).length,
    value2: emailable.length,
    bell: bell,
  })
}

/** All on, all off, or some ("indeterminate", shown as a dash). */
export function groupState(values: boolean[]): boolean | 'indeterminate' {
  if (values.every(Boolean)) return true
  if (values.some(Boolean)) return 'indeterminate'
  return false
}

function Group({
  category,
  choices,
  set,
  setAll,
}: {
  category: string
  choices: NotificationChoice[]
  set: (event: string, key: Channel, value: boolean) => void
  setAll: (key: Channel, value: boolean) => void
}) {
  const { label, icon } = categoryOf(category)
  const emailable = choices.filter((c) => c.email_available)
  const groupSwitch = (key: Channel, values: boolean[], name: string) => {
    if (values.length === 0) return <NoEmail what="group" />
    const state = groupState(values)
    return (
      <Checkbox
        checked={state}
        // A mixed group turns everything on, like most "select all" boxes.
        onCheckedChange={() => setAll(key, state !== true)}
        aria-label={translate('every2', { label: label, name: name })}
      />
    )
  }
  return (
    <AccordionItem value={category}>
      <AccordionTrigger
        actions={
          <div className="flex pr-2">
            <span className={COLUMN}>
              {groupSwitch(
                'email',
                emailable.map((c) => c.email),
                'email',
              )}
            </span>
            <span className={COLUMN}>
              {groupSwitch(
                'in_app',
                choices.map((c) => c.in_app),
                'bell',
              )}
            </span>
          </div>
        }
      >
        <IconTile
          icon={icon}
          size="sm"
          variant={category === 'ai' ? 'heidi' : 'row'}
          className="max-sm:hidden"
        />
        <span className="grid min-w-0 gap-0.5">
          <span className="text-body font-medium">{label}</span>
          <span className="text-body-sm text-muted-foreground">
            {groupSummary(choices)
              .split(' · ')
              .map((part, i) => (
                // Each count wraps as a whole on a phone; the space between them may break.
                <Fragment key={part}>
                  {i > 0 && ' · '}
                  <span className="whitespace-nowrap">{part}</span>
                </Fragment>
              ))}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent>
        <ul aria-label={label} className="pb-2">
          {choices.map((c) => {
            const named = EVENT_LABELS[c.event]
            if (!named) return null
            return (
              <li key={c.event} className="flex items-center py-2 pr-2 pl-8 sm:pl-[4.5rem]">
                <span className="grid min-w-0 flex-1 gap-0.5 pr-2">
                  <span className="text-body font-medium">{named.label}</span>
                  <span className="text-body-sm text-pretty text-muted-foreground">
                    {named.hint}
                  </span>
                </span>
                <span className={COLUMN}>
                  {c.email_available ? (
                    <Switch
                      checked={c.email}
                      onCheckedChange={(v) => set(c.event, 'email', v)}
                      aria-label={translate('email2', { label: named.label })}
                    />
                  ) : (
                    // Signatures already email the sender themselves.
                    <NoEmail what="event" />
                  )}
                </span>
                <span className={COLUMN}>
                  <Switch
                    checked={c.in_app}
                    onCheckedChange={(v) => set(c.event, 'in_app', v)}
                    aria-label={translate('bell', { label: named.label })}
                  />
                </span>
              </li>
            )
          })}
        </ul>
      </AccordionContent>
    </AccordionItem>
  )
}

function NoEmail({ what }: { what: 'event' | 'group' }) {
  return (
    <span className="text-caption text-muted-foreground">
      <span aria-hidden>–</span>
      <span className="sr-only">
        {translate('noEmailForThis')}
        {what}
      </span>
    </span>
  )
}
