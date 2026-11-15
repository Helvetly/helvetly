'use client'
import { translate } from '@/lib/i18n'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { errorMessage } from '@/lib/api'
import { expenseKeys } from '@/lib/expenses'
import {
  goesToImport,
  heidiApi,
  readEvents,
  type HeidiAction,
  type HeidiConfirmation,
  type HeidiForm,
  type HeidiPage,
  type HeidiRecord,
} from '@/lib/heidi'
import { importsApi } from '@/lib/imports'
import { invoiceKeys } from '@/lib/invoices'
import { queryKeys } from '@/lib/queries'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  attachments: string[]
  /** Kept in this browser only, so a failed message can be sent again with its files. */
  files?: File[]
  actions: HeidiAction[]
  /** Records the answer is about, shown as cards that open in place. */
  records?: HeidiRecord[]
  form?: HeidiForm
  /** The import the answer follows: its progress and review show under it. */
  importId?: string
  /** What Heidi is doing right now, while it streams. */
  status?: string
  /** The steps of this answer so far (status events), kept in this browser only. */
  steps?: string[]
  /** When the running stream started (ms), and how long the finished ones took. */
  startedAt?: number
  workedMs?: number
  state: 'streaming' | 'done' | 'error' | 'stopped' | 'paused'
  error?: string
  /** When it was sent or answered; missing for messages stored before times were returned. */
  at?: Date
}

export const EMPTY_ANSWER = translate('iDonTHaveAnAnswerForThatYet')

const STORAGE = 'helvetly:heidi:conversation'
/** A conversation left for longer starts over: Heidi's context is about what you're doing now. */
export const RESUME_MS = 5 * 60 * 1000

const newConversationId = () => crypto.randomUUID().replaceAll('-', '').slice(0, 24)
const newMessageId = () => crypto.randomUUID()

const assistantMessage = (): ChatMessage => ({
  id: newMessageId(),
  role: 'assistant',
  text: '',
  attachments: [],
  actions: [],
  state: 'streaming',
  at: new Date(),
})

type Outcome = 'done' | 'paused' | 'error' | 'stopped'

/** The stored conversation id, if it was used within the last five minutes. */
export function resumableConversation(storageKey: string, now = Date.now()): string | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (typeof stored !== 'object' || stored === null) return null
    const { id, at } = stored as Record<string, unknown>
    return typeof id === 'string' && typeof at === 'number' && now - at < RESUME_MS ? id : null
  } catch {
    return null
  }
}

function remember(storageKey: string, id: string) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ id, at: Date.now() }))
  } catch {}
}

// A status label that says Heidi changed something tells which lists to refetch, and only those.
const WRITES = /\b(creat|add|sav|updat|delet|remov|send|sent|mark|import|record)/i
const AFFECTS: [RegExp, QueryKey[]][] = [
  [/invoice/i, [invoiceKeys.all, queryKeys.dashboard]],
  [/expense/i, [expenseKeys.all, queryKeys.dashboard]],
  [/client/i, [queryKeys.clients]],
  [/document|file/i, [queryKeys.documents]],
  [/member/i, [queryKeys.members]],
  [/engagement/i, [queryKeys.engagements]],
]

export function affectedQueries(statuses: string[]): QueryKey[] {
  const writes = statuses.filter((label) => WRITES.test(label))
  return AFFECTS.filter(([pattern]) => writes.some((label) => pattern.test(label))).flatMap(
    ([, keys]) => keys,
  )
}

export const usageKey = ['heidi', 'usage'] as const

