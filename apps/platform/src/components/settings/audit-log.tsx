'use client'
import { languageTag, localizedHref } from '@helvetly/i18n'
import { TONES, type Tone } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Disclosure } from '@helvetly/ui/components/disclosure'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { inputClass } from '@helvetly/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@helvetly/ui/components/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  BadgeCheck,
  Banknote,
  CalendarDays,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Globe,
  History,
  Lock,
  Receipt,
  SearchX,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Tag,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { toast } from 'sonner'

import { ListSearch, ListToolbar } from '@/components/data/list-toolbar'
import { RecordLink } from '@/components/record-link'
import { UserAvatar } from '@/components/user-avatar'
import { errorMessage } from '@/lib/api'
import {
  AUDIT_CATEGORIES,
  byDay,
  dayLabel,
  eventSentence,
  foldEvents,
  payloadFacts,
  rowSentence,
  sentenceText,
  type AuditRow,
  type Sentence,
} from '@/lib/audit-log'
import {
  booksApi,
  EVENT_LABELS,
  exportUrl,
  type AuditCategory,
  type AuditFilter,
  type FinancialEvent,
} from '@/lib/books'
import { translate } from '@/lib/i18n'

import { HelpTip } from './help-tip'
import { SettingsEmpty, SettingsPage } from './layout'
import { SettingsHeader } from './settings-tabs'

const time = new Intl.DateTimeFormat(languageTag, { timeStyle: 'short' })
const fullTime = new Intl.DateTimeFormat(languageTag, {
  dateStyle: 'full',
  timeStyle: 'long',
})

const LOOK: Record<AuditCategory, { Icon: LucideIcon; tone: Tone }> = {
  invoices: { Icon: FileText, tone: 'blue' },
  payments: { Icon: Banknote, tone: 'green' },
  expenses: { Icon: Receipt, tone: 'amber' },
  approvals: { Icon: BadgeCheck, tone: 'violet' },
  books: { Icon: Lock, tone: 'neutral' },
  portal: { Icon: Globe, tone: 'blue' },
  employees: { Icon: Users, tone: 'violet' },
  settings: { Icon: Settings2, tone: 'neutral' },
}

/** The icon and tint of an event: by its category, red for anything undone. */
export function eventLook(event: Pick<FinancialEvent, 'kind' | 'category'>): {
  Icon: LucideIcon
  tone: Tone
} {
  const look = LOOK[event.category] ?? { Icon: History, tone: 'neutral' }
  const undone = /\.(voided|deleted|cancelled|rejected)$/.test(event.kind)
  return undone ? { ...look, tone: 'red' } : look
}

export function AuditLogSettings() {
  return (
    <>
      <SettingsHeader
        actions={
          <Button asChild variant="outline" size="sm">
            <a href={localizedHref(exportUrl())} download>
              <Download />
              {translate('exportCSV2')}
            </a>
          </Button>
        }
      />
      <SettingsPage
        title={translate('auditLog')}
        description={translate('everyFinancialEventInOrderEntriesCanNeverBe')}
      >
        <AuditLog />
      </SettingsPage>
    </>
  )
}

type Filters = { category: AuditCategory | ''; actor: string; from: string; to: string }
const NO_FILTERS: Filters = { category: '', actor: '', from: '', to: '' }

/** A local calendar day ("2026-11-20") as the instant it starts. */
const dayStart = (day: string, plusDays = 0) => {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number)
  return new Date(y, m - 1, d + plusDays).toISOString()
}

