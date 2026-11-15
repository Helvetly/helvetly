'use client'
import { languageTag } from '@helvetly/i18n'
import { Loader } from '@helvetly/ui/components/loader'
import { useQuery } from '@tanstack/react-query'
import { MessageSquare, MessagesSquare } from 'lucide-react'
import type { KeyboardEvent } from 'react'

import { LoadError } from '@/components/load-error'
import { heidiApi, type HeidiConversation } from '@/lib/heidi'
import { translate } from '@/lib/i18n'

export type ChatGroup = { label: string; chats: HeidiConversation[] }

const LABELS = [
  translate('today'),
  translate('yesterday'),
  translate('previous7Days'),
  translate('older'),
] as const

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

/** Whole calendar days between two moments, in this browser's time zone. */
function daysBetween(at: Date, now: Date) {
  return Math.round((startOfDay(now).getTime() - startOfDay(at).getTime()) / 86_400_000)
}

/** Chats (newest first) in date groups; empty groups are left out. */
export function groupChats(chats: HeidiConversation[], now = new Date()): ChatGroup[] {
  const groups: ChatGroup[] = LABELS.map((label) => ({ label, chats: [] }))
  for (const chat of chats) {
    const days = daysBetween(new Date(chat.updated_at), now)
    groups[days <= 0 ? 0 : days === 1 ? 1 : days < 7 ? 2 : 3]?.chats.push(chat)
  }
  return groups.filter((group) => group.chats.length)
}

/** Chats whose question or latest answer contains the term (case-insensitive); all for a blank term. */
export function filterChats(chats: HeidiConversation[], term: string) {
  const needle = term.trim().toLocaleLowerCase()
  if (!needle) return chats
  return chats.filter((chat) =>
    `${chat.title}\n${chat.snippet ?? ''}`.toLocaleLowerCase().includes(needle),
  )
}

const clock = new Intl.DateTimeFormat(languageTag, { hour: '2-digit', minute: '2-digit' })
const day = new Intl.DateTimeFormat(languageTag, { day: 'numeric', month: 'short' })
const dayAndYear = new Intl.DateTimeFormat(languageTag, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const full = new Intl.DateTimeFormat(languageTag, { dateStyle: 'full', timeStyle: 'short' })

/** "08:31" for today and yesterday (the group says which), "10 Nov" before, with the year if not this one. */
export function chatTime(at: Date, now = new Date()) {
  if (daysBetween(at, now) <= 1) return clock.format(at)
  return (at.getFullYear() === now.getFullYear() ? day : dayAndYear).format(at)
}

/** Up, Down, Home and End move between the rows, as in any list. */
function onRowKey(event: KeyboardEvent<HTMLButtonElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const list = event.currentTarget.closest('nav')
  const rows = [...(list?.querySelectorAll<HTMLButtonElement>('button[data-chat]') ?? [])]
  const at = rows.indexOf(event.currentTarget)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? rows.length - 1
        : Math.min(Math.max(at + (event.key === 'ArrowDown' ? 1 : -1), 0), rows.length - 1)
  event.preventDefault()
  rows[next]?.focus()
}

function Row({
  chat,
  current,
  onOpen,
}: {
  chat: HeidiConversation
  current: boolean
  onOpen: (id: string) => void
}) {
  const at = new Date(chat.updated_at)
  const count = chat.messages
    ? `${chat.messages} ${chat.messages === 1 ? 'message' : 'messages'}`
    : ''
  const detail = [count, chat.snippet].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      data-chat={chat.id}
      aria-current={current ? 'true' : undefined}
      onClick={() => onOpen(chat.id)}
      onKeyDown={onRowKey}
      className="group/chat flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 outline-none hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current]:bg-heidi-soft/60 dark:aria-[current]:bg-heidi/15"
    >
      <MessageSquare
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-muted-foreground group-aria-[current]/chat:text-heidi-ink"
      />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-body-sm font-medium text-foreground">
            {chat.title || translate('untitledChat')}
          </span>
          <time
            dateTime={chat.updated_at}
            title={full.format(at)}
            className="shrink-0 text-caption text-muted-foreground tabular-nums"
          >
            {chatTime(at)}
          </time>
        </span>
        {detail && <span className="truncate text-caption text-muted-foreground">{detail}</span>}
      </span>
    </button>
  )
}

/** The person's earlier chats by date, newest first; picking one continues it. `term` filters them. */
export function ChatHistory({
  current,
  term,
  onOpen,
}: {
  current: string
  term: string
  onOpen: (id: string) => void
}) {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['heidi', 'conversations'],
    queryFn: heidiApi.conversations,
    refetchOnMount: 'always',
  })
  if (isPending) return <Loader label={translate('loadingYourChats')} />
  if (error)
    return (
      <div className="my-auto py-6">
        <LoadError what={translate('yourChats')} error={error} onRetry={() => void refetch()} />
      </div>
    )
  if (!data.data.length)
    return (
      <div className="m-auto grid justify-items-center gap-2 px-4 text-center">
        <MessagesSquare aria-hidden className="size-6 text-muted-foreground" />
        <p className="text-body-sm font-medium">{translate('noChatsYet')}</p>
        <p className="max-w-64 text-body-sm text-muted-foreground">
          {translate('yourConversationsWithHeidiWillBeListedHere')}
        </p>
      </div>
    )
  const groups = groupChats(filterChats(data.data, term))
  return (
    <nav aria-label={translate('chats')} className="py-3">
      {groups.length ? (
        <div className="grid gap-4">
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="grid gap-0.5">
              <h3 className="px-2.5 pb-1 text-caption font-medium text-muted-foreground">
                {group.label}
              </h3>
              <ul className="grid gap-0.5">
                {group.chats.map((chat) => (
                  <li key={chat.id}>
                    <Row chat={chat} current={chat.id === current} onOpen={onOpen} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <output className="block px-2.5 py-6 text-center text-body-sm text-muted-foreground">
          {translate('noChatsMatch')}
          {term.trim()}”.
        </output>
      )}
    </nav>
  )
}