/** One conversation with Heidi: sending, streaming, stopping, retrying and confirmations. */
export function useHeidiChat(page: HeidiPage, scope: string) {
  const queryClient = useQueryClient()
  const storageKey = `${STORAGE}:${scope}`
  // The conversation to pick up again, read once from this browser.
  const [resumeId] = useState(() => resumableConversation(storageKey))
  const [conversationId, setConversationId] = useState(() => resumeId ?? newConversationId())
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(resumeId !== null)
  const [confirmation, setConfirmation] = useState<
    (HeidiConfirmation & { messageId: string }) | null
  >(null)
  const abort = useRef<AbortController | null>(null)
  const decided = useRef(new Set<string>())

  useEffect(
    () => () => {
      const current = abort.current
      abort.current = null
      current?.abort()
    },
    [],
  )

  const generation = useRef(0)

  /** Loads a stored conversation and continues it; a gone one starts a fresh conversation. */
  const load = useCallback((id: string, fallback: () => void) => {
    const mine = ++generation.current
    heidiApi
      .conversation(id)
      .then(({ data }) => {
        if (mine !== generation.current) return
        setMessages(
          data.map((message) => ({
            id: message.id,
            role: message.role,
            text: message.text,
            attachments: message.attachments ?? [],
            actions: message.actions ?? [],
            records: message.records,
            form: message.form,
            importId: message.import_id,
            state: message.confirmation ? 'paused' : 'done',
            at: message.created_at ? new Date(message.created_at) : undefined,
          })),
        )
        const pending = data.findLast((message) => message.confirmation)
        setConfirmation(
          pending?.confirmation ? { ...pending.confirmation, messageId: pending.id } : null,
        )
      })
      .catch(() => mine === generation.current && fallback())
      .finally(() => mine === generation.current && setRestoring(false))
  }, [])

  // Resume the last conversation once, if it is recent enough.
  useEffect(() => {
    if (!resumeId) return
    load(resumeId, () => setConversationId(newConversationId()))
  }, [resumeId, load])

  const update = useCallback(
    (id: string, change: (message: ChatMessage) => Partial<ChatMessage>) =>
      setMessages((current) =>
        current.map((message) =>
          message.id === id ? { ...message, ...change(message) } : message,
        ),
      ),
    [],
  )

  /** Streams one turn into the assistant message `id`; resolves with how it ended. */
  const run = useCallback(
    async (id: string, start: (signal: AbortSignal) => Promise<Response>) => {
      const controller = new AbortController()
      abort.current = controller
      setBusy(true)
      const started = Date.now()
      update(id, () => ({ startedAt: started }))
      const statuses: string[] = []
      const outcome: { ended: Outcome | null } = { ended: null }
      try {
        const response = await start(controller.signal)
        await readEvents(response, (event) => {
          switch (event.type) {
            case 'text':
              update(id, (message) => ({ text: message.text + event.value, status: undefined }))
              break
            case 'status':
              statuses.push(event.label)
              update(id, (message) => ({
                status: event.label,
                steps: [...(message.steps ?? []), event.label],
              }))
              break
            case 'actions':
              update(id, () => ({ actions: event.actions }))
              break
            case 'records':
              update(id, () => ({ records: event.records }))
              break
            case 'form':
              update(id, () => ({ form: event.form }))
              break
            case 'import':
              update(id, () => ({ importId: event.import_id }))
              break
            case 'confirmation':
              outcome.ended = 'paused'
              update(id, () => ({ state: 'paused', status: undefined }))
              setConfirmation({ ...event, messageId: id })
              break
            case 'error':
              outcome.ended = 'error'
              update(id, () => ({ state: 'error', error: event.message, status: undefined }))
              break
            case 'done':
              outcome.ended = 'done'
              update(id, (message) => ({
                state: 'done',
                status: undefined,
                text:
                  message.text.trim() ||
                  message.actions.length ||
                  message.records?.length ||
                  message.form ||
                  message.importId
                    ? message.text
                    : EMPTY_ANSWER,
              }))
              break
          }
        })
        if (!outcome.ended) {
          outcome.ended = 'error'
          update(id, () => ({
            state: 'error',
            status: undefined,
            error: translate('theAnswerStoppedBeforeItWasFinished'),
          }))
        }
      } catch (error) {
        outcome.ended = controller.signal.aborted ? 'stopped' : 'error'
        update(id, () =>
          controller.signal.aborted
            ? { state: 'stopped', status: undefined }
            : { state: 'error', status: undefined, error: errorMessage(error) },
        )
      } finally {
        update(id, (message) => ({
          startedAt: undefined,
          workedMs: (message.workedMs ?? 0) + Date.now() - started,
        }))
        if (abort.current === controller) {
          abort.current = null
          setBusy(false)
          remember(storageKey, conversationId)
        }
        for (const key of affectedQueries(statuses))
          void queryClient.invalidateQueries({ queryKey: key })
        void queryClient.invalidateQueries({ queryKey: usageKey })
      }
      return outcome.ended
    },
    [queryClient, storageKey, conversationId, update],
  )

  const post = useCallback(
    (assistantId: string, text: string, files: File[]) =>
      run(assistantId, async (signal) => {
        const form = new FormData()
        form.set('message', text)
        form.set('conversation_id', conversationId)
        form.set('page', page)
        if (goesToImport(text, files)) {
          // The files go to an import that works out what they are; the answer then follows it.
          update(assistantId, () => ({ status: 'Uploading files', steps: ['Uploading files'] }))
          const batch = await importsApi.upload('auto', files)
          form.set('import_id', batch.id)
        } else for (const file of files) form.append('files[]', file)
        return heidiApi.chat(form, signal)
      }),
    [run, conversationId, page, update],
  )

  const send = useCallback(
    (text: string, files: File[] = []) => {
      const message = text.trim()
      if (!message || busy || abort.current || restoring) return
      const reply = assistantMessage()
      setMessages((current) => [
        ...current,
        {
          id: newMessageId(),
          role: 'user',
          text: message,
          attachments: files.map((file) => file.name),
          files,
          actions: [],
          state: 'done',
          at: new Date(),
        },
        reply,
      ])
      void post(reply.id, message, files)
    },
    [busy, restoring, post],
  )

  /** Sends the question of a failed answer again, without a second copy of the question. */
  const retry = useCallback(
    (assistantId: string) => {
      const index = messages.findIndex((message) => message.id === assistantId)
      const question = messages[index - 1]
      if (busy || abort.current || !question || question.role !== 'user') return
      const reply = assistantMessage()
      setMessages((current) => [...current.filter((message) => message.id !== assistantId), reply])
      void post(reply.id, question.text, question.files ?? [])
    },
    [messages, busy, post],
  )

  /** Answers the open confirmation. Exactly one request per confirmation, whatever the UI does. */
  const decide = useCallback(
    async (approved: boolean) => {
      const open = confirmation
      if (!open || abort.current || decided.current.has(open.id)) return
      decided.current.add(open.id)
      setConfirmation(null)
      update(open.messageId, (message) => ({
        state: 'streaming',
        text: message.text.trimEnd() + '\n\n',
      }))
      const ended = await run(open.messageId, (signal) =>
        heidiApi.confirm(
          { conversation_id: conversationId, confirmation_id: open.id, approved },
          signal,
        ),
      )
      if (ended === 'done') {
        if (approved) toast.success(translate('done2', { confirm_label: open.confirm_label }))
        else toast(translate('cancelledNothingWasChanged'))
      } else if (ended === 'error') {
        toast.error(translate('heidiCouldnTFinishThatNothingWasConfirmedTwice'))
      }
    },
    [confirmation, conversationId, run, update],
  )

  const stop = useCallback(() => {
    abort.current?.abort()
  }, [])

  const newChat = useCallback(() => {
    generation.current++
    setRestoring(false)
    const previous = abort.current
    abort.current = null
    previous?.abort()
    setBusy(false)
    setMessages([])
    setConfirmation(null)
    const id = newConversationId()
    setConversationId(id)
    try {
      localStorage.removeItem(storageKey)
    } catch {}
  }, [storageKey])

  /** Switches to a conversation from the history. */
  const open = useCallback(
    (id: string) => {
      if (id === conversationId) return
      newChat()
      setConversationId(id)
      remember(storageKey, id)
      setRestoring(true)
      load(id, () => {
        toast.error(translate('thatConversationIsNoLongerAvailable'))
        newChat()
      })
    },
    [conversationId, newChat, storageKey, load],
  )

  return useMemo(
    () => ({
      conversationId,
      messages,
      busy,
      restoring,
      confirmation,
      send,
      retry,
      decide,
      stop,
      newChat,
      open,
    }),
    [
      conversationId,
      messages,
      busy,
      restoring,
      confirmation,
      send,
      retry,
      decide,
      stop,
      newChat,
      open,
    ],
  )
}

export type HeidiChat = ReturnType<typeof useHeidiChat>