export function AuditLog() {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<FinancialEvent | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  const filter: AuditFilter = {
    order: 'newest',
    category: filters.category || undefined,
    actor: filters.actor || undefined,
    since: filters.from ? dayStart(filters.from) : undefined,
    before: filters.to ? dayStart(filters.to, 1) : undefined,
    q: query || undefined,
  }
  const filtered = Object.values(filters).some(Boolean) || query !== ''

  const verify = useQuery({
    queryKey: ['books', 'audit-log', 'verify'],
    queryFn: async () => (await booksApi.verify()).data,
  })
  const people = useQuery({
    queryKey: ['books', 'audit-log', 'people'],
    queryFn: async () => (await booksApi.people()).data,
  })
  const events = useInfiniteQuery({
    queryKey: ['books', 'audit-log', 'events', filter],
    queryFn: ({ pageParam }) => booksApi.events(pageParam, 50, filter),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.meta.next_cursor,
    placeholderData: (previous) => previous,
  })

  const rows = events.data?.pages.flatMap((page) => page.data) ?? []
  const nothingYet = !filtered && events.data && rows.length === 0
  if (nothingYet)
    return (
      <div className="pt-10">
        <SettingsEmpty icon={<History />} title={translate('nothingRecordedYet')}>
          {translate('issuedInvoicesPaymentsBookedExpensesAndClosedMonthsAppear')}
        </SettingsEmpty>
      </div>
    )

  const count =
    filtered || !verify.data
      ? events.data && translate('auditEntriesShown', { count: rows.length })
      : translate('auditEntries', { count: verify.data.entries })

  return (
    <div data-wide className="grid gap-3">
      <ChainStatus check={verify.data} failed={verify.isError} />
      <div className="rounded-xl border bg-card">
        <ListToolbar className="flex-wrap gap-y-1 py-1">
          <TypeFilter
            value={filters.category}
            onChange={(category) => setFilters({ ...filters, category })}
          />
          <PersonFilter
            value={filters.actor}
            people={people.data ?? []}
            onChange={(actor) => setFilters({ ...filters, actor })}
          />
          <DateFilter
            from={filters.from}
            to={filters.to}
            onChange={(from, to) => setFilters({ ...filters, from, to })}
          />
          <ListSearch
            label={translate('auditSearchLabel')}
            placeholder={translate('auditSearchPlaceholder')}
            value={search}
            onChange={setSearch}
            className="min-w-48"
          />
          <span
            aria-live="polite"
            className="hidden shrink-0 px-2 text-body-sm text-muted-foreground tabular-nums sm:inline"
          >
            {count}
          </span>
        </ListToolbar>
        {events.error ? (
          <p className="p-6 text-body text-muted-foreground">{errorMessage(events.error)}</p>
        ) : !events.data ? (
          <LoadingDays />
        ) : rows.length === 0 ? (
          <div className="grid justify-items-center gap-3 px-6 py-14 text-center">
            <SearchX className="size-6 stroke-[1.5] text-muted-foreground" aria-hidden />
            <div className="grid gap-1">
              <p className="text-body font-medium">{translate('auditNoMatches')}</p>
              <p className="text-body-sm text-muted-foreground">
                {translate('auditNoMatchesHint')}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFilters(NO_FILTERS)
                setSearch('')
              }}
            >
              {translate('clearSearchAndFilters')}
            </Button>
          </div>
        ) : (
          <Days events={rows} onOpen={setOpen} />
        )}
        {events.hasNextPage && (
          <div className="border-t p-3">
            <Button
              variant="outline"
              size="sm"
              disabled={events.isFetchingNextPage}
              onClick={() => void events.fetchNextPage()}
            >
              {events.isFetchingNextPage ? translate('loading') : translate('loadMore')}
            </Button>
          </div>
        )}
      </div>
      {open && <EntryDrawer event={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

const actorOf = (row: AuditRow | undefined) => row?.events[0]?.actor?.id ?? 'system'

function Days({
  events,
  onOpen,
}: {
  events: FinancialEvent[]
  onOpen: (event: FinancialEvent) => void
}) {
  return (
    <div>
      {[...byDay(events)].map(([key, dayEvents]) => {
        const label = dayLabel(key)
        const rows = foldEvents(dayEvents)
        return (
          <section key={key} aria-label={label} className="border-t first:border-t-0">
            <h3 className="sticky top-[52px] z-10 flex items-baseline justify-between gap-3 border-b bg-card/95 px-4 py-2 text-caption font-medium text-muted-foreground backdrop-blur-sm md:top-[66px]">
              <span>{label}</span>
              <span className="tabular-nums">
                {translate('auditEntries', { count: dayEvents.length })}
              </span>
            </h3>
            <ol className="grid gap-px p-1.5">
              {rows.map((row, index) => (
                <EntryRow
                  key={row.key}
                  row={row}
                  showActor={index === 0 || actorOf(rows[index - 1]) !== actorOf(row)}
                  onOpen={onOpen}
                />
              ))}
            </ol>
          </section>
        )
      })}
    </div>
  )
}

function SentenceText({ sentence }: { sentence: Sentence }) {
  return (
    <>
      {sentence.parts.map((part, index) =>
        typeof part === 'string' ? (
          part
        ) : part.href ? (
          <RecordLink
            key={index}
            href={part.href}
            className="relative z-[1] font-mono text-[0.95em] underline decoration-border underline-offset-2 hover:decoration-foreground"
          >
            {part.label}
          </RecordLink>
        ) : (
          <span key={index} className="font-mono text-[0.95em]">
            {part.label}
          </span>
        ),
      )}
    </>
  )
}

function Actor({ event }: { event: FinancialEvent }) {
  const name = event.actor?.name ?? translate('system')
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-body-sm text-muted-foreground">
      {event.actor ? (
        <UserAvatar name={name} className="size-5 text-[10px]" />
      ) : (
        <UserRound className="size-4 shrink-0" aria-hidden />
      )}
      <span className="truncate">{name}</span>
    </span>
  )
}

function EntryRow({
  row,
  showActor,
  onOpen,
  nested,
}: {
  row: AuditRow
  showActor: boolean
  onOpen: (event: FinancialEvent) => void
  nested?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const first = row.events[0]
  const last = row.events.at(-1)
  if (!first || !last) return null
  const sentence = rowSentence(row)
  const { Icon, tone } = eventLook(first)
  const folded = row.events.length > 1
  const label = sentenceText(sentence)
  const times = [first.at, last.at]
    .toSorted()
    .map((at) => time.format(new Date(at)))
  return (
    <li>
      <div
        className={cn(
          'relative grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-muted/60',
          nested && 'ml-10',
        )}
      >
        {/* The whole row opens the entry; the record's link and the fold's toggle sit above it. */}
        <button
          type="button"
          aria-label={translate('auditOpenEntry', { sentence: label })}
          className="absolute inset-0 cursor-pointer rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => onOpen(first)}
        />
        <span
          aria-hidden
          className={cn('grid size-7 place-items-center rounded-full', TONES[tone])}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-body">
            <SentenceText sentence={sentence} />
          </span>
          {sentence.amount && (
            <span className="text-body-sm text-muted-foreground tabular-nums">
              · {sentence.amount}
            </span>
          )}
          {sentence.times > 1 && (
            <span className="rounded-full bg-muted px-2 text-caption text-muted-foreground tabular-nums">
              {translate('auditTimes', { count: sentence.times })}
            </span>
          )}
          {folded && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
              className="relative z-[1] inline-flex cursor-pointer items-center gap-0.5 rounded text-body-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {expanded ? translate('auditHideEach') : translate('auditShowEach')}
              <ChevronDown
                aria-hidden
                className={cn('size-3.5 transition-transform', expanded && 'rotate-180')}
              />
            </button>
          )}
        </span>
        <span className="flex items-center gap-3">
          {showActor && !nested && (
            <span className="hidden max-w-44 sm:flex">
              <Actor event={first} />
            </span>
          )}
          <time
            dateTime={first.at}
            className="font-mono text-caption whitespace-nowrap text-muted-foreground tabular-nums"
          >
            {folded && times[0] !== times[1] ? `${times[0]}–${times[1]}` : times[0]}
          </time>
        </span>
      </div>
      {folded && expanded && (
        <ol className="grid gap-px">
          {row.events.map((event) => (
            <EntryRow
              key={event.seq}
              row={{ key: String(event.seq), events: [event] }}
              showActor={false}
              onOpen={onOpen}
              nested
            />
          ))}
        </ol>
      )}
    </li>
  )
}

/** A filter's trigger: its current choice, or its name while it filters nothing. */
function FilterButton({
  label,
  active,
  ...props
}: ComponentProps<typeof Button> & { label: string; active: boolean }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      {...props}
      className={cn('shrink-0 font-normal', active ? 'text-foreground' : 'text-muted-foreground')}
    >
      {label}
      <ChevronDown className="opacity-60" />
    </Button>
  )
}

function TypeFilter({
  value,
  onChange,
}: {
  value: AuditCategory | ''
  onChange: (value: AuditCategory | '') => void
}) {
  const current = AUDIT_CATEGORIES.find((category) => category.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FilterButton
          label={current?.label ?? translate('auditFilterType')}
          active={Boolean(current)}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) =>
            onChange(AUDIT_CATEGORIES.find((category) => category.value === next)?.value ?? '')
          }
        >
          <DropdownMenuRadioItem value="">{translate('auditAllTypes')}</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {AUDIT_CATEGORIES.map((category) => {
            const { Icon } = LOOK[category.value]
            return (
              <DropdownMenuRadioItem key={category.value} value={category.value}>
                <Icon className="text-muted-foreground" />
                {category.label}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PersonFilter({
  value,
  people,
  onChange,
}: {
  value: string
  people: { id: string; name: string }[]
  onChange: (value: string) => void
}) {
  const current = people.find((person) => person.id === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={people.length === 0}>
        <FilterButton
          label={current?.name ?? translate('auditFilterPerson')}
          active={Boolean(current)}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          <DropdownMenuRadioItem value="">{translate('auditEveryone')}</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {people.map((person) => (
            <DropdownMenuRadioItem key={person.id} value={person.id}>
              <UserAvatar name={person.name} className="size-5 text-[10px]" />
              <span className="truncate">{person.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DateFilter({
  from,
  to,
  onChange,
}: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
}) {
  const label =
    from && to
      ? translate('auditDateRange', { from: formatDate(from), to: formatDate(to) })
      : from
        ? translate('auditSince', { date: formatDate(from) })
        : to
          ? translate('auditUntil', { date: formatDate(to) })
          : translate('auditFilterDate')
  const dateClass = cn(inputClass, 'cursor-text px-2 tabular-nums')
  return (
    <Popover>
      <PopoverTrigger asChild>
        <FilterButton label={label} active={Boolean(from || to)} />
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-72 gap-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-caption text-muted-foreground">
            {translate('from')}
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => onChange(event.target.value, to)}
              className={dateClass}
            />
          </label>
          <label className="grid gap-1 text-caption text-muted-foreground">
            {translate('to3')}
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => onChange(from, event.target.value)}
              className={dateClass}
            />
          </label>
        </div>
        {(from || to) && (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start text-muted-foreground"
            onClick={() => onChange('', '')}
          >
            <CalendarDays />
            {translate('auditAnyDate')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function LoadingDays() {
  return (
    <div role="status" aria-busy className="grid gap-2 p-4" aria-label={translate('loading')}>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 py-1.5">
          <span className="size-7 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
          <span
            className="h-3.5 animate-pulse rounded bg-muted motion-reduce:animate-none"
            style={{ width: `${40 + ((index * 17) % 35)}%` }}
          />
          <span className="ml-auto h-3 w-10 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  )
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const name = translate('auditCopy', { label })
  return (
    <span className="flex min-w-0 items-start gap-1">
      <code className="min-w-0 font-mono text-caption break-all text-foreground/80">{value}</code>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={name}
            className="-my-0.5 shrink-0 text-muted-foreground"
            onClick={() =>
              void navigator.clipboard
                .writeText(value)
                .then(() => toast.success(translate('copied', { label })))
            }
          >
            <Copy />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{name}</TooltipContent>
      </Tooltip>
    </span>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 py-2 text-body-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

const KNOWN_FACTS =
  /^(number|amount|paid_on|method|reason|issue_date|currency|payable_total|total|base_total|base_currency|deductible_vat|document_date|month|count|interval|name|comment|hostname|kind|origin|doc_type|enabled|min_total|rules|previous_status|credit_note_number|replaced_by_number|reimbursed_on|status)$/
const factLabel = (key: string) =>
  KNOWN_FACTS.test(key) ? translate('auditFact', { key }) : key.replaceAll('_', ' ')

function EntryDrawer({ event, onClose }: { event: FinancialEvent; onClose: () => void }) {
  const sentence = eventSentence(event)
  const { Icon, tone } = eventLook(event)
  const record = sentence.parts.find((part) => typeof part !== 'string')
  const facts = payloadFacts(event).filter((fact) => fact.key !== 'from' && fact.key !== 'to')
  const before = event.payload.from
  const after = event.payload.to
  const category = AUDIT_CATEGORIES.find((entry) => entry.value === event.category)
  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full! max-w-none! gap-0 p-0 sm:w-[480px]!">
        <SheetHeader className="border-b px-5 py-4">
          <div className="flex items-start gap-3 pr-8">
            <span
              aria-hidden
              className={cn('grid size-8 shrink-0 place-items-center rounded-full', TONES[tone])}
            >
              <Icon className="size-4" />
            </span>
            <div className="grid min-w-0 gap-0.5">
              <SheetTitle className="text-title-sm leading-snug">
                <SentenceText sentence={sentence} />
              </SheetTitle>
              <SheetDescription>
                {[category?.label, sentence.amount].filter(Boolean).join(' · ')}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <div className="grid gap-5 overflow-y-auto px-5 py-4">
          <dl className="divide-y">
            <Fact label={translate('auditWho')}>
              <Actor event={event} />
            </Fact>
            <Fact label={translate('auditWhen')}>
              <time dateTime={event.at}>{fullTime.format(new Date(event.at))}</time>
            </Fact>
            {record && (
              <Fact label={translate('auditRecord')}>
                {record.href ? (
                  <RecordLink
                    href={record.href}
                    onClick={onClose}
                    className="font-mono underline underline-offset-2"
                  >
                    {record.label}
                  </RecordLink>
                ) : (
                  translate('auditRecordGone', { label: record.label })
                )}
              </Fact>
            )}
            {typeof before === 'string' && (
              <Fact label={translate('auditBefore')}>{before}</Fact>
            )}
            {typeof after === 'string' && <Fact label={translate('auditAfter')}>{after}</Fact>}
          </dl>
          {facts.length > 0 && (
            <section className="grid gap-1">
              <h3 className="text-caption font-medium text-muted-foreground">
                {translate('auditWhatWasRecorded')}
              </h3>
              <dl className="divide-y">
                {facts.map((fact) => (
                  <Fact key={fact.key} label={factLabel(fact.key)}>
                    <span className="break-words">{fact.value}</span>
                  </Fact>
                ))}
              </dl>
            </section>
          )}
          <Disclosure
            label={translate('auditTechnical')}
            description={translate('auditTechnicalHint')}
            icon={Tag}
          >
            <dl className="divide-y pr-3">
              <Fact label={translate('auditEventType')}>
                {EVENT_LABELS[event.kind] ?? event.kind}{' '}
                <code className="font-mono text-caption text-muted-foreground">{event.kind}</code>
              </Fact>
              <Fact label={translate('auditSequence')}>
                <span className="font-mono tabular-nums">#{event.seq}</span>
              </Fact>
              <Fact label={translate('auditEventHash')}>
                <CopyValue label={translate('auditEventHash')} value={event.hash} />
              </Fact>
              <Fact label={translate('auditPreviousHash')}>
                {event.prev_hash ? (
                  <CopyValue label={translate('auditPreviousHash')} value={event.prev_hash} />
                ) : (
                  translate('auditFirstEntry')
                )}
              </Fact>
            </dl>
          </Disclosure>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ChainStatus({
  check,
  failed,
}: {
  check: { ok: boolean; broken_at: number | null; entries: number } | undefined
  failed: boolean
}) {
  const help = (
    <HelpTip label={translate('aboutTheChainCheck')}>
      {translate('eachEntryIsSealedWithTheHashOfThe')}
    </HelpTip>
  )
  if (!check)
    return (
      <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
        {failed ? translate('theChainCouldNotBeCheckedRightNow') : translate('checkingTheChain')}{' '}
        {help}
      </p>
    )
  if (check.ok)
    return (
      <output className="flex items-center gap-2 text-body-sm text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden />
        <span className="text-foreground">
          {translate('auditChainIntact', { count: check.entries })}
        </span>
        {help}
      </output>
    )
  return (
    <output className="flex items-center gap-3 rounded-xl border border-destructive/25 bg-destructive-surface/50 px-4 py-3">
      <ShieldAlert className="size-5 shrink-0 text-destructive" aria-hidden />
      <span className="grid flex-1 gap-0.5">
        <span className="text-body font-medium">
          {translate('chainBrokenAtEntry', { broken_at: check.broken_at })}
        </span>
        <span className="text-body-sm text-muted-foreground">
          {translate('entriesFromThisOneOnMayHaveBeenChanged')}
        </span>
      </span>
      {help}
    </output>
  )
}
